/**
 * Placing an anchor pair around a source range (§5.3, §5.4).
 *
 * 1. Each boundary of the requested range is resolved to a place that can
 *    hold an anchor: a point in inline content, or "before"/"after" a block
 *    that cannot hold inline HTML (code, HTML block, thematic break).
 * 2. Inline boundaries move outward out of code spans, links, images,
 *    autolinks, raw HTML, escapes and entities, and then outside emphasis,
 *    strong and strikethrough delimiters they touch.
 * 3. For each boundary we generate candidate insertions, most preferred
 *    first, and try pairs of candidates. A candidate pair is accepted only if
 *    the re-parsed body has the same structure and text projection as before
 *    (ignoring anchors) and the new anchors form a valid pair.
 * 4. If no pair passes, `PlacementError` is thrown.
 */
import type {Nodes, Parents} from 'mdast'
import {anchorHtml, validPair} from './anchors.js'
import {applyEdits, insertion, type Edit} from './edits.js'
import {PlacementError, SidemarkError} from './errors.js'
import {endOf, rangeOf, startOf} from './markdown.js'
import {parse} from './parse.js'
import {bodySignature, isAnchorOnlyParagraph, leafBlocks, type LeafBlock} from './tree.js'
import {lineEnd, lineEndingLength, lineStart} from './text.js'
import type {SidemarkDocument, SourceRange} from './types.js'

type Side = 'start' | 'end'

type Boundary =
  | {kind: 'inline'; leaf: LeafBlock; hoisted: number}
  | {kind: 'block'; leaf: LeafBlock}

/**
 * Inline constructs an anchor may not go inside (§5.3).
 *
 * §5.3: autolinks include GFM bare URLs and email addresses, which mdast
 * represents as `link` nodes. Verification uses mdast-util-gfm, which (like
 * GitHub) still links `www.x.com` directly after an anchor; see Appendix B.7.
 */
const ATOMIC_INLINE = new Set([
  'inlineCode',
  'link',
  'linkReference',
  'image',
  'imageReference',
  'html',
  'footnoteReference',
  'break'
])
const EMPHASIS_LIKE = new Set(['emphasis', 'strong', 'delete'])

export interface Placement {
  source: string
  doc: SidemarkDocument
}

/** Insert an anchor pair for `threadId` around `range`. */
export function placeAnchors(doc: SidemarkDocument, range: SourceRange, threadId: string): Placement {
  validateRange(doc, range)
  const leaves = leafBlocks(doc)
  const start = resolveBoundary(doc, leaves, range.start, 'start')
  const end = resolveBoundary(doc, leaves, range.end, 'end')
  if (!start || !end || !hasContent(doc, boundaryOffset(start, 'start'), boundaryOffset(end, 'end'))) {
    throw new SidemarkError('INVALID_RANGE', 'The range contains no commentable content')
  }
  const startCandidates = candidates(doc, start, 'start', threadId)
  const endCandidates = candidates(doc, end, 'end', threadId)

  const baseline = {signature: bodySignature(doc), projection: doc.projection.text}
  const pairs: Array<[Edit[], Edit[]]> = []
  for (let total = 0; total < startCandidates.length + endCandidates.length; total++) {
    for (let i = 0; i <= total; i++) {
      const s = startCandidates[i]
      const e = endCandidates[total - i]
      if (s && e) pairs.push([s, e])
    }
  }
  for (const [s, e] of pairs) {
    let source: string
    try {
      source = applyEdits(doc.source, [...s, ...e])
    } catch {
      continue
    }
    const next = parse(source)
    if (
      validPair(next.anchors, threadId, source) &&
      next.projection.text === baseline.projection &&
      bodySignature(next) === baseline.signature
    ) {
      return {source, doc: next}
    }
  }
  throw new PlacementError(
    'No anchor placement leaves the document parsing the same; select a slightly different range'
  )
}

function validateRange(doc: SidemarkDocument, range: SourceRange): void {
  const {start, end} = range
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > doc.source.length || start >= end) {
    throw new SidemarkError('INVALID_RANGE', `Invalid range [${start}, ${end})`)
  }
  if (start < doc.bodyStart) {
    throw new SidemarkError('INVALID_RANGE', 'The range starts inside front matter')
  }
  const table = doc.table
  if (table) {
    const hidden = {start: table.heading?.range.start ?? table.range.start, end: table.range.end}
    if (start < hidden.end && end > hidden.start) {
      throw new SidemarkError('INVALID_RANGE', 'The range overlaps the comments table')
    }
  }
}

