import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'preact/hooks'
import type {ComponentChildren} from 'preact'
import type {BodyRenderResult} from '../body/render'
import {layoutCards} from '../model/layout'

export interface MarginItem {
  id: string
  /** Source offset where the item's range starts (fallback when it has no highlight). */
  start: number
  render(): ComponentChildren
}

interface MarginProps {
  items: MarginItem[]
  focusedId: string | null
  rendered: BodyRenderResult | null
  /** Changes whenever the body may have reflowed. */
  layoutKey: unknown
}

const DEFAULT_HEIGHT = 96

/**
 * Cards positioned beside their ranges (SPEC §10), laid out by
 * `layoutCards` so they never overlap.
 */
export function Margin({items, focusedId, rendered, layoutKey}: MarginProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [anchors, setAnchors] = useState<Record<string, number>>({})
  const [heights, setHeights] = useState<Record<string, number>>({})
  const [tick, setTick] = useState(0)
  /** Items already drawn at a measured position; only these animate when they move. */
  const placed = useRef(new Set<string>())
  useLayoutEffect(() => {
    const ids = new Set(items.map((item) => item.id).filter((id) => id in anchors))
    placed.current = ids
  })

  // Where each range starts on screen, relative to the margin.
  useLayoutEffect(() => {
    const margin = ref.current
    if (!margin || !rendered) return
    const base = margin.getBoundingClientRect().top
    const next: Record<string, number> = {}
    for (const item of items) {
      const top = topOf(rendered, item.start)
      if (top !== null) next[item.id] = top - base
    }
    setAnchors((previous) => (sameNumbers(previous, next) ? previous : next))
  }, [items, rendered, layoutKey, tick])

  // Re-measure when the body reflows (window resize, fonts, images).
  useEffect(() => {
    const body = rendered?.index.root
    if (!body) return
    const observer = new ResizeObserver(() => setTick((t) => t + 1))
    observer.observe(body)
    return () => observer.disconnect()
  }, [rendered])

  // Card heights.
  const observer = useMemo(
    () =>
      new ResizeObserver((entries) => {
        setHeights((previous) => {
          let next = previous
          for (const entry of entries) {
            const id = (entry.target as HTMLElement).dataset.slot!
            const height = (entry.target as HTMLElement).offsetHeight
            if (previous[id] !== height) next = {...next, [id]: height}
          }
          return next
        })
      }),
    []
  )
  useEffect(() => () => observer.disconnect(), [observer])
  const slotRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (el) observer.observe(el)
    },
    [observer]
  )

  const tops = layoutCards(
    items.map((item) => ({id: item.id, top: anchors[item.id] ?? 0, height: heights[item.id] ?? DEFAULT_HEIGHT})),
    focusedId
  )
  const bottom = Math.max(0, ...items.map((item) => (tops.get(item.id) ?? 0) + (heights[item.id] ?? DEFAULT_HEIGHT)))

  return (
    <div class="margin" ref={ref} style={{minHeight: `${bottom}px`}} aria-label="Comments beside the text">
      {items.map((item) => (
        <div
          key={item.id}
          class={`margin-slot${item.id === focusedId ? ' is-focused' : ''}`}
          data-slot={item.id}
          ref={slotRef}
          style={{
            transform: `translateY(${tops.get(item.id) ?? 0}px)`,
            visibility: item.id in anchors ? 'visible' : 'hidden',
            // A card appearing for the first time jumps into place instead of sliding in from the top.
            transition: placed.current.has(item.id) ? undefined : 'none'
          }}
        >
          {item.render()}
        </div>
      ))}
    </div>
  )
}

/** Viewport top of the line where source offset `offset` is shown. */
function topOf(rendered: BodyRenderResult, offset: number): number | null {
  const point = rendered.index.pointAt(offset)
  if (!point) return null
  if (point.kind === 'atom') return (point.node as Element).getBoundingClientRect().top
  const text = point.node as Text
  const range = document.createRange()
  const at = Math.min(point.offset, Math.max(0, text.length - 1))
  range.setStart(text, at)
  range.setEnd(text, Math.min(text.length, at + 1))
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect()
  return rect.top
}

function sameNumbers(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(b)
  if (keys.length !== Object.keys(a).length) return false
  return keys.every((k) => Math.abs((a[k] ?? NaN) - b[k]!) < 0.5)
}
