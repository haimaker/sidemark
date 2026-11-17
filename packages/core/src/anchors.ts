/** Recognising anchors (§5.1) and choosing valid pairs (§5.5). */
import type {Html, Nodes, Parents} from 'mdast'
import {isThreadId} from './ids.js'
import {rangeOf} from './markdown.js'
import {isWhitespace} from './text.js'
import type {Anchor, SourceRange, StrayReason} from './types.js'

const OPEN_TAG = /^<a(\s[\s\S]*)?>$/i
const CLOSE_TAG = /^<\/a\s*>$/i
const ATTRIBUTE =
  /\s*([a-zA-Z_:][a-zA-Z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/y

/** The `id` attribute of an `<a …>` open tag, or `null`. */
export function anchorIdOf(openTag: string): string | null {
  const match = OPEN_TAG.exec(openTag)
  if (!match) return null
  const attributes = (match[1] ?? '').replace(/\s*\/?\s*$/, '')
  ATTRIBUTE.lastIndex = 0
  let at = 0
  while (at < attributes.length) {
    ATTRIBUTE.lastIndex = at
    const attr = ATTRIBUTE.exec(attributes)
    if (!attr || attr[0] === '') return null
    at = ATTRIBUTE.lastIndex
    // HTML uses the first of duplicate attributes.
    if (attr[1]!.toLowerCase() === 'id') return attr[2] ?? attr[3] ?? attr[4] ?? ''
  }
  return null
}

/** Split an anchor id attribute into thread ID and end flag. */
function parseAnchorId(id: string): {threadId: string; isEnd: boolean} | null {
  if (isThreadId(id)) return {threadId: id, isEnd: false}
  if (id.endsWith('-end') && isThreadId(id.slice(0, -4))) {
    return {threadId: id.slice(0, -4), isEnd: true}
  }
  return null
}

/** The exact form writers emit (§5.1). */
export function anchorHtml(threadId: string, isEnd: boolean): string {
  return `<a id="${threadId}${isEnd ? '-end' : ''}"></a>`
}

/**
 * Find every anchor in `nodes`, in document order.
 *
 * An anchor is an inline HTML open tag `<a …>` with a thread ID (or thread
 * ID + `-end`) as its `id`, immediately followed by a closing `</a>`.
 * Readers accept any quoting, spacing, case and extra attributes (§5.1).
 *
 * §5.1: only inline HTML counts (not HTML blocks), and `</a>` must follow
 * the open tag immediately, with not even whitespace between.
 *
 * Tag and attribute names match without regard to case (`<A ID="c-1">`), and
 * a `/` before `>` is allowed, since CommonMark parses `<a id="c-1"/>` as an
 * open tag. Thread ID values stay case-sensitive (§5.1, §4).
 */
export function findAnchors(nodes: readonly Nodes[], source: string): Anchor[] {
  const found: Anchor[] = []
  const visit = (parent: Parents): void => {
    const children = parent.children as Nodes[]
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!
      if (child.type === 'html') {
        const next = children[i + 1]
        if (next?.type === 'html' && isPhrasing(parent)) {
          const anchor = anchorFromPair(child, next, source)
          if (anchor) {
            found.push(anchor)
            i++
            continue
          }
        }
      }
      if ('children' in child) visit(child)
    }
  }
  for (const node of nodes) {
    if ('children' in node) visit(node)
  }
  return found
}

function isPhrasing(parent: Parents): boolean {
  return parent.type !== 'root' && parent.type !== 'blockquote' && parent.type !== 'listItem' &&
    parent.type !== 'footnoteDefinition' && parent.type !== 'list'
}

function anchorFromPair(open: Html, close: Html, source: string): Anchor | null {
  const openRange = rangeOf(open)
  const closeRange = rangeOf(close)
  if (openRange.end !== closeRange.start || !CLOSE_TAG.test(close.value)) return null
  const id = anchorIdOf(open.value)
  const parsed = id === null ? null : parseAnchorId(id)
  if (!parsed) return null
  const range = {start: openRange.start, end: closeRange.end}
  return {...parsed, range, raw: source.slice(range.start, range.end), stray: null}
}

/**
 * §5.5: the first start anchor for `threadId` and the first end anchor after
 * it, if the source between them has something other than whitespace and
 * other anchors. Returns `null` when there is no valid pair.
 */
export function validPair(
  anchors: readonly Anchor[],
  threadId: string,
  source: string
): {start: Anchor; end: Anchor} | null {
  const candidate = candidatePair(anchors, threadId)
  if (!candidate) return null
  return hasContentBetween(anchors, candidate.start.range.end, candidate.end.range.start, source)
    ? candidate
    : null
}

function candidatePair(anchors: readonly Anchor[], threadId: string): {start: Anchor; end: Anchor} | null {
  const start = anchors.find((a) => a.threadId === threadId && !a.isEnd)
  if (!start) return null
  const end = anchors.find((a) => a.threadId === threadId && a.isEnd && a.range.start >= start.range.end)
  return end ? {start, end} : null
}

function hasContentBetween(anchors: readonly Anchor[], from: number, to: number, source: string): boolean {
  let at = from
  const inside = anchors.filter((a) => a.range.start >= from && a.range.end <= to)
  for (const anchor of [...inside, null]) {
    const stop = anchor ? anchor.range.start : to
    for (let i = at; i < stop; i++) {
      if (!isWhitespace(source[i])) return true
    }
    if (anchor) at = anchor.range.end
  }
  return false
}

/**
 * Mark every anchor with its stray reason (or `null`) given the set of thread
 * IDs in the comments table, and return the valid pair for each thread.
 */
export function classifyAnchors(
  anchors: Anchor[],
  threadIds: ReadonlySet<string>,
  source: string
): Map<string, {start: Anchor; end: Anchor}> {
  const pairs = new Map<string, {start: Anchor; end: Anchor}>()
  for (const id of new Set(anchors.map((a) => a.threadId))) {
    if (!threadIds.has(id)) continue
    const pair = validPair(anchors, id, source)
    if (pair) pairs.set(id, pair)
  }
  for (const anchor of anchors) {
    anchor.stray = strayReason(anchor, anchors, pairs, threadIds)
  }
  return pairs
}

/**
 * §5.5 reasons, checked in the spec's order. `unmatched` is any other anchor
 * that is not part of its thread's valid pair.
 */
function strayReason(
  anchor: Anchor,
  anchors: readonly Anchor[],
  pairs: ReadonlyMap<string, {start: Anchor; end: Anchor}>,
  threadIds: ReadonlySet<string>
): StrayReason | null {
  if (!threadIds.has(anchor.threadId)) return 'unknown-thread'
  const pair = pairs.get(anchor.threadId)
  if (pair) return pair.start === anchor || pair.end === anchor ? null : 'duplicate'
  const candidate = candidatePair(anchors, anchor.threadId)
  if (candidate && (candidate.start === anchor || candidate.end === anchor)) return 'empty'
  return 'unmatched'
}

/** Source range strictly between a pair's anchors. */
export function pairContentRange(pair: {start: Anchor; end: Anchor}): SourceRange {
  return {start: pair.start.range.end, end: pair.end.range.start}
}