/** Whether the source in `[from, to)` has anything but whitespace and anchors. */
function hasContent(doc: SidemarkDocument, from: number, to: number): boolean {
  if (from >= to) return false
  let text = doc.source.slice(from, to)
  for (const anchor of doc.anchors) {
    if (anchor.range.start >= from && anchor.range.end <= to) text = text.replace(anchor.raw, '')
  }
  return /\S/.test(text)
}

function boundaryOffset(boundary: Boundary, side: Side): number {
  if (boundary.kind === 'inline') return boundary.hoisted
  return side === 'start' ? startOf(boundary.leaf.node) : endOf(boundary.leaf.node)
}

// ---------------------------------------------------------------------------
// Resolving a boundary

function resolveBoundary(doc: SidemarkDocument, leaves: LeafBlock[], x: number, side: Side): Boundary | null {
  for (const leaf of leaves) {
    if (leaf.kind === 'inline' && leaf.content) {
      const {start, end} = leaf.content
      if (side === 'start' ? start <= x && x < end : start < x && x <= end) {
        return inlineBoundary(doc, leaf, x, side)
      }
    } else if (leaf.kind === 'opaque') {
      const {start, end} = rangeOf(leaf.node)
      if (side === 'start' ? start <= x && x < end : start < x && x <= end) {
        return {kind: 'block', leaf}
      }
    }
  }
  // §5.3: a boundary on structure with no text (blank line, list marker,
  // table pipe) moves to the nearest allowed position, losing no text.
  if (side === 'start') {
    for (const leaf of leaves) {
      const at = leaf.content ? leaf.content.start : leaf.kind === 'opaque' ? startOf(leaf.node) : null
      if (at !== null && at >= x) {
        return leaf.kind === 'opaque' ? {kind: 'block', leaf} : inlineBoundary(doc, leaf, at, side)
      }
    }
  } else {
    for (let i = leaves.length - 1; i >= 0; i--) {
      const leaf = leaves[i]!
      const at = leaf.content ? leaf.content.end : leaf.kind === 'opaque' ? endOf(leaf.node) : null
      if (at !== null && at <= x) {
        return leaf.kind === 'opaque' ? {kind: 'block', leaf} : inlineBoundary(doc, leaf, at, side)
      }
    }
  }
  return null
}

function inlineBoundary(doc: SidemarkDocument, leaf: LeafBlock, x: number, side: Side): Boundary {
  const snapped = snapToInsertionPoint(doc, leaf, snapOutOfAtomic(leaf.node as Parents, x, side), side)
  return {kind: 'inline', leaf, hoisted: hoistOutOfEmphasis(leaf.node as Parents, snapped)}
}

/**
 * If `x` is strictly inside a code span, link, image, autolink, raw HTML,
 * footnote reference or break, move it to the outermost such node's start
 * (start boundary) or end (end boundary), so the range covers it whole.
 */
function snapOutOfAtomic(container: Parents, x: number, side: Side): number {
  for (const child of container.children as Nodes[]) {
    const {start, end} = rangeOf(child)
    if (start < x && x < end) {
      if (ATOMIC_INLINE.has(child.type)) return side === 'start' ? start : end
      if ('children' in child) return snapOutOfAtomic(child, x, side)
    }
  }
  return x
}

/**
 * Move `x` to a source position where inserting text cannot split an escape,
 * entity, line ending, container prefix or emphasis delimiter: the start of
 * a value character, the end of a non-line-ending value character, or a
 * node boundary. Start boundaries move backward, end boundaries forward.
 */
function snapToInsertionPoint(doc: SidemarkDocument, leaf: LeafBlock, x: number, side: Side): number {
  const points = insertionPoints(doc, leaf)
  if (side === 'start') {
    let best = points[0]!
    for (const p of points) if (p <= x) best = p
    return best
  }
  for (const p of points) if (p >= x) return p
  return points[points.length - 1]!
}

