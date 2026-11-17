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
import {countRemoteImages, type BodyRenderResult} from './body/render'
import {AuthorDialog, ConfirmDialog, PurgeDialog, type ConfirmRequest} from './components/Dialogs'
import {DocumentView} from './components/DocumentView'
import {PrivacyPanel} from './components/PrivacyPanel'
import {Margin, type MarginItem} from './components/Margin'
import {SourceView} from './components/SourceView'
import {Composer, DraftBox, ThreadCard, type ThreadActions} from './components/ThreadCard'
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
import {followSelection, hasText, mapRange, sameRange, type Draft} from './model/draft'
import {describeError} from './model/errors'
import {groupThreads, hiddenNodes, highlightsFor, PENDING_ID, purgeCandidates, rangeOf} from './model/groups'
import * as H from './model/history'
import {INTRO_DISMISSED, readPref, writePref} from './model/prefs'
import sample from './sample.md?raw'

const SAMPLE_NAME = 'sidemark-sample.md'

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
  /** Writing a whole-document comment. */
  const [docComposing, setDocComposing] = useState(false)
  /** The body selection, as a source range. */
  const [selection, setSelectionState] = useState<SourceRange | null>(null)
  const setSelection = useCallback((next: SourceRange | null) => {
    setSelectionState((current) => (current && next && sameRange(current, next)) || current === next ? current : next)
  }, [])
  /** The new-comment box that follows the selection (see model/draft.ts). */
  const [draft, setDraftState] = useState<Draft | null>(null)
  const draftRef = useRef(draft)
  const setDraft = useCallback((next: Draft | null) => {
    draftRef.current = next
    setDraftState(next)
  }, [])
  const draftInput = useRef<HTMLTextAreaElement>(null)
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const remoteImages = useMemo(() => countRemoteImages(doc.root), [doc])
  const [showIntro, setShowIntro] = useState(() => readPref(INTRO_DISMISSED) !== '1')
  const [rendered, setRendered] = useState<BodyRenderResult | null>(null)
  const [message, setMessage] = useState<Message | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [purging, setPurging] = useState(false)
  const [authorPrompt, setAuthorPrompt] = useState<{reason: string | null; resolve(author: string | null): void} | null>(null)
  const [dragging, setDragging] = useState(false)
  const wide = useMediaQuery('(min-width: 960px)')
  const fileInput = useRef<HTMLInputElement>(null)

  const groups = useMemo(() => groupThreads(doc, showResolved), [doc, showResolved])
  // The draft's range is highlighted once the person is writing in the box;
  // before that the live browser selection shows it (re-rendering the body
  // would destroy that selection).
  const pendingRange = draft?.engaged && !draft.stale ? draft.range : null
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
  /** Core's refusal for a range, checked before anyone types. */
  const checkRange = useCallback((range: SourceRange): string | null => {
    try {
      createThread(H.current(historyRef.current), {range, author: '', comment: 'check'})
      return null
    } catch (error) {
      return describeError(error)
    }
  }, [])

  // The box follows the selection. Short debounce: a drag fires many
  // selection changes, and each check re-parses the document.
  useEffect(() => {
    const update = () => {
      const current = draftRef.current
      const next = followSelection(current, selection, checkRange)
      if (next === current) return
      setDraft(next)
      // A new box sits exactly beside its selection.
      if (next && !next.engaged && (!current || !sameRange(current.range, next.range))) setFocusedId(null)
    }
    if (!selection) return update()
    const timer = setTimeout(update, 80)
    return () => clearTimeout(timer)
  }, [selection, checkRange, setDraft])

  // Keep the draft's range pointing at the same text when the source changes.
  const draftSource = useRef(source)
  useEffect(() => {
    const before = draftSource.current
    draftSource.current = source
    const current = draftRef.current
    if (!current || before === source) return
    const range = mapRange(before, source, current.range)
    if (range) setDraft({...current, range})
    else if (hasText(current)) setDraft({...current, stale: true})
    else setDraft(null)
  }, [source, setDraft])

  const engageDraft = useCallback(() => {
    const current = draftRef.current
    if (current && !current.engaged) setDraft({...current, engaged: true})
    setFocusedId(null)
  }, [setDraft])

  const cancelDraft = useCallback(() => {
    setDraft(null)
    // Forget the selection too, so selecting the same text again brings the box back.
    setSelection(null)
    window.getSelection()?.removeAllRanges()
  }, [setDraft, setSelection])

  const submitDraft = useCallback(async () => {
    const current = draftRef.current
    if (!current || current.stale || current.error) return
    const by = await ensureAuthor()
    if (by === null) return
    let id: string | null = null
    const ok = apply((s) => {
      const created = createThread(s, {range: current.range, author: by, comment: current.text})
      id = created.id
      return created.source
    })
    if (ok) {
      setDraft(null)
      setSelection(null)
      setFocusedId(id)
      setSheetOpen(false)
    }
  }, [apply, ensureAuthor, setDraft, setSelection])

  /** Ctrl/⌘+Alt+M: move into the comment box for the current selection. */
  const focusDraft = useCallback(() => {
    const input = draftInput.current
    if (input) input.focus()
    else notify(draftRef.current?.error ?? 'Select some text in the document to comment on it.', draftRef.current?.error ? 'error' : 'info')
  }, [notify])

  const startDocumentComment = useCallback(() => {
    setDocComposing(true)
    setFocusedId(null)
  }, [])

  const submitDocumentComment = useCallback(
    async (text: string) => {
      const by = await ensureAuthor()
      if (by === null) return false
      let id: string | null = null
      const ok = apply((s) => {
        const created = createThread(s, {range: null, author: by, comment: text})
        id = created.id
        return created.source
      })
      if (ok) {
        setDocComposing(false)
        setFocusedId(id)
      }
      return ok
    },
    [apply, ensureAuthor]
  )

  const dismissIntro = useCallback(() => {
    writePref(INTRO_DISMISSED, '1')
    setShowIntro(false)
  }, [])

  // --- Undo / redo ------------------------------------------------------------
  const undo = useCallback(() => setHistory(H.undo(historyRef.current)), [setHistory])
  const redo = useCallback(() => setHistory(H.redo(historyRef.current)), [setHistory])

  // --- Files ----------------------------------------------------------------
  const load = useCallback(
    (opened: OpenedFile) => {
      setHistory(H.createHistory(opened.source))
      setFile({name: opened.name, handle: opened.handle, lastModified: opened.lastModified})
      setDraft(null)
      setDocComposing(false)
      setFocusedId(null)
      setSelection(null)
      setShowIntro(false)
      window.scrollTo(0, 0)
      const count = parse(opened.source).threads.length
      notify(`Opened ${opened.name} on this device (nothing uploaded): ${count} thread${count === 1 ? '' : 's'}.`)
    },
    [setHistory, notify, setDraft, setSelection]
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
          notify(`Saved ${file.name} on this device. Nothing was uploaded.`)
        } else {
          download(file.name, next)
          notify(`Downloaded ${file.name} to this device. Nothing was uploaded.`)
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
        focusDraft()
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
  }, [save, open, focusDraft, undo, redo])

  // --- Margin ---------------------------------------------------------------
  const focusThread = useCallback((id: string) => {
    setFocusedId((current) => (current === id ? current : id))
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

  const draftBox = () =>
    draft && (
      <DraftBox
        draft={draft}
        author={author}
        inputRef={draftInput}
        onEngage={engageDraft}
        onText={(text) => setDraft({...draftRef.current!, text})}
        onSubmit={() => void submitDraft()}
        onCancel={cancelDraft}
      />
    )

  const marginItems: MarginItem[] = useMemo(() => {
    const items: MarginItem[] = []
    // First in the DOM, so Tab reaches the box before the other threads.
    if (draft) items.push({id: PENDING_ID, start: draft.range.start, render: draftBox})
    for (const thread of groups.anchored) {
      items.push({id: thread.id, start: rangeOf(thread)!.start, render: () => card(thread, false)})
    }
    return items
    // `card` and `draftBox` close over the values listed here.
  }, [groups, draft, focusedId, doc, actions, author, submitDraft, cancelDraft, engageDraft, focusThread])

  /** The margin keeps the focused thread beside its text; otherwise the comment box. */
  const marginFocus = focusedId ?? (draft ? PENDING_ID : null)

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
        privacyOpen={privacyOpen}
        onPrivacy={() => setPrivacyOpen((open) => !open)}
      />
      {privacyOpen && <PrivacyPanel onClose={() => setPrivacyOpen(false)} />}
      <input ref={fileInput} type="file" accept={MARKDOWN_ACCEPT} hidden onChange={onFileInput} data-testid="file-input" />

      {view === 'source' ? (
        <main class="page page-source">
          <SourceView doc={doc} />
        </main>
      ) : (
        <main class="page">
          <div class="doc-column">
            {showIntro && <Intro onOpen={open} onDismiss={dismissIntro} onPrivacy={() => setPrivacyOpen(true)} />}

            {remoteImages > 0 && (
              <p class="remote-note" role="note">
                This document has {remoteImages} remote image{remoteImages === 1 ? '' : 's'}.{' '}
                {remoteImages === 1 ? 'It is' : 'They are'} not loaded, so opening the document contacted no other server. Use{' '}
                <em>open from…</em> on an image to view it in a new tab.
              </p>
            )}

            <section class={`doc-comments${counts.document ? '' : ' is-empty'}`} aria-labelledby="doc-group">
              <h2 id="doc-group" class={counts.document ? 'group-title' : 'visually-hidden'}>
                Comments on this document <span class="count">{counts.document || ''}</span>
              </h2>
              {groups.document.map((thread) => card(thread, false))}
              {docComposing ? (
                <Composer
                  title="New comment on the whole document"
                  author={author}
                  onSubmit={submitDocumentComment}
                  onCancel={() => setDocComposing(false)}
                />
              ) : (
                <button type="button" class="link-button doc-comment-add" onClick={startDocumentComment}>
                  Comment on the whole document
                </button>
              )}
              {groups.hiddenResolved.document > 0 && <HiddenNote count={groups.hiddenResolved.document} />}
            </section>

            <DocumentView
              doc={doc}
              highlights={highlights}
              hidden={hidden}
              focusedId={focusedId ?? (draft?.engaged ? PENDING_ID : null)}
              onRendered={setRendered}
              onSelection={setSelection}
              onHighlightClick={onHighlightClick}
              onBackgroundClick={() => setFocusedId(null)}
            />

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

          {wide && <Margin items={marginItems} focusedId={marginFocus} rendered={rendered} layoutKey={highlights} />}
        </main>
      )}

      {/* Phone width: no margin. The comment box and a tapped thread dock at the bottom. */}
      {!wide && view === 'document' && (draft || (sheetOpen && focusedAnchored)) && (
        <div class="sheet" role="region" aria-label="Comment panel">
          {sheetOpen && focusedAnchored && (
            <>
              <button type="button" class="button quiet sheet-close" onClick={() => setSheetOpen(false)}>
                Close
              </button>
              {card(focusedAnchored, true, () => setSheetOpen(false))}
            </>
          )}
          {draftBox()}
        </div>
      )}

      {dragging && (
        <div class="drop-overlay" aria-hidden="true">
          <p>
            Drop a Markdown file to open it
            <span class="drop-note">It is read on this device, not uploaded.</span>
          </p>
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

function Intro({onOpen, onDismiss, onPrivacy}: {onOpen(): void; onDismiss(): void; onPrivacy(): void}) {
  return (
    <aside class="intro" aria-label="Getting started">
      <div>
        <p class="intro-title">Private: your files stay on this device</p>
        <p>
          Nothing you open here is uploaded. Your browser reads the file and writes it back; there is no server, account or tracking.{' '}
          <button type="button" class="link-button inline" onClick={onPrivacy}>
            How do I know?
          </button>
        </p>
        <p>
          To comment on your own Markdown file, drag a <code>.md</code> file from your computer and drop it anywhere on this page, or{' '}
          <button type="button" class="link-button inline" onClick={onOpen}>
            open a file
          </button>
          . Saving writes the comments back into the file, or downloads a copy where the browser cannot write to it.
        </p>
      </div>
      <button type="button" class="button quiet intro-dismiss" onClick={onDismiss}>
        Got it
      </button>
    </aside>
  )
}
