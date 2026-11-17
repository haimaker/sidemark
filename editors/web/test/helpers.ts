import {JSDOM} from 'jsdom'
import type {Nodes} from 'mdast'
import {parse, type CommentMarkDocument} from '@commentmark/core'
import {renderBody, type Highlight} from '../src/body/render'
import {hiddenNodes} from '../src/model/groups'

export function setup(source: string, highlights: Highlight[] = []) {
  const dom = new JSDOM('<!doctype html><body><div id="body"></div><div id="outside">outside</div></body>')
  const document = dom.window.document
  const container = document.getElementById('body') as HTMLElement
  const doc = parse(source)
  const result = renderBody(container, doc, {highlights, hidden: hiddenNodes(doc) as Set<Nodes>})
  return {dom, document, container, doc, ...result}
}

/** All text nodes under `root`, in document order. */
export function textNodes(root: Node): Text[] {
  const out: Text[] = []
  const visit = (node: Node) => {
    if (node.nodeType === 3) out.push(node as Text)
    node.childNodes.forEach(visit)
  }
  visit(root)
  return out
}

/**
 * DOM boundary points for the `occurrence`-th match of `needle` in the
 * concatenated text of `root` (as a person would select it on screen).
 */
export function findText(root: Node, needle: string, occurrence = 0) {
  const nodes = textNodes(root)
  const text = nodes.map((n) => n.data).join('')
  let at = -1
  for (let i = 0; i <= occurrence; i++) {
    at = text.indexOf(needle, at + 1)
    if (at < 0) throw new Error(`"${needle}" not found in rendered text: ${JSON.stringify(text)}`)
  }
  return {start: pointAt(nodes, at, 'start'), end: pointAt(nodes, at + needle.length, 'end')}
}

function pointAt(nodes: Text[], offset: number, side: 'start' | 'end'): {node: Text; offset: number} {
  let seen = 0
  for (const node of nodes) {
    const length = node.data.length
    // Prefer the later node for a start on a boundary and the earlier one for an end.
    if (side === 'start' ? offset < seen + length : offset <= seen + length) {
      return {node, offset: offset - seen}
    }
    seen += length
  }
  const last = nodes[nodes.length - 1]!
  return {node: last, offset: last.data.length}
}

export function domRange(points: ReturnType<typeof findText>) {
  return {
    startContainer: points.start.node as Node,
    startOffset: points.start.offset,
    endContainer: points.end.node as Node,
    endOffset: points.end.offset
  }
}

export type {CommentMarkDocument}
