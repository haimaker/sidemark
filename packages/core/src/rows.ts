/** Edits to the comments table: rows, cells, creating and removing the table. */
import {escapeCellMarkdown} from './cells.js'
import type {RootContent} from 'mdast'
import {deletion, insertion, type Edit} from './edits.js'
import {endOf, startOf} from './markdown.js'
import {COLUMNS, DEFAULT_HEADING, POINTER} from './table.js'
import {countLineEndings, endsWithLineEnding, lineEnd, lineEndingLength, lineStart} from './text.js'
import type {Row, CommentMarkDocument} from './types.js'

/** Cell contents of a new row, already escaped for a table cell. */
export interface RowCells {
  ref: string
  quote: string
  author: string
  date: string
  comment: string
  status: string
}

/** A new row in compact form (§9.1): one space each side of each cell's content; an empty cell is `| |`. */
export function formatRow(cells: RowCells, columnCount: number): string {
  const values = [cells.ref, cells.quote, cells.author, cells.date, cells.comment, cells.status]
  // §6.6: empty cells for columns this version does not know.
  while (values.length < columnCount) values.push('')
  return '|' + values.map((v) => (v === '' ? ' ' : ` ${v} `)).join('|') + '|'
}

export function columnCount(doc: CommentMarkDocument): number {
  return Math.max(COLUMNS.length, doc.table?.columns.length ?? 0)
}

/** Escape free text (Comment cell) for a row. */
export function cellMarkdown(markdown: string): string {
  return escapeCellMarkdown(markdown.trim())
}

/** Line ending that terminates the line containing `offset` ('' on the last line). */
function lineEndingOf(source: string, offset: number): string {
  const at = lineEnd(source, offset)
  return source.slice(at, at + lineEndingLength(source, at))
}

/** Insert `rowText` as a new line directly before `row`. */
export function insertRowBefore(doc: CommentMarkDocument, row: Row, rowText: string): Edit {
  const eol = lineEndingOf(doc.source, row.range.start) || doc.lineEnding
  return insertion(lineStart(doc.source, row.range.start), rowText + eol)
}

/** Insert `rowText` as a new line directly after the line holding `offset`. */
export function insertLineAfter(doc: CommentMarkDocument, offset: number, rowText: string): Edit {
  const eol = lineEndingOf(doc.source, offset) || doc.lineEnding
  return insertion(lineEnd(doc.source, offset), eol + rowText)
}

/** Insert `rowText` after the last line of the table. */
export function appendRow(doc: CommentMarkDocument, rowText: string): Edit {
  return insertLineAfter(doc, doc.table!.range.end, rowText)
}

/**
 * Append a new comments table with one row (§6.2): `## Comments`, then the
 * table, as the last block. The document keeps (or keeps lacking) its final
 * line ending.
 */
export function createTable(doc: CommentMarkDocument, rowText: string): Edit {
  const source = doc.source
  const eol = doc.lineEnding
  const header = '| Ref | Quote | Author | Date | Comment | Status |'
  const delimiter = '|---|---|---|---|---|---|'
  // §6.7: the pointer, a blank line, then the heading.
  const table = [POINTER, '', `## ${DEFAULT_HEADING}`, '', header, delimiter, rowText].join(eol)
  const body = source.slice(doc.bodyStart)
  let lead: string
  if (body.trim() === '') lead = source.length > 0 && !endsWithLineEnding(source) ? eol : ''
  else lead = eol.repeat(Math.max(0, 2 - trailingLineEndings(source)))
  const finalNewline = body.trim() === '' || endsWithLineEnding(source)
  return insertion(source.length, lead + table + (finalNewline && !endsWithLineEnding(table) ? eol : ''))
}

/** Number of line endings at the end of `source`, ignoring spaces and tabs between them. */
function trailingLineEndings(source: string): number {
  let count = 0
  let at = source.length
  for (;;) {
    while (at > 0 && (source[at - 1] === ' ' || source[at - 1] === '\t')) at--
    if (source.slice(at - 2, at) === '\r\n') at -= 2
    else if (source[at - 1] === '\n' || source[at - 1] === '\r') at -= 1
    else return count
    count++
  }
}

