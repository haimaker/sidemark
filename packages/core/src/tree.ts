/** mdast helpers for the writer: body blocks, ancestors, structural signatures. */
import type {Nodes, Parents, Root} from 'mdast'
import {endOf, rangeOf, startOf} from './markdown.js'
import {collapseWhitespaceRuns} from './text.js'
import type {Anchor, SidemarkDocument, SourceRange} from './types.js'

/** The body's top-level nodes: everything except the comments table and its heading. */
export function bodyNodes(doc: SidemarkDocument): Nodes[] {
  const table = doc.table
  return doc.root.children.filter((node) => node !== table?.node && node !== table?.heading?.node)
}

/**
 * A leaf block of the body.
 * - `inline`: can hold anchors (paragraph, heading, table cell).
 * - `opaque`: cannot (code, HTML block, thematic break, definition).
 */
export interface LeafBlock {
  node: Nodes
  parent: Parents
  kind: 'inline' | 'opaque'
  /** Range of the inline content; `null` for opaque blocks and empty inline blocks. */
  content: SourceRange | null
}

const OPAQUE = new Set(['code', 'html', 'thematicBreak', 'definition', 'yaml'])

export function leafBlocks(doc: SidemarkDocument): LeafBlock[] {
  const leaves: LeafBlock[] = []
  const visit = (node: Nodes, parent: Parents): void => {
    if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'tableCell') {
      leaves.push({node, parent, kind: 'inline', content: inlineContentRange(node)})
      return
    }
    if (OPAQUE.has(node.type)) {
      leaves.push({node, parent, kind: 'opaque', content: null})
      return
    }
    if ('children' in node) {
      for (const child of node.children) visit(child as Nodes, node)
    }
  }
  for (const node of bodyNodes(doc)) visit(node, doc.root)
  return leaves
}

function inlineContentRange(node: Parents): SourceRange | null {
  if (node.type === 'paragraph') return rangeOf(node)
  const first = node.children[0] as Nodes | undefined
  const last = node.children[node.children.length - 1] as Nodes | undefined
  if (!first || !last) return null
  return {start: startOf(first), end: endOf(last)}
}

/** Ancestors of `target` from the root down to its parent, or `null` if absent. */
export function ancestorsOf(root: Root, target: Nodes): Parents[] | null {
  const path: Parents[] = []
  const visit = (node: Parents): boolean => {
    path.push(node)
    for (const child of node.children as Nodes[]) {
      if (child === target) return true
      if ('children' in child && visit(child)) return true
    }
    path.pop()
    return false
  }
  return visit(root) ? path : null
}

/** The innermost node of `type` (one of `types`) whose range contains `[start, end)`. */
export function deepestContaining(root: Parents, range: SourceRange, types: ReadonlySet<string>): Nodes | null {
  let found: Nodes | null = null
  const visit = (node: Parents): void => {
    for (const child of node.children as Nodes[]) {
      const r = rangeOf(child)
      if (r.start <= range.start && range.end <= r.end) {
        if (types.has(child.type)) found = child
        if ('children' in child) visit(child)
      }
    }
  }
  visit(root)
  return found
}

/** Whether `paragraph` holds nothing but anchors and whitespace. */
export function isAnchorOnlyParagraph(node: Nodes, anchors: readonly Anchor[], source: string): boolean {
  if (node.type !== 'paragraph') return false
  const {start, end} = rangeOf(node)
  const inside = anchors.filter((a) => a.range.start >= start && a.range.end <= end)
  if (inside.length === 0) return false
  let at = start
  for (const anchor of inside) {
    if (source.slice(at, anchor.range.start).trim() !== '') return false
    at = anchor.range.end
  }
  return source.slice(at, end).trim() === ''
}

/**
 * A string that captures how the body parses, ignoring anchors: anchor HTML
 * nodes are dropped, paragraphs left empty are dropped, adjacent text nodes
 * are merged and whitespace runs in text are collapsed. Positions are
 * ignored. Two documents with equal signatures render the same apart from
 * anchors.
 */
export function bodySignature(doc: SidemarkDocument): string {
  const anchorRanges = doc.anchors.map((a) => a.range)
  const isAnchorPart = (node: Nodes): boolean => {
    if (node.type !== 'html') return false
    const r = rangeOf(node)
    return anchorRanges.some((a) => a.start <= r.start && r.end <= a.end)
  }
  const normalise = (node: Nodes): unknown => {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node)) {
      if (key === 'position' || key === 'children' || key === 'data') continue
      out[key] = key === 'value' && node.type === 'text' ? collapseWhitespaceRuns(String(value)) : value
    }
    if ('children' in node) {
      const children: unknown[] = []
      let text: string | null = null
      const flush = () => {
        if (text !== null) children.push({type: 'text', value: collapseWhitespaceRuns(text)})
        text = null
      }
      for (const child of node.children as Nodes[]) {
        if (isAnchorPart(child)) continue
        if (child.type === 'text') {
          text = (text ?? '') + child.value
          continue
        }
        flush()
        const normalised = normalise(child)
        if (normalised !== null) children.push(normalised)
      }
      flush()
      if (node.type === 'paragraph' && children.every(isBlankText)) return null
      out.children = children
    }
    return out
  }
  return JSON.stringify(bodyNodes(doc).map(normalise).filter((n) => n !== null))
}

function isBlankText(node: unknown): boolean {
  const n = node as {type?: string; value?: string}
  return n.type === 'text' && (n.value ?? '').trim() === ''
}