function insertionPoints(doc: SidemarkDocument, leaf: LeafBlock): number[] {
  const source = doc.source
  const points = new Set<number>()
  const content = leaf.content!
  points.add(content.start)
  points.add(content.end)
  const afterLineEnding = (p: number) => source[p - 1] === '\n' || source[p - 1] === '\r'
  const visit = (node: Nodes): void => {
    const {start, end} = rangeOf(node)
    if (!afterLineEnding(start)) points.add(start)
    if (!afterLineEnding(end)) points.add(end)
    if (ATOMIC_INLINE.has(node.type)) return
    if (node.type === 'text') {
      const map = doc.sourceMap.charMap(node)
      for (let i = 0; i < node.value.length; i++) {
        points.add(map.starts[i]!)
        const c = node.value[i]
        if (c !== '\n' && c !== '\r') points.add(map.ends[i]!)
      }
      return
    }
    if ('children' in node) for (const child of node.children) visit(child as Nodes)
  }
  for (const child of (leaf.node as Parents).children as Nodes[]) visit(child)
  return [...points].filter((p) => p >= content.start && p <= content.end).sort((a, b) => a - b)
}

/**
 * §5.3: when a boundary coincides with emphasis, strong or strikethrough
 * delimiters, place the anchor outside them. A boundary just inside the
 * opening delimiter moves before it; one just inside the closing delimiter
 * moves after it. Repeats for nested emphasis.
 */
function hoistOutOfEmphasis(container: Parents, x: number): number {
  let changed = true
  while (changed) {
    changed = false
    const visit = (node: Nodes): void => {
      if (changed || !('children' in node)) return
      if (EMPHASIS_LIKE.has(node.type) && node.children.length > 0) {
        const contentStart = startOf(node.children[0] as Nodes)
        const contentEnd = endOf(node.children[node.children.length - 1] as Nodes)
        if (x === contentStart && startOf(node) < x) {
          x = startOf(node)
          changed = true
          return
        }
        if (x === contentEnd && endOf(node) > x) {
          x = endOf(node)
          changed = true
          return
        }
      }
      for (const child of node.children) visit(child as Nodes)
    }
    for (const child of container.children as Nodes[]) visit(child)
  }
  return x
}

// ---------------------------------------------------------------------------
// Candidate insertions

function candidates(doc: SidemarkDocument, boundary: Boundary, side: Side, threadId: string): Edit[][] {
  const anchor = anchorHtml(threadId, side === 'end')
  if (boundary.kind === 'inline') {
    const content = boundary.leaf.content!
    const points = insertionPoints(doc, boundary.leaf)
    // §5.3: the anchor never stays at the inner edge of emphasis delimiters,
    // so every candidate starts from the hoisted position.
    const offsets = [
      boundary.hoisted,
      widenOverSpaces(doc.source, boundary.hoisted, side, content),
      widenToWord(doc.source, boundary.hoisted, side, content, points)
    ]
    return [...new Set(offsets)].map((at) => [insertion(at, anchor)])
  }
  return side === 'start'
    ? blockStartCandidates(doc, boundary.leaf, anchor)
    : blockEndCandidates(doc, boundary.leaf, anchor)
}

function widenOverSpaces(source: string, x: number, side: Side, content: SourceRange): number {
  if (side === 'start') {
    while (x > content.start && (source[x - 1] === ' ' || source[x - 1] === '\t')) x--
  } else {
    while (x < content.end && (source[x] === ' ' || source[x] === '\t')) x++
  }
  return x
}

/**
 * Last resort for inline boundaries: move outward to the edge of the word,
 * where an anchor cannot change emphasis flanking (e.g. inside `a_b_c`).
 */
function widenToWord(source: string, x: number, side: Side, content: SourceRange, points: number[]): number {
  const valid = new Set(points)
  if (side === 'start') {
    let y = x
    while (y > content.start && !/\s/.test(source[y - 1]!)) y--
    while (!valid.has(y) && y < x) y++
    return y
  }
  let y = x
  while (y < content.end && !/\s/.test(source[y]!)) y++
  while (!valid.has(y) && y > x) y--
  return y
}

/**
 * Anchor before a block that cannot hold inline HTML (§5.4), in order of
 * preference:
 * 1. joined to an anchor-only paragraph directly before the block, or else a
 *    new paragraph of its own, separated by blank lines (the spec's form);
 * 2. a paragraph of its own without the blank line between it and the block
 *    (keeps tight lists tight; works where the block can interrupt a
 *    paragraph, e.g. a fenced code block);
 * 3. at the end of the paragraph or heading directly before the block.
 *
 * §5.4: forms 2 and 3 are the spec's alternatives for when blank lines would
 * change the parse (a tight list turning loose). Every form is verified by
 * re-parsing, so form 2 is also tried after a block and for blocks that
 * cannot interrupt a paragraph; it is kept only if the parse is unchanged.
 */
