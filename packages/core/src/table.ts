/** Finding the comments table (§6.1) and reading its rows (§6.3–§6.5). */
import type {Heading, Nodes, Root, RootContent, Table} from 'mdast'
import {commentFromCell, inlineText, splitRow} from './cells.js'
import {parseDate} from './dates.js'
import {isThreadId} from './ids.js'
import {rangeOf} from './markdown.js'
import {asciiLower} from './text.js'
import type {Comment, CommentsTable, ParsedStatus, Row} from './types.js'

export const COLUMNS = ['ref', 'quote', 'author', 'date', 'comment', 'status'] as const
export const COLUMN = {ref: 0, quote: 1, author: 2, date: 3, comment: 4, status: 5} as const
export const DEFAULT_HEADING = 'Comments'

/** §6.7: the pointer writers put above a comments table they create. */
export const POINTER =
  '<!-- CommentMark: the table below holds comment threads on this document, tied to the <a id="c-..."> anchors in the text. Read https://github.com/waynepan/commentmark/blob/main/SPEC.md before editing either. -->'

/** §6.7: a pointer is recognised by this prefix only. */
export const POINTER_PREFIX = '<!-- CommentMark:'

/**
 * The comments table (§6.1). A top-level table qualifies if its first six
 * header cells are Ref, Quote, Author, Date, Comment, Status (trimmed, ASCII
 * case-insensitive) and it has no body rows or at least one row with a valid
 * Ref cell. Of the qualifying tables, the comments table is the last one with
 * at least one valid row; only if none has one, the last header-only table.
 * (An empty template table after the real one therefore cannot capture the
 * threads.)
 *
 * §6.1: header cells are compared by their parsed text (`**Ref**` matches).
 */
export function findCommentsTable(root: Root, source: string): CommentsTable | null {
  let lastWithRows: CommentsTable | null = null
  let lastEmpty: CommentsTable | null = null
  root.children.forEach((node, index) => {
    if (node.type !== 'table') return
    const header = node.children[0]
    if (!header) return
    const columns = header.children.map((cell) => inlineText(cell.children as Nodes[]).trim())
    const matches = COLUMNS.every((name, i) => columns[i] !== undefined && asciiLower(columns[i]!) === name)
    if (!matches) return
    const rows = readRows(node, source)
    const hasValidRow = rows.some((row) => row.threadId !== null)
    if (rows.length > 0 && !hasValidRow) return
    // §6.2, §6.7: the heading directly above the table, or directly above a
    // pointer that sits between them; the pointer directly above the heading
    // (or the table when there is no heading), or between the two.
    let at = index - 1
    let pointerNode = isPointer(root.children[at]) ? root.children[at] : undefined
    if (pointerNode) at--
    const headingNode = root.children[at]?.type === 'heading' ? root.children[at] : undefined
    if (headingNode && !pointerNode && isPointer(root.children[at - 1])) pointerNode = root.children[at - 1]
    const heading =
      headingNode?.type === 'heading'
        ? {node: headingNode, range: rangeOf(headingNode), text: headingText(headingNode)}
        : null
    const pointer = pointerNode?.type === 'html' ? {node: pointerNode, range: rangeOf(pointerNode)} : null
    const table = {node, range: rangeOf(node), heading, pointer, columns, rows}
    if (hasValidRow) lastWithRows = table
    else lastEmpty = table
  })
  return lastWithRows ?? lastEmpty
}

/**
 * §6.7: an HTML block whose text begins `<!-- CommentMark:`. Only the prefix
 * is checked, so hand-edited or future wording is still recognised.
 */
function isPointer(node: RootContent | undefined): node is Extract<RootContent, {type: 'html'}> {
  return node?.type === 'html' && node.value.trimStart().startsWith(POINTER_PREFIX)
}

/**
 * The top-level nodes that make up the comments table block: the pointer,
 * the heading and the table.
 *
 * §3 excludes only the heading and the table from the body; the pointer is
 * formally body content. It is an HTML block, so it adds nothing to the text
 * projection and holds no anchors (§6.7), and leaving it out of the body as
 * well changes nothing for readers. For writers it means a range can never
 * be anchored around it and anchor removal never uses it as a neighbour.
 */
export function tableBlockNodes(table: CommentsTable | null): Set<RootContent> {
  const nodes = new Set<RootContent>()
  if (!table) return nodes
  nodes.add(table.node)
  if (table.heading) nodes.add(table.heading.node)
  if (table.pointer) nodes.add(table.pointer.node)
  return nodes
}

function headingText(heading: Heading): string {
  return inlineText(heading.children as Nodes[]).trim()
}

function readRows(table: Table, source: string): Row[] {
  return table.children.slice(1).map((node, index) => {
    const range = rangeOf(node)
    const cells = splitRow(source, range)
    const refCell = node.children[COLUMN.ref]
    return {
      index,
      range,
      cells,
      node,
      threadId: refCell ? refThreadId(refCell.children as Nodes[]) : null
    }
  })
}

/**
 * §6.4 Ref: a link whose destination is `#` + thread ID (the ID comes from
 * the destination), or cell text that is exactly a thread ID.
 */
function refThreadId(children: readonly Nodes[]): string | null {
  const link = findLink(children)
  if (link) return link
  const text = inlineText(children).trim()
  return isThreadId(text) ? text : null
}

function findLink(nodes: readonly Nodes[]): string | null {
  for (const node of nodes) {
    if (node.type === 'link' && node.url.startsWith('#') && isThreadId(node.url.slice(1))) {
      return node.url.slice(1)
    }
    if ('children' in node) {
      const inner = findLink(node.children as Nodes[])
      if (inner) return inner
    }
  }
  return null
}

/** Read a row with a valid Ref as a comment. */
export function readComment(row: Row, threadId: string, index: number): Comment {
  const cellText = (column: number): string => {
    const cell = row.node.children[column]
    return cell ? inlineText(cell.children as Nodes[]).trim() : ''
  }
  const commentSource = row.cells[COLUMN.comment]?.source ?? ''
  const dateRaw = cellText(COLUMN.date)
  return {
    threadId,
    index,
    row,
    author: cellText(COLUMN.author),
    date: {raw: dateRaw, value: dateRaw === '' ? null : parseDate(dateRaw)},
    comment: commentFromCell(commentSource),
    commentSource,
    status: readStatus(cellText(COLUMN.status)),
    extraCells: row.cells.slice(COLUMNS.length).map((cell) => cell.source)
  }
}

function readStatus(raw: string): ParsedStatus {
  const lower = asciiLower(raw)
  return {raw, value: lower === 'open' || lower === 'resolved' ? lower : null}
}
