/** The Reader: `parse(source)` builds the full document model. */
import type {Nodes} from 'mdast'
import {classifyAnchors, findAnchors} from './anchors.js'
import {parseEvents, parseTree, splitPreamble} from './markdown.js'
import {buildProjection} from './projection.js'
import {readQuoteCell} from './quote.js'
import {resolveAttachment} from './resolve.js'
import {fillMissingPositions, SourceMapper} from './source-map.js'
import {COLUMN, findCommentsTable, readComment} from './table.js'
import {detectLineEnding} from './text.js'
import type {Comment, Row, CommentMarkDocument, Thread, ThreadState} from './types.js'

export function parse(source: string): CommentMarkDocument {
  const {bodyStart, frontMatter} = splitPreamble(source)
  const root = parseTree(source, bodyStart)
  const sourceMap = new SourceMapper(source, parseEvents(source, bodyStart), bodyStart)
  fillMissingPositions(root, sourceMap, source)
  const table = findCommentsTable(root, source)

  // §3: the body excludes the comments table and a heading immediately
  // preceding it, whatever its text.
  const bodyNodes = root.children.filter((node) => node !== table?.node && node !== table?.heading?.node)
  const projection = buildProjection(bodyNodes as Nodes[], sourceMap)
  const anchors = findAnchors(bodyNodes as Nodes[], source)

  // §6.3: group rows by thread ID, keeping row order.
  const rowsByThread = new Map<string, Row[]>()
  const malformedRows: Row[] = []
  for (const row of table?.rows ?? []) {
    if (row.threadId === null) {
      malformedRows.push(row)
      continue
    }
    const rows = rowsByThread.get(row.threadId)
    if (rows) rows.push(row)
    else rowsByThread.set(row.threadId, [row])
  }

  const pairs = classifyAnchors(anchors, new Set(rowsByThread.keys()), source)

  const threads: Thread[] = []
  for (const [id, rows] of rowsByThread) {
    const comments: Comment[] = rows.map((row, index) => readComment(row, id, index))
    const rootRow = rows[0]!
    const quoteCell = rootRow.node.children[COLUMN.quote]
    const quote = quoteCell ? readQuoteCell(quoteCell.children as Nodes[]) : null
    const pair = pairs.get(id) ?? null
    threads.push({
      id,
      comments,
      state: threadState(comments),
      attachment: resolveAttachment(pair, quote, projection),
      quote,
      anchors: pair
    })
  }

  return {
    source,
    root,
    bodyStart,
    frontMatter,
    table,
    threads,
    anchors,
    strayAnchors: anchors.filter((anchor) => anchor.stray !== null),
    malformedRows,
    projection,
    sourceMap,
    lineEnding: detectLineEnding(source)
  }
}

/** §6.4: the last recognised non-empty Status in row order; open if none. */
function threadState(comments: readonly Comment[]): ThreadState {
  let state: ThreadState = 'open'
  for (const comment of comments) {
    if (comment.status.value) state = comment.status.value
  }
  return state
}

/** Find a thread by ID. */
export function getThread(doc: CommentMarkDocument, id: string): Thread | undefined {
  return doc.threads.find((thread) => thread.id === id)
}
