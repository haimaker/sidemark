/** Removing anchors from the body. */
import type {Nodes, Paragraph, Parents} from 'mdast'
import {deletion, type Edit} from './edits.js'
import {endOf, startOf} from './markdown.js'
import {ancestorsOf, bodyNodes, deepestContaining, isAnchorOnlyParagraph} from './tree.js'
import type {Anchor, SidemarkDocument} from './types.js'

const PARAGRAPH = new Set(['paragraph'])

/**
 * Edits that remove `anchors`. An anchor-only paragraph (§5.4) whose anchors
 * are all being removed is removed whole, with the blank line that separated
 * it from its neighbour, undoing what `createThread` inserted. Other anchors
 * are removed exactly, leaving the surrounding text as it was.
 */
export function removeAnchors(doc: SidemarkDocument, anchors: readonly Anchor[]): Edit[] {
  const removing = new Set(anchors)
  const body = new Set<Nodes>(bodyNodes(doc))
  const wholeParagraphs = new Map<Paragraph, Parents>()
  const edits: Edit[] = []

  for (const anchor of anchors) {
    const paragraph = deepestContaining(doc.root, anchor.range, PARAGRAPH) as Paragraph | null
    if (paragraph && !wholeParagraphs.has(paragraph) && isAnchorOnlyParagraph(paragraph, doc.anchors, doc.source)) {
      const own = doc.anchors.filter(
        (a) => a.range.start >= startOf(paragraph) && a.range.end <= endOf(paragraph)
      )
      const parent = ancestorsOf(doc.root, paragraph)?.at(-1)
      if (parent && own.every((a) => removing.has(a))) {
        wholeParagraphs.set(paragraph, parent)
        continue
      }
    }
    if (paragraph && wholeParagraphs.has(paragraph)) continue
    edits.push(deletion(anchor.range.start, anchor.range.end))
  }

  // Remove runs of adjacent anchor-only paragraphs together.
  const byParent = new Map<Parents, Paragraph[]>()
  for (const [paragraph, parent] of wholeParagraphs) {
    const list = byParent.get(parent) ?? []
    list.push(paragraph)
    byParent.set(parent, list)
  }
  for (const [parent, paragraphs] of byParent) {
    const siblings = parent.children as Nodes[]
    const indexes = paragraphs.map((p) => siblings.indexOf(p)).sort((a, b) => a - b)
    let runStart = 0
    for (let k = 1; k <= indexes.length; k++) {
      if (k < indexes.length && indexes[k] === indexes[k - 1]! + 1) continue
      const first = siblings[indexes[runStart]!]!
      const last = siblings[indexes[k - 1]!]!
      let previous = siblings[indexes[runStart]! - 1]
      let next = siblings[indexes[k - 1]! + 1]
      // At the top level, never use the comments table or its heading as a neighbour.
      if (parent.type === 'root') {
        if (previous && !body.has(previous)) previous = undefined
        if (next && !body.has(next)) next = undefined
      }
      if (previous) edits.push(deletion(endOf(previous), endOf(last)))
      else if (next) edits.push(deletion(startOf(first), startOf(next)))
      else edits.push(deletion(startOf(first), endOf(last)))
      runStart = k
    }
  }
  return edits
}
