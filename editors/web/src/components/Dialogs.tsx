import {useEffect, useRef, useState} from 'preact/hooks'
import type {ComponentChildren} from 'preact'
import type {Thread} from '@commentmark/core'
import {looksLikeEmail, normaliseAuthor, suggestHandle} from '../model/author'
import {purgeCount, quoteText, type PurgeCandidates} from '../model/groups'

/**
 * A modal built on the native `<dialog>` element (focus trapping, Escape,
 * inert background). Never `alert`/`confirm`/`prompt`.
 */
function Modal(props: {title: string; onClose(): void; children: ComponentChildren; class?: string}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    if (!dialog.open) dialog.showModal()
    return () => dialog.close()
  }, [])
  return (
    <dialog
      ref={ref}
      class={`modal ${props.class ?? ''}`}
      aria-labelledby="modal-title"
      onCancel={(event) => {
        event.preventDefault()
        props.onClose()
      }}
    >
      <h2 id="modal-title">{props.title}</h2>
      {props.children}
    </dialog>
  )
}

export interface ConfirmRequest {
  title: string
  body: string
  confirmLabel: string
  danger?: boolean
  onConfirm(): void
}

export function ConfirmDialog({request, onClose}: {request: ConfirmRequest; onClose(): void}) {
  return (
    <Modal title={request.title} onClose={onClose}>
      <p>{request.body}</p>
      <div class="modal-buttons">
        <button type="button" class="button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          class={`button primary${request.danger ? ' danger' : ''}`}
          onClick={() => {
            onClose()
            request.onConfirm()
          }}
        >
          {request.confirmLabel}
        </button>
      </div>
    </Modal>
  )
}

export function AuthorDialog(props: {current: string; reason: string | null; onSave(author: string): void; onClose(): void}) {
  const [value, setValue] = useState(props.current)
  const author = normaliseAuthor(value)
  const suggestion = suggestHandle(value)
  const save = (event?: Event) => {
    event?.preventDefault()
    if (author) props.onSave(author)
  }
  return (
    <Modal title="Your name on comments" onClose={props.onClose}>
      <form onSubmit={save}>
        {props.reason && <p>{props.reason}</p>}
        <label class="field">
          <span>Author</span>
          <input
            type="text"
            value={value}
            placeholder="@handle"
            autoComplete="nickname"
            spellcheck={false}
            onInput={(event) => setValue(event.currentTarget.value)}
          />
        </label>
        <p class="hint">
          Use the handle people know you by on your code host or chat, such as <code>@ada</code>. It is written into the file next to
          each comment, where anyone who can read the file sees it. It is remembered in this browser.
        </p>
        {suggestion && (
          <p class="hint">
            <button type="button" class="link-button" onClick={() => setValue(suggestion)}>
              Use {suggestion}
            </button>
          </p>
        )}
        {looksLikeEmail(author) && <p class="hint warning">An email address will be visible to everyone who can read the file.</p>}
        <div class="modal-buttons">
          <button type="button" class="button" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" class="button primary" disabled={!author}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  )
}

export function PurgeDialog(props: {candidates: PurgeCandidates; onPurge(options: {resolved: boolean; orphaned: boolean}): void; onClose(): void}) {
  const {candidates} = props
  const [resolved, setResolved] = useState(candidates.resolved.length > 0)
  const [orphaned, setOrphaned] = useState(candidates.orphaned.length > 0)
  const count = purgeCount(candidates, {resolved, orphaned})
  return (
    <Modal title="Purge threads" onClose={props.onClose} class="purge">
      <p>Purging deletes whole threads from the file: every comment, and their anchors in the text. You can undo it until you close the page.</p>
      <PurgeGroup
        label="Resolved threads"
        threads={candidates.resolved}
        checked={resolved}
        onChange={setResolved}
      />
      <PurgeGroup
        label="Detached threads (their text is gone)"
        threads={candidates.orphaned}
        checked={orphaned}
        onChange={setOrphaned}
      />
      <div class="modal-buttons">
        <button type="button" class="button" onClick={props.onClose}>
          Cancel
        </button>
        <button
          type="button"
          class="button primary danger"
          disabled={count === 0}
          onClick={() => props.onPurge({resolved, orphaned})}
        >
          {count === 0 ? 'Nothing to purge' : `Delete ${count} thread${count === 1 ? '' : 's'}`}
        </button>
      </div>
    </Modal>
  )
}

function PurgeGroup(props: {label: string; threads: Thread[]; checked: boolean; onChange(checked: boolean): void}) {
  const empty = props.threads.length === 0
  return (
    <fieldset class="purge-group" disabled={empty}>
      <label class="check">
        <input type="checkbox" checked={props.checked && !empty} onChange={(event) => props.onChange(event.currentTarget.checked)} />
        <span>
          {props.label} <span class="count">({props.threads.length})</span>
        </span>
      </label>
      {!empty && (
        <ul class="purge-list">
          {props.threads.map((thread) => (
            <li key={thread.id}>
              <span class="purge-quote">{quoteText(thread) || 'Whole document'}</span>
              <span class="purge-meta">
                {thread.comments[0]?.author || 'Unknown'} · {thread.comments.length} comment{thread.comments.length === 1 ? '' : 's'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  )
}
