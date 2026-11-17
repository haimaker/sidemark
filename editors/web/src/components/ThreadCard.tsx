import {useEffect, useRef, useState} from 'preact/hooks'
import type {Ref, TargetedKeyboardEvent} from 'preact'
import type {Comment, CommentMarkDocument, Thread} from '@commentmark/core'
import {isPrimaryModifier} from '../hooks'
import {hasText, type Draft} from '../model/draft'
import {CellView} from './CellView'

/** Every thread action resolves `true` when the document changed. */
export interface ThreadActions {
  reply(threadId: string, text: string): Promise<boolean>
  setStatus(threadId: string, status: 'open' | 'resolved', note: string): Promise<boolean>
  edit(threadId: string, index: number, text: string): Promise<boolean>
  deleteComment(threadId: string, index: number): Promise<boolean>
  deleteThread(threadId: string): Promise<boolean>
}

interface ThreadCardProps {
  thread: Thread
  doc: CommentMarkDocument
  focused: boolean
  /** Show the commented text above the thread (detached and list views). */
  showQuote: boolean
  actions: ThreadActions
  onFocus(id: string): void
  onClose?(): void
}

type Confirming = {kind: 'thread'} | {kind: 'comment'; index: number} | null

export function ThreadCard({thread, doc, focused, showQuote, actions, onFocus, onClose}: ThreadCardProps) {
  const [reply, setReply] = useState('')
  const [editing, setEditing] = useState<{index: number; text: string} | null>(null)
  const [confirming, setConfirming] = useState<Confirming>(null)
  const resolved = thread.state === 'resolved'
  const orphaned = thread.attachment.kind === 'orphaned'

  useEffect(() => {
    if (!focused) {
      setConfirming(null)
      setEditing(null)
    }
  }, [focused])

  const submitReply = async () => {
    if (await actions.reply(thread.id, reply)) setReply('')
  }
  const toggleStatus = async () => {
    if (await actions.setStatus(thread.id, resolved ? 'open' : 'resolved', reply)) setReply('')
  }
  const onReplyKey = (event: TargetedKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && isPrimaryModifier(event)) {
      event.preventDefault()
      void submitReply()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setReply('')
      onClose?.()
    }
  }

  const label = `Comment thread by ${thread.comments[0]?.author || 'unknown author'}${resolved ? ', resolved' : ''}`

  return (
    <article
      class={`thread${focused ? ' is-focused' : ''}${resolved ? ' is-resolved' : ''}`}
      data-thread={thread.id}
      aria-label={label}
      tabIndex={focused ? -1 : 0}
      onFocusIn={() => onFocus(thread.id)}
      onClick={() => onFocus(thread.id)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && event.target === event.currentTarget) onClose?.()
      }}
    >
      {(resolved || orphaned) && (
        <div class="thread-badges">
          {resolved && <span class="badge badge-resolved">Resolved</span>}
          {orphaned && <span class="badge badge-detached">Detached</span>}
        </div>
      )}
      {showQuote && <QuoteView thread={thread} />}
      <ol class="comments">
        {thread.comments.map((comment) => (
          <li class="comment" key={comment.index}>
            <CommentHeader comment={comment} />
            {editing?.index === comment.index ? (
              <EditBox
                initial={editing.text}
                onCancel={() => setEditing(null)}
                onSave={async (text) => {
                  if (await actions.edit(thread.id, comment.index, text)) setEditing(null)
                }}
              />
            ) : (
              <>
                {comment.commentSource !== '' && <CellView comment={comment} doc={doc} />}
                <StatusEvent comment={comment} />
              </>
            )}
            {focused && editing?.index !== comment.index && (
              confirming?.kind === 'comment' && confirming.index === comment.index ? (
                <InlineConfirm
                  text={thread.comments.length === 1 ? 'Delete this comment and its thread?' : 'Delete this comment?'}
                  confirmLabel="Delete"
                  onConfirm={async () => {
                    setConfirming(null)
                    await actions.deleteComment(thread.id, comment.index)
                  }}
                  onCancel={() => setConfirming(null)}
                />
              ) : (
                <div class="comment-actions">
                  <button type="button" class="link-button" onClick={() => setEditing({index: comment.index, text: comment.comment})}>
                    Edit
                  </button>
                  <button type="button" class="link-button" onClick={() => setConfirming({kind: 'comment', index: comment.index})}>
                    Delete
                  </button>
                </div>
              )
            )}
          </li>
        ))}
      </ol>
      {focused && (
        <div class="thread-footer">
          <label class="visually-hidden" for={`reply-${thread.id}`}>
            Reply
          </label>
          <textarea
            id={`reply-${thread.id}`}
            class="reply-box"
            rows={2}
            placeholder={resolved ? 'Reply, or add a note and reopen…' : 'Reply, or add a note and resolve…'}
            value={reply}
            onInput={(event) => setReply(event.currentTarget.value)}
            onKeyDown={onReplyKey}
          />
          <div class="thread-buttons">
            <button type="button" class="button primary" disabled={reply.trim() === ''} onClick={submitReply}>
              Reply
            </button>
            <button type="button" class="button" onClick={toggleStatus} title={reply.trim() ? 'The text in the box is added as a note' : undefined}>
              {resolved ? 'Reopen' : 'Resolve'}
            </button>
            <span class="spacer" />
            {confirming?.kind === 'thread' ? (
              <InlineConfirm
                text="Delete the whole thread?"
                confirmLabel="Delete thread"
                onConfirm={async () => {
                  setConfirming(null)
                  await actions.deleteThread(thread.id)
                }}
                onCancel={() => setConfirming(null)}
              />
            ) : (
              <button type="button" class="button quiet danger" onClick={() => setConfirming({kind: 'thread'})}>
                Delete thread
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  )
}

function CommentHeader({comment}: {comment: Comment}) {
  return (
    <header class="comment-header">
      <span class="author">{comment.author || 'Unknown author'}</span>
      {comment.date.raw && (
        <time dateTime={comment.date.value?.toISOString()} title={comment.date.raw}>
          {formatDate(comment)}
        </time>
      )}
    </header>
  )
}

function StatusEvent({comment}: {comment: Comment}) {
  const {raw, value} = comment.status
  if (!raw) return null
  const text = value === 'resolved' ? 'Marked as resolved' : value === 'open' ? 'Reopened' : `Status: ${raw}`
  return <p class={`status-event status-${value ?? 'other'}`}>{text}</p>
}

/** Prefix, **quote**, suffix as plain text (never parsed as HTML). */
export function QuoteView({thread}: {thread: Thread}) {
  if (thread.attachment.kind === 'anchored') {
    return <blockquote class="thread-quote">{thread.attachment.text}</blockquote>
  }
  const quote = thread.quote
  if (!quote || quote.quote === '') return null
  return (
    <blockquote class="thread-quote">
      {quote.prefix && <span class="quote-context">…{quote.prefix}</span>}
      <strong>{quote.quote}</strong>
      {quote.suffix && <span class="quote-context">{quote.suffix}…</span>}
    </blockquote>
  )
}

function EditBox({initial, onSave, onCancel}: {initial: string; onSave(text: string): void; onCancel(): void}) {
  const [text, setText] = useState(initial)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  return (
    <div class="edit-box">
      <textarea
        ref={ref}
        rows={3}
        aria-label="Edit comment"
        value={text}
        onInput={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && isPrimaryModifier(event)) {
            event.preventDefault()
            onSave(text)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onCancel()
          }
        }}
      />
      <div class="thread-buttons">
        <button type="button" class="button primary" onClick={() => onSave(text)}>
          Save
        </button>
        <button type="button" class="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

export function InlineConfirm(props: {text: string; confirmLabel: string; onConfirm(): void; onCancel(): void}) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  return (
    <div class="inline-confirm" role="group" aria-label={props.text}>
      <span>{props.text}</span>
      <button type="button" class="button danger" ref={ref} onClick={props.onConfirm}>
        {props.confirmLabel}
      </button>
      <button type="button" class="button" onClick={props.onCancel}>
        Cancel
      </button>
    </div>
  )
}

/** The card for a new whole-document comment (opened by a button, so it takes focus). */
export function Composer(props: {
  title: string
  author: string
  onSubmit(text: string): Promise<boolean>
  onCancel(): void
}) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    ref.current?.focus({preventScroll: true})
  }, [])
  const submit = async () => {
    if (await props.onSubmit(text)) setText('')
  }
  return (
    <article class="thread composer is-focused" aria-label={props.title}>
      <p class="composer-title">{props.title}</p>
      <textarea
        ref={ref}
        rows={3}
        aria-label={props.title}
        placeholder="Write a comment…"
        value={text}
        onInput={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && isPrimaryModifier(event)) {
            event.preventDefault()
            void submit()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            props.onCancel()
          }
        }}
      />
      <div class="thread-buttons">
        <button type="button" class="button primary" disabled={text.trim() === ''} onClick={submit}>
          Comment
        </button>
        <button type="button" class="button" onClick={props.onCancel}>
          Cancel
        </button>
        {props.author && <span class="composer-author">as {props.author}</span>}
      </div>
    </article>
  )
}

