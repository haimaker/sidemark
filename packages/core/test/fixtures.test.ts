/**
 * Runs every case in /fixtures. Set UPDATE_FIXTURES=1 to (re)write expected
 * outputs from this implementation; review the diff before committing.
 */
import {writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {describe, expect, test} from 'vitest'
import {maintain, parse, SidemarkError} from '../src/index.js'
import {
  FIXTURES,
  listReaderCases,
  listWriterCases,
  maybeRead,
  readerResult,
  readText,
  runOperation,
  type Operation
} from './fixture-support.js'

const update = process.env.UPDATE_FIXTURES === '1'

describe('reader fixtures', () => {
  for (const name of listReaderCases()) {
    test(name, () => {
      const source = readText(join(FIXTURES, 'reader', `${name}.md`))
      const actual = readerResult(parse(source))
      const jsonPath = join(FIXTURES, 'reader', `${name}.json`)
      const existing = maybeRead(jsonPath)
      const expected = existing ? (JSON.parse(existing) as Record<string, unknown>) : null
      if (update) {
        const description = expected?.description ?? 'TODO'
        writeFileSync(jsonPath, JSON.stringify({description, ...actual}, null, 2) + '\n')
        return
      }
      expect(expected, `missing ${jsonPath}`).not.toBeNull()
      const {description: _, ...rest} = expected!
      expect(actual).toEqual(rest)
    })
  }
})

describe('writer fixtures', () => {
  for (const name of listWriterCases()) {
    test(name, () => {
      const dir = join(FIXTURES, 'writer', name)
      const input = readText(join(dir, 'input.md'))
      const op = JSON.parse(readText(join(dir, 'operation.json'))) as Operation
      const expectedPath = join(dir, 'expected.md')
      if (op.expectError) {
        let error: unknown = null
        try {
          runOperation(input, op)
        } catch (e) {
          error = e
        }
        expect(error).toBeInstanceOf(SidemarkError)
        expect((error as SidemarkError).code).toBe(op.expectError)
        return
      }
      const output = runOperation(input, op)
      if (update) {
        writeFileSync(expectedPath, output)
        return
      }
      expect(output).toBe(readText(expectedPath))
      // Every writer output is a fixed point of maintenance only if the
      // operation was maintenance itself; but maintenance is always idempotent.
      const maintained = maintain(output)
      expect(maintain(maintained)).toBe(maintained)
    })
  }
})
