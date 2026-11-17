/**
 * DOM ↔ source mapping for the rendered document body.
 *
 * The body is rendered from core's mdast (see `render.ts`). While rendering,
 * every DOM text node that shows characters of an mdast `text`, `inlineCode`
 * or `code` node is registered here together with the slice of the node's
 * value it shows. Constructs that can only be commented on as a whole (images,
 * footnote references) are registered as "atoms" with their source range.
 *
 * With that registry:
 *
 * - **DOM → source.** A selection boundary `(container, offset)` becomes a
 *   source offset through `doc.sourceMap.toSource(node, valueOffset)`. A
 *   boundary that is not inside registered text (between blocks, on a list
 *   bullet, inside a table cell edge…) snaps to the nearest registered content
 *   *inside* the selection: forwards for the start, backwards for the end.
 * - **Source → DOM.** `segmentAt(offset)` finds the first registered content
 *   at or after a source offset, which is enough to position margin cards and
 *   scroll to a range.
 *
 * This module never looks at layout, so it runs (and is tested) in jsdom.
 */
import type {Nodes} from 'mdast'
import type {SourceMapper, SourceRange} from '@commentmark/core'

export type ValueNode = Extract<Nodes, {type: 'text' | 'inlineCode' | 'code'}>

/** A DOM text node that shows `node.value.slice(from, to)`. */
export interface TextSegment {
  kind: 'text'
  node: ValueNode
  from: number
  to: number
  /** Source range of the characters shown. */
  range: SourceRange
}

/** An element that stands for one indivisible source range. */
export interface AtomSegment {
  kind: 'atom'
  range: SourceRange
}

export type Side = 'start' | 'end'

export class BodyIndex {
  private readonly texts = new WeakMap<Node, TextSegment>()
  private readonly atoms = new WeakMap<Node, AtomSegment>()
  /** Registered DOM nodes in document order (registration order). */
  private readonly ordered: Array<{dom: Node; segment: TextSegment | AtomSegment}> = []

  constructor(
    readonly root: Element,
    private readonly sourceMap: SourceMapper
  ) {}

  /** Register a DOM text node showing `node.value.slice(from, to)`. Call in document order. */
  registerText(dom: Text, node: ValueNode, from: number, to: number): void {
    const range = {
      start: this.sourceMap.toSource(node, from),
      end: this.sourceMap.toSource(node, to)
    }
    const segment: TextSegment = {kind: 'text', node, from, to, range}
    this.texts.set(dom, segment)
    this.ordered.push({dom, segment})
  }

  /** Register an element that stands for `range` as a whole. Call in document order. */
  registerAtom(dom: Element, range: SourceRange): void {
    const segment: AtomSegment = {kind: 'atom', range}
    this.atoms.set(dom, segment)
    this.ordered.push({dom, segment})
  }

  /** Per-character source spans of a value node (from core's source map). */
  charMap(node: ValueNode): {starts: number[]; ends: number[]} {
    return this.sourceMap.charMap(node)
  }

  /** Number of registered segments (for tests and diagnostics). */
  get size(): number {
    return this.ordered.length
  }

  /**
   * Source offset for a DOM boundary point, or `null` when there is no
   * registered content on the requested side of it within the body.
   */
  pointToSource(container: Node, offset: number, side: Side): number | null {
    if (!this.root.contains(container)) return null

    // Inside an atom: snap outward to the whole construct.
    const atom = this.atomAround(container)
    if (atom) return side === 'start' ? atom.segment.range.start : atom.segment.range.end

    const text = this.texts.get(container)
    if (text) {
      const length = text.to - text.from
      const at = Math.max(0, Math.min(offset, length))
      // A start at the very end of a text node, or an end at the very start
      // of one, belongs to the neighbouring content (triple-click selections
      // end at offset 0 of the next block, for example).
      if (side === 'start' && at === length) return this.search(container, true, 'start')
      if (side === 'end' && at === 0) return this.search(container, false, 'end')
      return this.sourceMap.toSource(text.node, text.from + at)
    }

    if (container.nodeType === 3 /* TEXT_NODE */) {
      // Unregistered text (UI decoration): look past it.
      return side === 'start' ? this.search(container, true, 'start') : this.search(container, false, 'end')
    }

    const children = container.childNodes
    if (side === 'start') {
      const child = children[offset]
      return child ? this.searchFrom(child, 'start') : this.search(container, true, 'start')
    }
    const child = offset > 0 ? children[offset - 1] : undefined
    return child ? this.searchFromEnd(child) : this.search(container, false, 'end')
  }