const dateTime = new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeStyle: 'short'})
const dateOnly = new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeZone: 'UTC'})

function formatDate(comment: Comment): string {
  const {raw, value} = comment.date
  if (!value) return raw
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? dateOnly.format(value) : dateTime.format(value)
}

/**
 * The new-comment box that follows the body selection (see `model/draft.ts`).
 * It never focuses itself: the selection stays live until the person clicks
 * or tabs into the box.
 */
export function DraftBox(props: {
  draft: Draft
  author: string
  inputRef: Ref<HTMLTextAreaElement>
  onEngage(): void
  onText(text: string): void
  onSubmit(): void
  onCancel(): void
}) {
  const {draft} = props
  if (draft.error && !hasText(draft)) {
    return (
      <div class="thread draft draft-refused" role="status" data-testid="draft">
        {draft.error}
      </div>
    )
  }
  const blocked = draft.error !== null || draft.stale
  return (
    <article
      class={`thread composer draft${draft.engaged ? ' is-focused' : ''}`}
      aria-label="New comment"
      data-testid="draft"
      // Any press inside the box means "I am commenting": engage before the
      // browser collapses the body selection.
      onMouseDown={props.onEngage}
    >
      <p class="composer-title">New comment</p>
      {draft.stale && <p class="draft-note warning">The text this comment was for changed. Select it again to attach the comment.</p>}
      {draft.error && <p class="draft-note warning">{draft.error}</p>}
      <textarea
        ref={props.inputRef}
        rows={draft.engaged ? 3 : 2}
        aria-label="New comment"
        placeholder="Comment on the selection…"
        value={draft.text}
        onFocus={props.onEngage}
        onInput={(event) => props.onText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && isPrimaryModifier(event)) {
            event.preventDefault()
            if (!blocked) props.onSubmit()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            props.onCancel()
          }
        }}
      />
      <div class="thread-buttons">
        <button type="button" class="button primary" disabled={blocked || !hasText(draft)} onClick={props.onSubmit}>
          Comment
        </button>
        <button type="button" class="button" onClick={props.onCancel}>
          Cancel
        </button>
        {props.author && <span class="composer-author">as {props.author}</span>}
      </div>
    </article>
  )
}
