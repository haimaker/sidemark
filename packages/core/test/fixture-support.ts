/**
 * Glue between the language-agnostic fixtures in /fixtures and this
 * implementation. The formats are documented in fixtures/README.md.
 */
import {readdirSync, readFileSync, existsSync, statSync} from 'node:fs'
import {join} from 'node:path'
import {
  addReply,
  createThread,
  deleteComment,
  deleteThread,
  editComment,
  maintain,
  purge,
  setStatus,
  type CommentMarkDocument,
  type SourceRange
} from '../src/index.js'

export const FIXTURES = new URL('../../../fixtures/', import.meta.url).pathname

/** Serialise a parsed document to the reader fixture format. */
export function readerResult(doc: CommentMarkDocument): object {
  const source = doc.source
  return {
    projection: doc.projection.text,
    table: doc.table
      ? {
          heading: doc.table.heading?.text ?? null,
          pointer: doc.table.pointer ? source.slice(doc.table.pointer.range.start, doc.table.pointer.range.end) : null,
          columns: doc.table.columns,
          rowCount: doc.table.rows.length
        }
      : null,
    threads: doc.threads.map((thread) => {
      const a = thread.attachment
      return {
        id: thread.id,
        state: thread.state,
        attachment: a.kind,
        anchoredBy: a.kind === 'anchored' ? a.via : null,
        rangeSource: a.kind === 'anchored' ? source.slice(a.range.start, a.range.end) : null,
        rangeText: a.kind === 'anchored' ? a.text : null,
        quote: thread.quote
          ? {prefix: thread.quote.prefix, quote: thread.quote.quote, suffix: thread.quote.suffix, marker: thread.quote.marker}
          : null,
        comments: thread.comments.map((c) => ({
          author: c.author,
          date: c.date.raw,
          dateParsed: c.date.value ? c.date.value.toISOString() : null,
          comment: c.commentSource,
          status: c.status.raw,
          statusValue: c.status.value
        }))
      }
    }),
    strayAnchors: doc.strayAnchors.map((a) => ({id: a.threadId, end: a.isEnd, raw: a.raw, reason: a.stray})),
    malformedRows: doc.malformedRows.map((row) => source.slice(row.range.start, row.range.end))
  }
}

export type RangeSpec = {text: string; occurrence?: number} | {from: string; to: string} | null

/** Turn a fixture range description into source offsets. */
export function resolveRange(source: string, spec: RangeSpec): SourceRange | null {
  if (spec === null) return null
  if ('text' in spec) {
    let at = -1
    for (let n = 0; n < (spec.occurrence ?? 1); n++) {
      at = source.indexOf(spec.text, at + 1)
      if (at === -1) throw new Error(`Range text not found: ${JSON.stringify(spec.text)}`)
    }
    return {start: at, end: at + spec.text.length}
  }
  const start = source.indexOf(spec.from)
  if (start === -1) throw new Error(`Range start not found: ${JSON.stringify(spec.from)}`)
  const toAt = source.indexOf(spec.to, start)
  if (toAt === -1) throw new Error(`Range end not found: ${JSON.stringify(spec.to)}`)
  return {start, end: toAt + spec.to.length}
}

export interface Operation {
  description: string
  operation: string
  args: Record<string, unknown>
  expectError?: string
}

/** Apply a writer fixture operation. */
export function runOperation(source: string, op: Operation): string {
  const a = op.args
  const str = (key: string) => a[key] as string
  const fixed = {generateId: () => str('id'), now: () => new Date(0)}
  switch (op.operation) {
    case 'createThread':
      return createThread(
        source,
        {range: resolveRange(source, a.range as RangeSpec), author: str('author'), comment: str('comment'), date: str('date')},
        fixed
      ).source
    case 'addReply':
      return addReply(source, str('thread'), {author: str('author'), comment: str('comment'), date: str('date')})
    case 'setStatus':
      return setStatus(source, str('thread'), {
        status: str('status') as 'open' | 'resolved',
        author: str('author'),
        comment: (a.comment as string | undefined) ?? '',
        date: str('date')
      })
    case 'editComment':
      return editComment(source, {threadId: str('thread'), index: a.index as number}, str('comment'))
    case 'deleteComment':
      return deleteComment(source, {threadId: str('thread'), index: a.index as number})
    case 'deleteThread':
      return deleteThread(source, str('thread'))
    case 'purge':
      return purge(source, {resolved: Boolean(a.resolved), orphaned: Boolean(a.orphaned)})
    case 'maintain':
      return maintain(source)
    default:
      throw new Error(`Unknown operation ${op.operation}`)
  }
}

export function listReaderCases(): string[] {
  const dir = join(FIXTURES, 'reader')
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3))
    .sort()
}

export function listWriterCases(): string[] {
  const dir = join(FIXTURES, 'writer')
  return readdirSync(dir)
    .filter((f) => statSync(join(dir, f)).isDirectory())
    .sort()
}

export function readText(path: string): string {
  return readFileSync(path, 'utf8')
}

export function maybeRead(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}