function blockStartCandidates(doc: SidemarkDocument, leaf: LeafBlock, anchor: string): Edit[][] {
  const source = doc.source
  const eol = doc.lineEnding
  const block = leaf.node
  const blockStart = startOf(block)
  const {cont, blank} = continuationPrefix(source, blockStart)
  const siblings = leaf.parent.children as Nodes[]
  const previous = siblings[siblings.indexOf(block) - 1]
  const out: Edit[][] = []

  if (previous && isAnchorOnlyParagraph(previous, doc.anchors, source)) {
    out.push([insertion(endOf(previous), anchor)])
  } else {
    const ls = lineStart(source, blockStart)
    const needsBlankBefore = ls > doc.bodyStart && !isBlankLine(previousLine(source, ls))
    out.push([
      ...(needsBlankBefore ? [insertion(ls, blank + eol)] : []),
      insertion(blockStart, anchor + eol + blank + eol + cont)
    ])
  }
  out.push([insertion(blockStart, anchor + eol + cont)])
  if (previous && (previous.type === 'paragraph' || previous.type === 'heading')) {
    const last = previous.children[previous.children.length - 1] as Nodes | undefined
    out.push([insertion(last ? endOf(last) : endOf(previous), anchor)])
  }
  return out
}

/** Mirror of `blockStartCandidates` for the anchor after a block. */
function blockEndCandidates(doc: SidemarkDocument, leaf: LeafBlock, anchor: string): Edit[][] {
  const source = doc.source
  const block = leaf.node
  const blockEnd = endOf(block)
  const eol = lineEndingAt(source, blockEnd) || doc.lineEnding
  const {cont, blank} = continuationPrefix(source, startOf(block))
  const siblings = leaf.parent.children as Nodes[]
  const next = siblings[siblings.indexOf(block) + 1]
  const out: Edit[][] = []

  if (next && isAnchorOnlyParagraph(next, doc.anchors, source)) {
    out.push([insertion(startOf(next), anchor)])
  } else {
    const needsBlankAfter = !isBlankLine(nextLine(source, blockEnd))
    out.push([insertion(blockEnd, eol + blank + eol + cont + anchor + (needsBlankAfter ? eol + blank : ''))])
  }
  out.push([insertion(blockEnd, eol + cont + anchor)])
  if (next && (next.type === 'paragraph' || next.type === 'heading')) {
    const first = next.children[0] as Nodes | undefined
    out.push([insertion(first ? startOf(first) : startOf(next), anchor)])
  }
  return out
}

/**
 * The prefix a new line needs to stay in the same container as the block
 * starting at `blockStart`: the text before the block on its first line,
 * with list markers replaced by spaces. `blank` is the same for a blank line.
 */
function continuationPrefix(source: string, blockStart: number): {cont: string; blank: string} {
  const prefix = source.slice(lineStart(source, blockStart), blockStart)
  const cont = prefix.replace(/(?:[-*+]|\d{1,9}[.)])(?=[ \t]|$)/g, (m) => ' '.repeat(m.length))
  return {cont, blank: cont.replace(/[ \t]+$/, '')}
}

function isBlankLine(line: string | null): boolean {
  return line === null || /^[\s>]*$/.test(line)
}

/** The line before the line starting at `ls`. */
function previousLine(source: string, ls: number): string | null {
  if (ls === 0) return null
  let e = ls
  if (source[e - 1] === '\n') e--
  if (source[e - 1] === '\r') e--
  return source.slice(lineStart(source, e), e)
}

/** The line after the line ending at `le`, or `null` at end of input. */
function nextLine(source: string, le: number): string | null {
  const at = lineEnd(source, le)
  const length = lineEndingLength(source, at)
  if (length === 0) return null
  return source.slice(at + length, lineEnd(source, at + length))
}

function lineEndingAt(source: string, offset: number): string {
  const at = lineEnd(source, offset)
  return source.slice(at, at + lineEndingLength(source, at))
}
