/**
 * The Writer. Every operation is a pure function from source to source,
 * implemented as splices on the original text (§9.1).
 */
import {pairContentRange, validPair} from './anchors.js'
import {removeAnchors} from './anchor-edits.js'
import {formatDate, isWriterDate} from './dates.js'
import {applyEdits, type Edit} from './edits.js'
import {CommentMarkError} from './errors.js'
import {isThreadId, randomThreadId} from './ids.js'
import {parse} from './parse.js'
import {placeAnchors} from './placement.js'
import {projectionSpan} from './projection.js'
import {buildQuote, writePlainCell, writeQuoteCell} from './quote.js'
import {
  appendRow,
  cellMarkdown,
  columnCount,
  createTable,
  formatRow,
  insertLineAfter,
  insertRowBefore,
  removeRows,
  setCell,
  type RowCells
} from './rows.js'
import {COLUMN} from './table.js'
import type {CommentMarkDocument, SourceRange, Thread} from './types.js'

export interface WriterOptions {
  /** Returns a new thread ID. Defaults to 6 random characters (§4). */
  generateId?: () => string
  /** Returns the current time, used when no `date` is given. */
  now?: () => Date
}

export interface NewComment {
  author: string
  /** Markdown. Newlines are written as `<br>` and `|` is escaped (§6.4). */
  comment: string
  /** A `Date`, or a string already in the form `YYYY-MM-DDThh:mmZ`. Defaults to now. */
  date?: Date | string
}

export interface CreateThreadInput extends NewComment {
  /** Source offsets of the commented text, or `null` for a document-level thread. */
  range: SourceRange | null
}

export interface StatusChange {
  status: 'open' | 'resolved'
  author: string
  comment?: string
  date?: Date | string
}

/** Identifies one comment: its thread and its position in the thread (0 = root). */
export interface CommentRef {
  threadId: string
  index: number
}

export interface PurgeOptions {
  resolved?: boolean
  orphaned?: boolean
}

// ---------------------------------------------------------------------------
// Creating

/**
 * Create a thread (§9.2). With a range, inserts an anchor pair (§5.3, §5.4)
 * and a root row whose Quote is computed from the anchored text (§7.2);
 * without one, adds a document-level row. Creates the comments table if
 * needed (§6.2).
 *
 * @throws PlacementError if anchors cannot be placed without changing how
 *   the body parses; CommentMarkError `INVALID_RANGE` for an unusable range.
 */
export function createThread(
  source: string,
  input: CreateThreadInput,
  options: WriterOptions = {}
): {source: string; id: string} {
  const original = parse(source)
  const id = newThreadId(original, options)
  const comment = requireComment(input.comment, '')
  const date = dateCell(input.date, options)

  let doc = original
  let cells: Pick<RowCells, 'ref' | 'quote'> = {ref: id, quote: ''}
  let rangeStart: number | null = null
  if (input.range) {
    doc = placeAnchors(original, input.range, id).doc
    const pair = validPair(doc.anchors, id, doc.source)!
    const range = pairContentRange(pair)
    const span = projectionSpan(doc.projection, range)
    const parts = buildQuote(doc.projection, span.from, span.to)
    cells = {ref: `[${id}](#${id})`, quote: parts ? writeQuoteCell(parts) : ''}
    rangeStart = range.start
  }

  const row = formatRow(
    {...cells, author: authorCell(input.author), date, comment, status: ''},
    columnCount(doc)
  )
  const result = applyEdits(doc.source, [rootRowInsertion(doc, row, rangeStart)])

  const check = parse(result).threads.find((t) => t.id === id)
  const expected = input.range ? 'anchored' : 'document'
  if (!check || check.attachment.kind !== expected || check.comments.length !== 1) {
    throw new CommentMarkError('UNSAFE_EDIT', 'The new comments table row did not read back as expected')
  }
  return {source: result, id}
}

/**
 * §9.2 step 4: before the first row of the first anchored thread (in table
 * order) whose range starts later; otherwise at the end of the table.
 * Threads are considered in table order, those anchored by the Quote
 * fallback included, and an equal start is not "later" (§9.2).
 */
