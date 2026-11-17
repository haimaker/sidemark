import {join} from 'node:path'
import {describe, expect, test} from 'vitest'
import {maintain, parse} from '../src/index.js'
import {FIXTURES, listReaderCases, listWriterCases, maybeRead, readText} from './fixture-support.js'

function allFixtureDocuments(): Array<[string, string]> {
  const docs: Array<[string, string]> = []
  for (const name of listReaderCases()) docs.push([`reader/${name}`, readText(join(FIXTURES, 'reader', `${name}.md`))])
  for (const name of listWriterCases()) {
    docs.push([`writer/${name}/input`, readText(join(FIXTURES, 'writer', name, 'input.md'))])
    const expected = maybeRead(join(FIXTURES, 'writer', name, 'expected.md'))
    if (expected !== null) docs.push([`writer/${name}/expected`, expected])
  }
  return docs
}

describe('maintain (§9.6)', () => {
  for (const [name, source] of allFixtureDocuments()) {
    test(`idempotent and conservative: ${name}`, () => {
      const once = maintain(source)
      expect(maintain(once)).toBe(once)

      const before = parse(source)
      const after = parse(once)
      // Never deletes a thread or a row.
      expect(after.threads.map((t) => t.id)).toEqual(before.threads.map((t) => t.id))
      expect(after.table?.rows.length ?? 0).toBe(before.table?.rows.length ?? 0)
      // Never changes the body text.
      expect(after.projection.text).toBe(before.projection.text)
      // No stray anchors remain.
      expect(after.strayAnchors).toEqual([])
      for (const thread of before.threads) {
        const next = after.threads.find((t) => t.id === thread.id)!
        if (thread.attachment.kind === 'orphaned') {
          // Orphaned threads are left untouched.
          expect(next.attachment.kind).toBe('orphaned')
          expect(next.comments.map((c) => c.row.cells.map((cell) => cell.source))).toEqual(
            thread.comments.map((c) => c.row.cells.map((cell) => cell.source))
          )
        }
        if (thread.attachment.kind === 'anchored') {
          // Anchored threads stay anchored to the same text, by anchors unless
          // the repair could not be placed safely.
          expect(next.attachment.kind).toBe('anchored')
          if (next.attachment.kind === 'anchored') expect(next.attachment.text).toContain(thread.attachment.text)
          const refs = (t: typeof thread) => t.comments.map((c) => c.row.cells[0]!.source)
          if (next.attachment.kind === 'anchored' && next.attachment.via === 'quote') {
            // Skipped repair: rows untouched, bare Ref stays bare.
            expect(refs(next)).toEqual(refs(thread))
          } else if (thread.attachment.kind === 'anchored' && thread.attachment.via === 'quote') {
            // Repaired: the root Ref is a link; replies keep their Ref as written.
            expect(refs(next)[0]).toBe(`[${thread.id}](#${thread.id})`)
            expect(refs(next).slice(1)).toEqual(refs(thread).slice(1))
          } else {
            expect(refs(next)).toEqual(refs(thread))
          }
        }
        if (thread.attachment.kind === 'document') expect(next.attachment.kind).toBe('document')
      }
    })
  }
})
