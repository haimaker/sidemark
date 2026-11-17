interface ToolbarProps {
  fileName: string
  canWriteInPlace: boolean
  dirty: boolean
  canUndo: boolean
  canRedo: boolean
  view: 'document' | 'source'
  showResolved: boolean
  resolvedTotal: number
  purgeable: number
  author: string
  privacyOpen: boolean
  onPrivacy(): void
  onOpen(): void
  onSave(): void
  onUndo(): void
  onRedo(): void
  onView(view: 'document' | 'source'): void
  onShowResolved(show: boolean): void
  onPurge(): void
  onAuthor(): void
}

const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

export function Toolbar(props: ToolbarProps) {
  return (
    <header class="toolbar">
      <div class="toolbar-file">
        <span class="brand" aria-hidden="true">
          CommentMark
        </span>
        <span class="file-name" title={props.fileName}>
          {props.fileName}
        </span>
        <span class={`save-state${props.dirty ? ' is-dirty' : ''}`} data-testid="save-state">
          {props.dirty ? 'Unsaved changes' : 'Saved'}
        </span>
        <button
          type="button"
          class="privacy-badge"
          aria-expanded={props.privacyOpen}
          aria-controls="privacy-panel"
          onClick={props.onPrivacy}
          title="What local only means"
        >
          <span class="privacy-dot" aria-hidden="true" />
          <span>
            Local only<span class="privacy-long">: your file never leaves this device</span>
          </span>
        </button>
      </div>
      <div class="toolbar-actions" role="toolbar" aria-label="Document">
        <button type="button" class="button" onClick={props.onOpen} title={`Open a Markdown file from this device. It is read by your browser, not uploaded. (${mod}O)`}>
          Open
        </button>
        <button
          type="button"
          class="button"
          onClick={props.onSave}
          title={
            props.canWriteInPlace
              ? `Save back to ${props.fileName} on this device. Nothing is uploaded. (${mod}S)`
              : `Download ${props.fileName} to this device; it was not opened with write access. Nothing is uploaded. (${mod}S)`
          }
        >
          {props.canWriteInPlace ? 'Save' : 'Download'}
        </button>
        <span class="divider" />
        <button type="button" class="button" onClick={props.onUndo} disabled={!props.canUndo} title={`Undo (${mod}Z)`}>
          Undo
        </button>
        <button type="button" class="button" onClick={props.onRedo} disabled={!props.canRedo} title={`Redo (${mod}Shift+Z)`}>
          Redo
        </button>
        <span class="divider" />
        <div class="segmented" role="group" aria-label="View">
          <button type="button" aria-pressed={props.view === 'document'} onClick={() => props.onView('document')}>
            Document
          </button>
          <button type="button" aria-pressed={props.view === 'source'} onClick={() => props.onView('source')}>
            Source
          </button>
        </div>
        <label class="check toolbar-check">
          <input type="checkbox" checked={props.showResolved} onChange={(event) => props.onShowResolved(event.currentTarget.checked)} />
          <span>
            Show resolved{props.resolvedTotal > 0 && <span class="count"> ({props.resolvedTotal})</span>}
          </span>
        </label>
        <button type="button" class="button" onClick={props.onPurge} disabled={props.purgeable === 0}>
          Purge…
        </button>
        <span class="divider" />
        <button type="button" class="button author-button" onClick={props.onAuthor} title="Change the name written on your comments">
          {props.author || 'Set your name'}
        </button>
      </div>
    </header>
  )
}