/** Delete whole rows; if no rows would remain, delete the table instead. */
export function removeRows(doc: CommentMarkDocument, rows: readonly Row[]): Edit[] {
  const table = doc.table!
  const distinct = new Set(rows)
  if (distinct.size >= table.rows.length) return removeTable(doc)
  return removeLines(doc.source, [...distinct].map((row) => row.range.start))
}

/**
 * Remove whole lines (each with its line ending). Adjacent lines are removed
 * as one block. When the block is the last line of a file with no final line
 * ending, the line ending before it goes instead, so the file still ends
 * without one.
 */
export function removeLines(source: string, offsets: readonly number[]): Edit[] {
  const spans = offsets
    .map((offset) => {
      const start = lineStart(source, offset)
      const end = lineEnd(source, offset)
      return {start, end: end + lineEndingLength(source, end)}
    })
    .sort((a, b) => a.start - b.start)
  const merged: Array<{start: number; end: number}> = []
  for (const span of spans) {
    const last = merged[merged.length - 1]
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end)
    else merged.push({...span})
  }
  return merged.map(({start, end}) => {
    if (end === source.length && !endsWithLineEnding(source)) {
      let before = start
      if (source[before - 1] === '\n') before--
      if (source[before - 1] === '\r') before--
      return deletion(before, end)
    }
    return deletion(start, end)
  })
}

/**
 * Remove the comments table, the heading directly above it if its text is
 * `Comments` (§6.2), and a recognised pointer (§6.7), along with the blank
 * lines that separated them from the previous block. A heading with other
 * text stays, even when the pointer above it goes.
 */
export function removeTable(doc: CommentMarkDocument): Edit[] {
  const table = doc.table!
  const nodes = doc.root.children
  const doomed = new Set<RootContent>([table.node])
  if (table.heading && table.heading.text === DEFAULT_HEADING) doomed.add(table.heading.node)
  if (table.pointer) doomed.add(table.pointer.node)
  // Remove each run of adjacent doomed nodes with the separation before it.
  const edits: Edit[] = []
  let i = 0
  while (i < nodes.length) {
    if (!doomed.has(nodes[i]!)) {
      i++
      continue
    }
    let j = i
    while (j + 1 < nodes.length && doomed.has(nodes[j + 1]!)) j++
    const first = nodes[i]!
    const last = nodes[j]!
    const previous = nodes[i - 1]
    const next = nodes[j + 1]
    if (previous && !next && countLineEndings(doc.source.slice(endOf(previous), startOf(first))) > 2) {
      // `createTable` adds no blank line when the document already ends with
      // more than one, so take only the block and its own line ending.
      const end = endOf(last)
      edits.push(deletion(lineStart(doc.source, startOf(first)), end + lineEndingLength(doc.source, end)))
    } else if (previous) edits.push(deletion(endOf(previous), endOf(last)))
    else if (next) edits.push(deletion(lineStart(doc.source, startOf(first)), lineStart(doc.source, startOf(next))))
    else edits.push(deletion(doc.bodyStart, doc.source.length))
    i = j + 1
  }
  return edits
}

/**
 * Replace the content of one cell (`column` is 0-based). Cells missing from
 * a short row are added. `text` must already be escaped for a cell.
 */
export function setCell(doc: CommentMarkDocument, row: Row, column: number, text: string): Edit {
  const cell = row.cells[column]
  if (cell) {
    if (cell.contentRange.start < cell.contentRange.end && text !== '') {
      return {start: cell.contentRange.start, end: cell.contentRange.end, text}
    }
    return {start: cell.range.start, end: cell.range.end, text: text === '' ? ' ' : ` ${text} `}
  }
  // Short row: append empty cells up to the column, then the new one.
  const last = row.cells[row.cells.length - 1]
  const hasTrailingPipe = last !== undefined && last.range.end < row.range.end
  const pieces = [...Array(column - row.cells.length).fill(''), text] as string[]
  const added = hasTrailingPipe
    ? pieces.map((p) => (p === '' ? ' |' : ` ${p} |`)).join('')
    : pieces.map((p) => (p === '' ? ' |' : ` | ${p}`)).join('')
  return insertion(row.range.end, added)
}
