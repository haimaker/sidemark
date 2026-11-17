/**
 * The editor. One source string is the whole document state: every action
 * calls a pure `@sidemark/core` operation, gets a new source string, and the
 * view re-parses and re-renders from it. History is a list of strings.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from 'preact/hooks'
import {
  addReply,
  createThread,
  deleteComment,
  deleteThread,
  editComment,
  maintain,
  parse,
  purge,
  setStatus,
  type SourceRange
} from '@sidemark/core'
import type {BodyRenderResult} from './body/render'
import {AuthorDialog, ConfirmDialog, PurgeDialog, type ConfirmRequest} from './components/Dialogs'
import {DocumentView, type BodySelection} from './components/DocumentView'
import {Margin, type MarginItem} from './components/Margin'
import {SourceView} from './components/SourceView'
import {Composer, ThreadCard, type ThreadActions} from './components/ThreadCard'
import {Toolbar} from './components/Toolbar'
import {
  canPickWithHandle,
  changedOnDisk,
  download,
  fromDataTransfer,
  fromFile,
  MARKDOWN_ACCEPT,
  pickWithHandle,
  writeToHandle,
  type OpenedFile
} from './files'
import {isPrimaryModifier, isTextField, useMediaQuery} from './hooks'
import {loadAuthor, saveAuthor} from './model/author'
import {describeError} from './model/errors'
import {groupThreads, hiddenNodes, highlightsFor, PENDING_ID, purgeCandidates, rangeOf} from './model/groups'
import * as H from './model/history'
import sample from './sample.md?raw'

const SAMPLE_NAME = 'sidemark-sample.md'

type Composing = {kind: 'anchored'; range: SourceRange} | {kind: 'document'} | null
type Message = {text: string; tone: 'info' | 'error'; id: number}

interface FileInfo {
  name: string
  handle: OpenedFile['handle']
  lastModified: number | null
}

export function App() {
  // --- Document state -------------------------------------------------------
  const [history, setHistoryState] = useState(() => H.createHistory(sample))
  const historyRef = useRef(history)
  const setHistory = useCallback((next: H.History) => {
    historyRef.current = next
    setHistoryState(next)
  }, [])
  const [file, setFile] = useState<FileInfo>({name: SAMPLE_NAME, handle: null, lastModified: null})
  const source = H.current(history)
  const doc = useMemo(() => parse(source), [source])
  const dirty = H.isDirty(history)

  // --- View state -----------------------------------------------------------
  const [author, setAuthor] = useState(loadAuthor)
  const [showResolved, setShowResolved] = useState(false)
  const [view, setView] = useState<'document' | 'source'>('document')
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [composing, setComposing] = useState<Composing>(null)
  const [selection, setSelection] = useState<BodySelection | null>(null)
  const [rendered, setRendered] = useState<BodyRenderResult | null>(null)
  const [message, setMessage] = useState<Message | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [purging, setPurging] = useState(false)
  const [authorPrompt, setAuthorPrompt] = useState<{reason: string | null; resolve(author: string | null): void} | null>(null)
  const [dragging, setDragging] = useState(false)
  const wide = useMediaQuery('(min-width: 960px)')
  const fileInput = useRef<HTMLInputElement>(null)

  const groups = useMemo(() => groupThreads(doc, showResolved), [doc, showResolved])
  const pendingRange = composing?.kind === 'anchored' ? composing.range : null
  const highlights = useMemo(() => highlightsFor(groups, pendingRange), [groups, pendingRange])
  const hidden = useMemo(() => hiddenNodes(doc), [doc])

  // Drop focus on threads that no longer exist or are hidden.
  useEffect(() => {
    if (!focusedId || focusedId === PENDING_ID) return
    const visible = [...groups.anchored, ...groups.detached, ...groups.document].some((t) => t.id === focusedId)
    if (!visible) setFocusedId(null)
  }, [groups, focusedId])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [view])

  useEffect(() => {
    document.title = `${dirty ? '• ' : ''}${file.name} · Sidemark`
  }, [dirty, file.name])

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (H.isDirty(historyRef.current)) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  // --- Messages -------------------------------------------------------------
  const notify = useCallback((text: string, tone: Message['tone'] = 'info') => {
    setMessage({text, tone, id: Date.now()})
  }, [])
  useEffect(() => {
    if (!message) return
    const timer = setTimeout(() => setMessage(null), message.tone === 'error' ? 8000 : 4000)
    return () => clearTimeout(timer)
  }, [message])

  // --- Author ---------------------------------------------------------------
  const authorRef = useRef(author)
  authorRef.current = author
  /** The author, asking for it once if it is not known yet. */
  const ensureAuthor = useCallback(
    (reason: string | null = 'Comments are signed with your name. Choose it once; you can change it later.') =>
      new Promise<string | null>((resolve) => {
        if (authorRef.current) resolve(authorRef.current)
        else setAuthorPrompt({reason, resolve})
      }),
    []
  )

  // --- Applying operations --------------------------------------------------
  /** Run a core operation on the current source; record it in history. */
  const apply = useCallback(
    (operation: (source: string) => string, success?: string): boolean => {
      try {
        const next = operation(H.current(historyRef.current))
        setHistory(H.commit(historyRef.current, next))
        if (success) notify(success)
        return true
      } catch (error) {
        notify(describeError(error), 'error')
        return false
      }
    },
    [notify, setHistory]
  )

  const actions: ThreadActions = useMemo(
    () => ({
      async reply(threadId, text) {
        const by = await ensureAuthor()
        return by !== null && apply((s) => addReply(s, threadId, {author: by, comment: text}))
      },
      async setStatus(threadId, status, note) {
        const by = await ensureAuthor()
        if (by === null) return false
        const ok = apply(
          (s) => setStatus(s, threadId, {status, author: by, comment: note}),
          status === 'resolved' && !showResolved ? 'Thread resolved and hidden. Show resolved threads to see it.' : undefined
        )
        return ok
      },
      async edit(threadId, index, text) {
        return apply((s) => editComment(s, {threadId, index}, text))
      },
      async deleteComment(threadId, index) {
        return apply((s) => deleteComment(s, {threadId, index}), 'Comment deleted.')
      },
      async deleteThread(threadId) {
        const ok = apply((s) => deleteThread(s, threadId), 'Thread deleted.')
        if (ok) setFocusedId(null)
        return ok
      }
    }),
    [apply, ensureAuthor, showResolved]
  )

  // --- New comments ---------------------------------------------------------
  const startComment = useCallback(() => {
    if (!selection) return
    // Ask core now, so a range it cannot anchor is reported before anyone types.
    try {
      createThread(H.current(historyRef.current), {range: selection.range, author: '', comment: 'check'})
    } catch (error) {
      notify(describeError(error), 'error')
      return
    }
    setComposing({kind: 'anchored', range: selection.range})
    setFocusedId(PENDING_ID)
    setSheetOpen(true)
    window.getSelection()?.removeAllRanges()
  }, [selection, notify])

  const startDocumentComment = useCallback(() => {
    setComposing({kind: 'document'})
    setFocusedId(null)
  }, [])

  const cancelComposer = useCallback(() => {
    setComposing(null)
    setFocusedId(null)
    setSheetOpen(false)
  }, [])

  const submitComposer = useCallback(
    async (text: string) => {
      if (!composing) return false
      const by = await ensureAuthor()
      if (by === null) return false
      let id: string | null = null
      const ok = apply((s) => {
        const created = createThread(s, {range: composing.kind === 'anchored' ? composing.range : null, author: by, comment: text})
        id = created.id
        return created.source
      })
      if (ok) {
        setComposing(null)
        setFocusedId(id)
        setSheetOpen(false)
      }
      return ok
    },
    [composing, apply, ensureAuthor]
  )

  // --- Undo / redo ------------------------------------------------------------
  const undo = useCallback(() => {
    setComposing(null)
    setHistory(H.undo(historyRef.current))
  }, [setHistory])
  const redo = useCallback(() => {
    setComposing(null)
    setHistory(H.redo(historyRef.current))
  }, [setHistory])

  // --- Files ----------------------------------------------------------------
  const load = useCallback(
    (opened: OpenedFile) => {
      setHistory(H.createHistory(opened.source))
      setFile({name: opened.name, handle: opened.handle, lastModified: opened.lastModified})
      setComposing(null)
      setFocusedId(null)
      setSelection(null)
      window.scrollTo(0, 0)
      const count = parse(opened.source).threads.length
      notify(`Opened ${opened.name}: ${count} thread${count === 1 ? '' : 's'}.`)
    },
    [setHistory, notify]
  )

  /** Run `then` now, or after confirming that unsaved changes may be lost. */
  const unlessDirty = useCallback((then: () => void) => {
    if (!H.isDirty(historyRef.current)) return then()
    setConfirm({
      title: 'Discard unsaved changes?',
      body: 'Your comments on this document have not been saved. Opening another file discards them.',
      confirmLabel: 'Discard and open',
      danger: true,
      onConfirm: then
    })
  }, [])

  const open = useCallback(() => {
    unlessDirty(async () => {
      if (!canPickWithHandle()) {
        fileInput.current?.click()
        return
      }
      try {
        const opened = await pickWithHandle()
        if (opened) load(opened)
      } catch (error) {
        notify(`Could not open the file: ${describeError(error)}`, 'error')
      }
    })
  }, [unlessDirty, load, notify])

  const onFileInput = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement
    const chosen = input.files?.[0]
    input.value = ''
    if (chosen) load(await fromFile(chosen))
  }

  const save = useCallback(async () => {
    let next = H.current(historyRef.current)
    // §9.6: refresh quotes, repair anchors, remove stray anchors.
    try {
      const maintained = maintain(next)
      if (maintained !== next) {
        setHistory(H.commit(historyRef.current, maintained))
        next = maintained
      }
    } catch (error) {
      notify(`Saved without maintenance: ${describeError(error)}`, 'error')
    }
    const write = async () => {
      try {
        if (file.handle) {
          const lastModified = await writeToHandle(file.handle, next)
          setFile((f) => ({...f, lastModified}))
          notify(`Saved ${file.name}.`)
        } else {
          download(file.name, next)
          notify(`Downloaded ${file.name}.`)
        }
        setHistory(H.markSaved(historyRef.current, next))
      } catch (error) {
        notify(`Could not save: ${describeError(error)}`, 'error')
      }
    }
    if (file.handle && (await changedOnDisk({...file, source: next}))) {
      setConfirm({
        title: 'The file changed on disk',
        body: `${file.name} was changed by another program after you opened it. Saving replaces those changes with this version.`,
        confirmLabel: 'Overwrite',
        danger: true,
        onConfirm: () => void write()
      })
      return
    }
    await write()
  }, [file, notify, setHistory])

  // Drag and drop anywhere on the page.
  useEffect(() => {
    let depth = 0
    const hasFiles = (event: DragEvent) => [...(event.dataTransfer?.types ?? [])].includes('Files')
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      depth++
      setDragging(true)
    }
    const leave = () => {
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const over = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault()
    }
    const drop = (event: DragEvent) => {
      if (!hasFiles(event) || !event.dataTransfer) return
      event.preventDefault()
      depth = 0
      setDragging(false)
      const pending = fromDataTransfer(event.dataTransfer)
      unlessDirty(async () => {
        try {
          const opened = await pending
          if (opened) load(opened)
        } catch (error) {
          notify(`Could not open the file: ${describeError(error)}`, 'error')
        }
      })
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [unlessDirty, load, notify])

  // --- Keyboard -------------------------------------------------------------
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return
      const primary = isPrimaryModifier(event)
      const key = event.key.toLowerCase()
      if (primary && key === 's') {
        event.preventDefault()
        void save()
      } else if (primary && key === 'o') {
        event.preventDefault()
        open()
      } else if (primary && event.altKey && event.code === 'KeyM') {
        event.preventDefault()
        startComment()
      } else if (primary && !isTextField(event.target) && (key === 'z' || key === 'y')) {
        event.preventDefault()
        if (key === 'y' || event.shiftKey) redo()
        else undo()
      } else if (key === 'escape' && !isTextField(event.target)) {
        setFocusedId(null)
        setSheetOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save, open, startComment, undo, redo])

  // --- Margin ---------------------------------------------------------------
  const focusThread = useCallback((id: string) => {
    setFocusedId((current) => (current === id ? current : id))
    setComposing((c) => (c && id !== PENDING_ID ? null : c))
  }, [])

  const onHighlightClick = useCallback(
    (ids: string[]) => {
      const byLength = (id: string) => {
        const t = doc.threads.find((x) => x.id === id)
        const r = t ? rangeOf(t) : null
        return r ? r.end - r.start : Infinity
      }
      let next = [...ids].sort((a, b) => byLength(a) - byLength(b))[0]!
      // Clicking the same place again cycles through overlapping threads.
      if (focusedId && ids.includes(focusedId) && ids.length > 1) next = ids[(ids.indexOf(focusedId) + 1) % ids.length]!
      setComposing(null)
      setFocusedId(next)
      setSheetOpen(true)
    },
    [doc, focusedId]
  )

  const card = (thread: (typeof groups.anchored)[number], showQuote: boolean, onClose?: () => void) => (
    <ThreadCard
      key={thread.id}
      thread={thread}
      doc={doc}
      focused={focusedId === thread.id}
      showQuote={showQuote}
      actions={actions}
      onFocus={focusThread}
      onClose={onClose ?? (() => setFocusedId(null))}
    />
  )

  const composer = (title: string) => (
    <Composer title={title} author={author} onSubmit={submitComposer} onCancel={cancelComposer} />
  )

  const marginItems: MarginItem[] = useMemo(() => {
    const items: MarginItem[] = groups.anchored.map((thread) => ({
      id: thread.id,
      start: rangeOf(thread)!.start,
      render: () => card(thread, false)
    }))
    if (composing?.kind === 'anchored') {
      items.push({id: PENDING_ID, start: composing.range.start, render: () => composer('New comment')})
    }
    return items
    // `card` and `composer` close over the values listed here.
  }, [groups, composing, focusedId, doc, actions, author, submitComposer, cancelComposer, focusThread])

  const focusedAnchored = groups.anchored.find((t) => t.id === focusedId) ?? null

  // --- Render ---------------------------------------------------------------
  const counts = {
    anchored: groups.anchored.length,
    detached: groups.detached.length,
    document: groups.document.length
  }
  const candidates = purgeCandidates(doc)

  return (
    <div class={`app${wide ? ' is-wide' : ' is-narrow'}`}>
      <Toolbar
        fileName={file.name}
        canWriteInPlace={file.handle !== null}
        dirty={dirty}
        canUndo={H.canUndo(history)}
        canRedo={H.canRedo(history)}
        view={view}
        showResolved={showResolved}
        resolvedTotal={candidates.resolved.length}
        purgeable={candidates.resolved.length + candidates.orphaned.length}
        author={author}
        onOpen={open}
        onSave={() => void save()}
        onUndo={undo}
        onRedo={redo}
        onView={setView}
        onShowResolved={setShowResolved}
        onPurge={() => setPurging(true)}
        onAuthor={() => setAuthorPrompt({reason: null, resolve: () => {}})}
      />
      <input ref={fileInput} type="file" accept={MARKDOWN_ACCEPT} hidden onChange={onFileInput} data-testid="file-input" />

      {view === 'source' ? (
        <main class="page page-source">
          <SourceView doc={doc} />
        </main>
      ) : (
        <main class="page">
          <div class="doc-column">
            <DocumentView
              doc={doc}
              highlights={highlights}
              hidden={hidden}
              focusedId={focusedId}
              onRendered={setRendered}
              onSelection={setSelection}
              onHighlightClick={onHighlightClick}
              onBackgroundClick={() => {
                if (!composing) setFocusedId(null)
              }}
            />
            {selection && !composing && (
              <button
                type="button"
                class="button primary add-comment"
                style={wide ? {top: `${selection.bottom + 6}px`, left: `min(${Math.max(0, selection.right - 48)}px, calc(100% - 120px))`} : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onClick={startComment}
                title="Comment on the selected text (Ctrl+Alt+M)"
              >
                Comment
              </button>
            )}

            {!wide && (
              <section class="group" aria-labelledby="text-group">
                <h2 id="text-group" class="group-title">
                  In the text <span class="count">{counts.anchored || ''}</span>
                </h2>
                {groups.anchored.map((thread) => card(thread, true))}
                {counts.anchored === 0 && <p class="group-note">Select text in the document to comment on it.</p>}
                {groups.hiddenResolved.anchored > 0 && <HiddenNote count={groups.hiddenResolved.anchored} />}
              </section>
            )}

            <section class="group" aria-labelledby="doc-group">
              <h2 id="doc-group" class="group-title">
                About the whole document <span class="count">{counts.document || ''}</span>
              </h2>
              {groups.document.map((thread) => card(thread, false))}
              {composing?.kind === 'document' ? (
                composer('New comment on the whole document')
              ) : (
                <button type="button" class="button" onClick={startDocumentComment}>
                  Comment on the document
                </button>
              )}
              {groups.hiddenResolved.document > 0 && <HiddenNote count={groups.hiddenResolved.document} />}
            </section>

            {(counts.detached > 0 || groups.hiddenResolved.detached > 0) && (
              <section class="group" aria-labelledby="detached-group">
                <h2 id="detached-group" class="group-title">
                  Detached <span class="count">{counts.detached || ''}</span>
                </h2>
                <p class="group-note">The text these threads were about can no longer be found. Each shows its last known quote.</p>
                {groups.detached.map((thread) => card(thread, true))}
                {groups.hiddenResolved.detached > 0 && <HiddenNote count={groups.hiddenResolved.detached} />}
              </section>
            )}


            {doc.malformedRows.length > 0 && (
              <p class="group-note warning">
                The comments table has {doc.malformedRows.length} row{doc.malformedRows.length === 1 ? '' : 's'} without a valid
                Ref. They belong to no thread and are kept unchanged.
              </p>
            )}
          </div>

          {wide && <Margin items={marginItems} focusedId={focusedId} rendered={rendered} layoutKey={highlights} />}
        </main>
      )}

      {!wide && view === 'document' && sheetOpen && (composing?.kind === 'anchored' || focusedAnchored) && (
        <div class="sheet" role="dialog" aria-label="Comment thread">
          <button type="button" class="button quiet sheet-close" onClick={() => (composing ? cancelComposer() : setSheetOpen(false))}>
            Close
          </button>
          {composing?.kind === 'anchored' ? composer('New comment') : card(focusedAnchored!, true, () => setSheetOpen(false))}
        </div>
      )}

      {dragging && (
        <div class="drop-overlay" aria-hidden="true">
          <p>Drop a Markdown file to open it</p>
        </div>
      )}

      <div class={`toast${message ? ' is-visible' : ''}${message?.tone === 'error' ? ' is-error' : ''}`} role="status" aria-live="polite">
        {message?.text}
      </div>

      {confirm && <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />}
      {purging && (
        <PurgeDialog
          candidates={candidates}
          onClose={() => setPurging(false)}
          onPurge={(options) => {
            setPurging(false)
            const removed = new Set([
              ...(options.resolved ? candidates.resolved : []),
              ...(options.orphaned ? candidates.orphaned : [])
            ]).size
            apply((s) => purge(s, options), `Deleted ${removed} thread${removed === 1 ? '' : 's'}. Undo is available.`)
          }}
        />
      )}
      {authorPrompt && (
        <AuthorDialog
          current={author}
          reason={authorPrompt.reason}
          onClose={() => {
            authorPrompt.resolve(null)
            setAuthorPrompt(null)
          }}
          onSave={(value) => {
            saveAuthor(value)
            authorRef.current = value
            setAuthor(value)
            authorPrompt.resolve(value)
            setAuthorPrompt(null)
          }}
        />
      )}
    </div>
  )
}

function HiddenNote({count}: {count: number}) {
  return (
    <p class="group-note">
      {count} resolved thread{count === 1 ? '' : 's'} hidden.
    </p>
  )
}
