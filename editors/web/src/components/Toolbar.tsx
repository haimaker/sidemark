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
          Sidemark
        </span>
        <span class="file-name" title={props.fileName}>
          {props.fileName}
        </span>
        <span class={`save-state${props.dirty ? ' is-dirty' : ''}`} data-testid="save-state">
          {props.dirty ? 'Unsaved changes' : 'Saved'}
        </span>
      </div>
      <div class="toolbar-actions" role="toolbar" aria-label="Document">
        <button type="button" class="button" onClick={props.onOpen} title={`Open a Markdown file (${mod}O)`}>
          Open
        </button>
        <button
          type="button"
          class="button"
          onClick={props.onSave}
          title={
            props.canWriteInPlace
              ? `Save back to ${props.fileName} (${mod}S)`
              : `Download ${props.fileName}; this file was not opened with write access (${mod}S)`
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