function rootRowInsertion(doc: CommentMarkDocument, row: string, rangeStart: number | null): Edit {
  if (!doc.table) return createTable(doc, row)
  if (rangeStart !== null) {
    const later = doc.threads.find(
      (t) => t.attachment.kind === 'anchored' && t.attachment.range.start > rangeStart
    )
    if (later) return insertRowBefore(doc, later.comments[0]!.row, row)
  }
  return appendRow(doc, row)
}

// ---------------------------------------------------------------------------
// Replying and changing status

/** Add a reply directly after the thread's last row (§9.3). */
export function addReply(source: string, threadId: string, reply: NewComment, options: WriterOptions = {}): string {
  const doc = parse(source)
  const thread = requireThread(doc, threadId)
  const row = formatRow(
    {
      ref: refFor(doc, thread),
      quote: '',
      author: authorCell(reply.author),
      date: dateCell(reply.date, options),
      comment: requireComment(reply.comment, ''),
      status: ''
    },
    columnCount(doc)
  )
  return applyEdits(source, [afterLastRow(doc, thread, row)])
}

/** Resolve or reopen a thread by adding a status row (§9.3). */
export function setStatus(
  source: string,
  threadId: string,
  change: StatusChange,
  options: WriterOptions = {}
): string {
  if (change.status !== 'open' && change.status !== 'resolved') {
    throw new CommentMarkError('INVALID_ARGUMENT', `Unknown status ${String(change.status)}`)
  }
  const doc = parse(source)
  const thread = requireThread(doc, threadId)
  const row = formatRow(
    {
      ref: refFor(doc, thread),
      quote: '',
      author: authorCell(change.author),
      date: dateCell(change.date, options),
      comment: cellMarkdown(change.comment ?? ''),
      status: change.status
    },
    columnCount(doc)
  )
  return applyEdits(source, [afterLastRow(doc, thread, row)])
}

function afterLastRow(doc: CommentMarkDocument, thread: Thread, row: string): Edit {
  const last = thread.comments[thread.comments.length - 1]!.row
  return insertLineAfter(doc, last.range.end, row)
}

/**
 * Ref for a new row of an existing thread (§6.4): a link if the thread has
 * anchors, the bare ID if it is document-level, and otherwise the same form
 * as the root row's Ref.
 */
function refFor(doc: CommentMarkDocument, thread: Thread): string {
  const link = `[${thread.id}](#${thread.id})`
  if (thread.anchors) return link
  if (thread.attachment.kind === 'document') return thread.id
  const rootRef = thread.comments[0]!.row.cells[COLUMN.ref]?.source ?? ''
  return rootRef.includes('](') ? link : thread.id
}

// ---------------------------------------------------------------------------
// Editing and deleting

/** Replace a comment's text in place (§9.4). */
export function editComment(source: string, ref: CommentRef, comment: string): string {
  const doc = parse(source)
  const existing = requireCommentRow(doc, ref)
  const cell = requireComment(comment, existing.status.raw)
  return applyEdits(source, [setCell(doc, existing.row, COLUMN.comment, cell)])
}

/**
 * Delete one comment (§9.4). Deleting the root promotes the next row and
 * fills in its Quote. Deleting a thread's only comment deletes the thread.
 * §9.4: an anchored thread's new root gets a freshly computed Quote; any
 * other thread's new root gets the deleted root's Quote cell unchanged.
 */
export function deleteComment(source: string, ref: CommentRef): string {
  const doc = parse(source)
  const thread = requireThread(doc, ref.threadId)
  const comment = requireCommentRow(doc, ref)
  if (thread.comments.length === 1) return deleteThread(source, ref.threadId)
  const edits = removeRows(doc, [comment.row])
  if (ref.index === 0) {
    const newRoot = thread.comments[1]!.row
    const oldQuote = comment.row.cells[COLUMN.quote]?.source ?? ''
    const quote = thread.attachment.kind === 'anchored' ? quoteCellFor(doc, thread) ?? oldQuote : oldQuote
    const current = newRoot.cells[COLUMN.quote]?.source ?? ''
    if (quote !== current) edits.push(setCell(doc, newRoot, COLUMN.quote, quote))
  }
  return applyEdits(source, edits)
}

