import {useEffect, useLayoutEffect, useRef} from 'preact/hooks'
import type {Nodes} from 'mdast'
import type {SidemarkDocument, SourceRange} from '@sidemark/core'
import {renderBody, type BodyRenderResult, type Highlight} from '../body/render'
import {PENDING_ID} from '../model/groups'

export interface BodySelection {
  range: SourceRange
  /** Selection rectangle relative to the document column. */
  top: number
  bottom: number
  /** Right edge of the selection's last line, relative to the document column. */
  right: number
}

interface DocumentViewProps {
  doc: SidemarkDocument
  highlights: Highlight[]
  hidden: Set<Nodes>
  focusedId: string | null
  onRendered(result: BodyRenderResult): void
  onSelection(selection: BodySelection | null): void
  /** A highlight was clicked; `ids` are the threads under the pointer. */
  onHighlightClick(ids: string[]): void
  onBackgroundClick(): void
}

/**
 * The rendered body. Rendering is imperative (see `body/render.ts`) so that
 * every text node can be registered with the DOM ↔ source index; Preact only
 * owns the container element.
 */
export function DocumentView(props: DocumentViewProps) {
  const ref = useRef<HTMLDivElement>(null)
  const result = useRef<BodyRenderResult | null>(null)
  const latest = useRef(props)
  latest.current = props

  useLayoutEffect(() => {
    const container = ref.current!
    result.current = renderBody(container, props.doc, {highlights: props.highlights, hidden: props.hidden})
    props.onRendered(result.current)
  }, [props.doc, props.highlights, props.hidden])

  // Focus styling without re-rendering the body.
  useLayoutEffect(() => {
    const container = ref.current!
    for (const el of container.querySelectorAll('.sm-hl.is-focused')) el.classList.remove('is-focused')
    if (!props.focusedId) return
    for (const el of result.current?.marks.get(props.focusedId) ?? []) el.classList.add('is-focused')
  }, [props.focusedId, props.doc, props.highlights])

  // Selection → source range.
  useEffect(() => {
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => latest.current.onSelection(readSelection(ref.current, result.current)))
    }
    document.addEventListener('selectionchange', update)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('selectionchange', update)
    }
  }, [])

  const onClick = (event: MouseEvent) => {
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed) return
    const target = event.target as Element | null
    if (target?.closest('a[href]')) return
    const mark = target?.closest<HTMLElement>('.sm-hl')
    const ids = (mark?.dataset.threads ?? '').split(' ').filter((id) => id && id !== PENDING_ID)
    if (ids.length) props.onHighlightClick(ids)
    else props.onBackgroundClick()
  }

  return <div class="doc-body" ref={ref} onClick={onClick} aria-label="Document" role="document" />
}

function readSelection(container: HTMLElement | null, rendered: BodyRenderResult | null): BodySelection | null {
  const selection = window.getSelection()
  if (!container || !rendered || !selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  if (!container.contains(range.commonAncestorContainer)) return null
  const source = rendered.index.rangeToSource(range)
  if (!source) return null
  const column = (container.closest('.doc-column') ?? container).getBoundingClientRect()
  const rects = range.getClientRects()
  const first = rects[0] ?? range.getBoundingClientRect()
  const last = rects[rects.length - 1] ?? first
  return {range: source, top: first.top - column.top, bottom: last.bottom - column.top, right: last.right - column.left}
}
