import type {ComponentChildren} from 'preact'
import {REPO_URL} from '../project'

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
  theme: 'light' | 'dark'
  onToggleTheme(): void
}

const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

export function Toolbar(props: ToolbarProps) {
  return (
    <header class="toolbar">
      <div class="toolbar-file">
        <a class="brand" href={REPO_URL} target="_blank" rel="noopener noreferrer" title="About CommentMark: the specification and source on GitHub">
          CommentMark
        </a>
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
        <button type="button" class="button quiet icon-button" onClick={props.onUndo} disabled={!props.canUndo} aria-label="Undo" title={`Undo (${mod}Z)`}>
          <Icon>
            <path d="M8.5 14.5 3.5 9.5l5-5" />
            <path d="M3.5 9.5h11a6 6 0 0 1 0 12h-3.5" />
          </Icon>
        </button>
        <button type="button" class="button quiet icon-button" onClick={props.onRedo} disabled={!props.canRedo} aria-label="Redo" title={`Redo (${mod}Shift+Z)`}>
          <Icon>
            <path d="m15.5 14.5 5-5-5-5" />
            <path d="M20.5 9.5h-11a6 6 0 0 0 0 12H13" />
          </Icon>
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
        <button type="button" class="button quiet" onClick={props.onPurge} disabled={props.purgeable === 0}>
          Purge…
        </button>
        <span class="divider" />
        <button type="button" class="button quiet author-button" onClick={props.onAuthor} title="Change the name written on your comments">
          {props.author || 'Set your name'}
        </button>
        <a class="button quiet" href={REPO_URL} target="_blank" rel="noopener noreferrer" title="What CommentMark is: the specification and source on GitHub">
          About
        </a>
        <ThemeToggle theme={props.theme} onToggle={props.onToggleTheme} />
      </div>
    </header>
  )
}

/** Shows the theme the button switches to: a moon in light, a sun in dark. */
function ThemeToggle({theme, onToggle}: {theme: 'light' | 'dark'; onToggle(): void}) {
  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
  return (
    <button type="button" class="button quiet icon-button" onClick={onToggle} aria-label={label} title={label} data-testid="theme-toggle">
      <Icon>
        {theme === 'dark' ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
          </>
        ) : (
          <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7z" />
        )}
      </Icon>
    </button>
  )
}

/** One stroke weight and size for every toolbar icon. */
function Icon({children}: {children: ComponentChildren}) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}