/** Delete a thread: all its rows and all its anchors (§9.4). */
export function deleteThread(source: string, threadId: string): string {
  const doc = parse(source)
  const thread = requireThread(doc, threadId)
  return applyEdits(source, threadRemovalEdits(doc, [thread]))
}

/**
 * Delete every resolved and/or orphaned thread (§9.5). Only call this on an
 * explicit request from the user.
 */
export function purge(source: string, options: PurgeOptions): string {
  const doc = parse(source)
  const doomed = doc.threads.filter(
    (t) => (options.resolved && t.state === 'resolved') || (options.orphaned && t.attachment.kind === 'orphaned')
  )
  if (doomed.length === 0) return source
  return applyEdits(source, threadRemovalEdits(doc, doomed))
}

function threadRemovalEdits(doc: CommentMarkDocument, threads: readonly Thread[]): Edit[] {
  const ids = new Set(threads.map((t) => t.id))
  const rows = threads.flatMap((t) => t.comments.map((c) => c.row))
  const anchors = doc.anchors.filter((a) => ids.has(a.threadId))
  return [...removeRows(doc, rows), ...removeAnchors(doc, anchors)]
}

/** Quote cell Markdown for an anchored thread's current range (§7.2, §7.3). */
export function quoteCellFor(doc: CommentMarkDocument, thread: Thread): string | null {
  if (thread.attachment.kind !== 'anchored') return null
  const span = projectionSpan(doc.projection, thread.attachment.range)
  const parts = buildQuote(doc.projection, span.from, span.to)
  return parts ? writeQuoteCell(parts) : null
}

// ---------------------------------------------------------------------------
// Helpers

function requireThread(doc: CommentMarkDocument, id: string): Thread {
  const thread = doc.threads.find((t) => t.id === id)
  if (!thread) throw new CommentMarkError('THREAD_NOT_FOUND', `No thread ${id}`)
  return thread
}

function requireCommentRow(doc: CommentMarkDocument, ref: CommentRef) {
  const comment = requireThread(doc, ref.threadId).comments[ref.index]
  if (!comment) throw new CommentMarkError('COMMENT_NOT_FOUND', `Thread ${ref.threadId} has no comment ${ref.index}`)
  return comment
}

/** §6.4: a row may not have both Comment and Status empty. */
function requireComment(comment: string, status: string): string {
  const cell = cellMarkdown(comment)
  if (cell === '' && status.trim() === '') {
    throw new CommentMarkError('EMPTY_COMMENT', 'A comment needs text unless the row records a status')
  }
  return cell
}

function authorCell(author: string): string {
  return writePlainCell(author.replace(/\s+/g, ' ').trim())
}

function dateCell(date: Date | string | undefined, options: WriterOptions): string {
  if (typeof date === 'string') {
    if (!isWriterDate(date)) {
      throw new CommentMarkError('INVALID_DATE', `Dates must be written as YYYY-MM-DDThh:mmZ, got ${date}`)
    }
    return date
  }
  const value = date ?? options.now?.() ?? new Date()
  if (Number.isNaN(value.getTime())) throw new CommentMarkError('INVALID_DATE', 'Invalid date')
  return formatDate(value)
}

/**
 * §4: IDs are regenerated while they appear in the document.
 *
 * SPEC NOTE (§4): writers must generate `c-` + 6 random characters. An
 * injected `generateId` (for tests and fixtures) may return any valid thread
 * ID; only the default generator follows the 6-character rule.
 */
function newThreadId(doc: CommentMarkDocument, options: WriterOptions): string {
  const generate = options.generateId ?? randomThreadId
  for (let attempt = 0; attempt < 100; attempt++) {
    const id = generate()
    if (!isThreadId(id)) throw new CommentMarkError('INVALID_ID', `Not a thread ID: ${id}`)
    // §4: regenerate if the ID already appears anywhere in the document.
    if (!doc.source.includes(id)) return id
  }
  throw new CommentMarkError('ID_COLLISION', 'Could not generate an unused thread ID')
}
