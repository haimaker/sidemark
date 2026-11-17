/**
 * Text projection of the body (§7.1), with a source map.
 *
 * Every UTF-16 unit of `text` has a source span `[starts[i], ends[i])`.
 * Spaces that stand for a block boundary or a collapsed whitespace run span
 * the source they replaced (possibly empty). `starts` is non-decreasing, so
 * source offsets can be turned into projection indexes by binary search.
 */
import type {Nodes, Parents} from 'mdast'
import {endOf, PHRASING_PARENTS, startOf} from './markdown.js'
import type {SourceMapper} from './source-map.js'
import type {SourceRange} from './types.js'
import {isWhitespace} from './text.js'

export interface TextProjection {
  text: string
  starts: number[]
  ends: number[]
}

const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'thematicBreak',
  'blockquote',
  'list',
  'listItem',
  'code',
  'definition',
  'footnoteDefinition',
  'table',
  'tableRow',
  'tableCell',
  'yaml'
])

/**
 * Build the projection of `nodes` (the body's top-level blocks, without the
 * comments table).
 */
export function buildProjection(nodes: readonly Nodes[], mapper: SourceMapper): TextProjection {
  const raw = new RawText()
  for (const node of nodes) walk(node, null, raw, mapper)
  return raw.collapse()
}

function walk(node: Nodes, parent: Parents | null, out: RawText, mapper: SourceMapper): void {
  const block = BLOCK_TYPES.has(node.type) || (node.type === 'html' && !isPhrasingParent(parent))
  if (block) out.boundary(startOf(node))
  switch (node.type) {
    case 'text':
    case 'inlineCode':
    case 'code': {
      const map = mapper.charMap(node)
      for (let i = 0; i < node.value.length; i++) {
        out.push(node.value[i]!, map.starts[i]!, map.ends[i]!)
      }
      break
    }
    case 'image':
    case 'imageReference': {
      // The description's text. Anchors can never go inside an image, so each
      // character maps to the whole image.
      const start = startOf(node)
      const end = endOf(node)
      const alt = node.alt ?? ''
      for (let i = 0; i < alt.length; i++) out.push(alt[i]!, start, end)
      break
    }
    case 'break':
      out.push(' ', startOf(node), endOf(node))
      break
    case 'html':
    case 'footnoteReference':
    case 'definition':
    case 'yaml':
    case 'thematicBreak':
      break
    default:
      if ('children' in node) {
        for (const child of node.children) walk(child as Nodes, node, out, mapper)
      }
  }
  if (block) out.boundary(endOf(node))
}

function isPhrasingParent(parent: Parents | null): boolean {
  return parent !== null && PHRASING_PARENTS.has(parent.type)
}

class RawText {
  private readonly chars: string[] = []
  private readonly starts: number[] = []
  private readonly ends: number[] = []

  push(char: string, start: number, end: number): void {
    this.chars.push(char)
    this.starts.push(start)
    this.ends.push(end)
  }

  /** "One space between adjacent blocks" (§7.1). Runs collapse later. */
  boundary(at: number): void {
    this.push(' ', at, at)
  }

  /** §7.1 step 3: collapse whitespace runs to one space and trim. */
  collapse(): TextProjection {
    let text = ''
    const starts: number[] = []
    const ends: number[] = []
    const n = this.chars.length
    let i = 0
    while (i < n) {
      const char = this.chars[i]!
      if (!isWhitespace(char)) {
        text += char
        starts.push(this.starts[i]!)
        ends.push(this.ends[i]!)
        i++
        continue
      }
      let start = this.starts[i]!
      let end = this.ends[i]!
      while (i < n && isWhitespace(this.chars[i])) {
        start = Math.min(start, this.starts[i]!)
        end = Math.max(end, this.ends[i]!)
        i++
      }
      text += ' '
      starts.push(start)
      ends.push(end)
    }
    // Trim.
    let from = 0
    let to = text.length
    if (text[0] === ' ') from = 1
    if (to > from && text[to - 1] === ' ') to--
    return {
      text: text.slice(from, to),
      starts: starts.slice(from, to),
      ends: ends.slice(from, to)
    }
  }
}

/** First index whose start is at or after `offset`. */
export function indexAtOrAfter(projection: TextProjection, offset: number): number {
  const {starts} = projection
  let lo = 0
  let hi = starts.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (starts[mid]! < offset) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Projection index range `[from, to)` of the characters inside a source range. */
export function projectionSpan(projection: TextProjection, range: SourceRange): {from: number; to: number} {
  return {from: indexAtOrAfter(projection, range.start), to: indexAtOrAfter(projection, range.end)}
}

/** Source range covered by projection characters `[from, to)`; `null` if empty. */
export function sourceRangeOf(projection: TextProjection, from: number, to: number): SourceRange | null {
  if (to <= from) return null
  return {start: projection.starts[from]!, end: projection.ends[to - 1]!}
}

/** Trimmed text projection of a source range. */
export function projectRange(projection: TextProjection, range: SourceRange): string {
  const {from, to} = projectionSpan(projection, range)
  return projection.text.slice(from, to).replace(/^ | $/g, '')
}
