/** Save-time maintenance (§9.6). */
import type {Nodes} from 'mdast'
import {removeAnchors} from './anchor-edits.js'
import {applyEdits, type Edit} from './edits.js'
import {PlacementError} from './errors.js'
import {parse} from './parse.js'
import {placeAnchors} from './placement.js'
import {projectionSpan} from './projection.js'
import {buildQuote, quoteStillAccurate, writeQuoteCell} from './quote.js'
import {setCell} from './rows.js'
import {COLUMN} from './table.js'

/**
 * Run §9.6 maintenance and return the new source:
 *
 * 1. Remove stray anchors (§5.5).
 * 2. Repair anchors: insert an anchor pair for each thread anchored by the
 *    Quote fallback (§8 step 3). If the repaired thread's root Ref is a bare
 *    ID, rewrite that one cell to the link form `[ID](#ID)` (§6.4); reply
 *    rows and the Quote are left as written. Threads whose anchors cannot be
 *    placed safely are left as they are, bare Ref included.
 * 3. Refresh quotes: rewrite the root Quote cell of each thread with a valid
 *    anchor pair whose stored quote is no longer accurate.
 *
 * §9.6 lists these steps without an order. Strays are removed first so a
 * leftover lone anchor cannot pair with a
 * repaired one. Orphaned threads are never touched, and no thread or row is
 * ever deleted. The function is idempotent: `maintain(maintain(s)) ===
 * maintain(s)`.
 */
export function maintain(source: string): string {
  // 1. Stray anchors.
  let doc = parse(source)
  if (doc.strayAnchors.length > 0) {
    source = applyEdits(source, removeAnchors(doc, doc.strayAnchors))
    doc = parse(source)
  }

  // 2. Repair anchors, one thread at a time (each placement is verified
  // against the document as it is at that point).
  const repairedIds = new Set<string>()
  for (const id of doc.threads.map((t) => t.id)) {
    const thread = doc.threads.find((t) => t.id === id)
    if (thread?.attachment.kind !== 'anchored' || thread.attachment.via !== 'quote') continue
    try {
      const placed = placeAnchors(doc, thread.attachment.range, id)
      const repaired = placed.doc.threads.find((t) => t.id === id)
      if (repaired?.attachment.kind === 'anchored' && repaired.attachment.via === 'anchors') {
        source = placed.source
        doc = placed.doc
        repairedIds.add(id)
      }
    } catch (error) {
      if (!(error instanceof PlacementError)) throw error
    }
  }

  const edits: Edit[] = []

  // Root Refs of repaired threads become links.
  for (const thread of doc.threads) {
    if (!repairedIds.has(thread.id)) continue
    const root = thread.comments[0]!.row
    if (!refHasLink(root.node.children[COLUMN.ref]?.children as Nodes[] | undefined, thread.id)) {
      edits.push(setCell(doc, root, COLUMN.ref, `[${thread.id}](#${thread.id})`))
    }
  }

  // 3. Refresh quotes.
  for (const thread of doc.threads) {
    if (thread.attachment.kind !== 'anchored' || thread.attachment.via !== 'anchors') continue
    const span = projectionSpan(doc.projection, thread.attachment.range)
    const computed = buildQuote(doc.projection, span.from, span.to)
    // §9.6: never replace a non-empty Quote with an empty one.
    if (!computed) continue
    if (thread.quote && quoteStillAccurate(thread.quote, computed, doc.projection, span.from, span.to)) continue
    const root = thread.comments[0]!.row
    edits.push(setCell(doc, root, COLUMN.quote, writeQuoteCell(computed)))
  }
  return edits.length > 0 ? applyEdits(source, edits) : source
}

function refHasLink(nodes: readonly Nodes[] | undefined, id: string): boolean {
  return (nodes ?? []).some(
    (node) =>
      (node.type === 'link' && node.url === `#${id}`) ||
      ('children' in node && refHasLink(node.children as Nodes[], id))
  )
}