  /** Source range for a DOM range, or `null` if it covers no registered content. */
  rangeToSource(range: {
    startContainer: Node
    startOffset: number
    endContainer: Node
    endOffset: number
  }): SourceRange | null {
    const start = this.pointToSource(range.startContainer, range.startOffset, 'start')
    const end = this.pointToSource(range.endContainer, range.endOffset, 'end')
    if (start === null || end === null || end <= start) return null
    return {start, end}
  }

  /**
   * Source → DOM: the DOM point where content at or after source offset
   * `offset` is shown. For text it is a (text node, offset) pair; for an atom
   * it is the atom element with offset 0. `null` if nothing is registered at
   * or after `offset`.
   */
  pointAt(offset: number): {node: Node; offset: number; kind: 'text' | 'atom'} | null {
    for (const entry of this.ordered) {
      const segment = entry.segment
      if (segment.range.end <= offset) continue
      if (segment.kind === 'atom') return {node: entry.dom, offset: 0, kind: 'atom'}
      const value = this.sourceMap.fromSource(segment.node, Math.max(offset, segment.range.start))
      const clamped = Math.max(segment.from, Math.min(segment.to, value))
      return {node: entry.dom, offset: clamped - segment.from, kind: 'text'}
    }
    return null
  }

  // -------------------------------------------------------------------------

  private atomAround(node: Node): {dom: Node; segment: AtomSegment} | null {
    for (let n: Node | null = node; n && n !== this.root; n = n.parentNode) {
      const segment = this.atoms.get(n)
      if (segment) return {dom: n, segment}
    }
    return null
  }

  /** Source offset of a registered node on one side. */
  private edgeOf(dom: Node, side: Side): number | null {
    const text = this.texts.get(dom)
    if (text) return side === 'start' ? text.range.start : text.range.end
    const atom = this.atoms.get(dom)
    if (atom) return side === 'start' ? atom.range.start : atom.range.end
    return null
  }

  /** First registered content at or inside `node`, then following it. */
  private searchFrom(node: Node, side: Side): number | null {
    for (let n: Node | null = node; n; n = nextNode(n, this.root, false)) {
      const edge = this.edgeOf(n, side)
      if (edge !== null) return edge
    }
    return null
  }

  /** Last registered content inside or at `node`, then preceding it. */
  private searchFromEnd(node: Node): number | null {
    for (let n: Node | null = lastDescendant(node); n; n = previousNode(n, this.root)) {
      const atom = this.atomAround(n)
      if (atom) return atom.segment.range.end
      const edge = this.edgeOf(n, 'end')
      if (edge !== null) return edge
    }
    return null
  }

  /** Registered content strictly after (`forward`) or before `node` and its subtree. */
  private search(node: Node, forward: boolean, side: Side): number | null {
    if (forward) {
      const next = nextNode(node, this.root, true)
      return next ? this.searchFrom(next, side) : null
    }
    const previous = previousNode(node, this.root)
    if (!previous) return null
    // `previousNode` returns ancestors last; skip ancestors of `node`, which
    // contain the point rather than precede it.
    let n: Node | null = previous
    while (n && n.contains(node)) n = previousNode(n, this.root)
    return n ? this.searchFromEnd(n) : null
  }
}

/** Next node in document order; `skipChildren` steps over `node`'s subtree. */
export function nextNode(node: Node, root: Node, skipChildren: boolean): Node | null {
  if (!skipChildren && node.firstChild) return node.firstChild
  for (let n: Node | null = node; n && n !== root; n = n.parentNode) {
    if (n.nextSibling) return n.nextSibling
  }
  return null
}

/** Previous node in document order (a node's previous sibling's last descendant, else its parent). */
export function previousNode(node: Node, root: Node): Node | null {
  if (node === root) return null
  if (node.previousSibling) return lastDescendant(node.previousSibling)
  const parent = node.parentNode
  return parent && parent !== root ? parent : null
}

function lastDescendant(node: Node): Node {
  let n = node
  while (n.lastChild) n = n.lastChild
  return n
}
