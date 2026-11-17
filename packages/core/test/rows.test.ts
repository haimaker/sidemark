import {describe, expect, test} from 'vitest'
import {deleteThread, purge} from '../src/index.js'
import {applyEdits} from '../src/edits.js'
import {removeLines} from '../src/rows.js'
import {splitRow} from '../src/cells.js'
import {escapeCellMarkdown, commentFromCell} from '../src/index.js'
import {parseDate, formatDate} from '../src/index.js'

const TH = '## Comments\n\n| Ref | Quote | Author | Date | Comment | Status |\n|---|---|---|---|---|---|\n'

describe('removing lines', () => {
  test('adjacent lines at the end of a file without a final newline', () => {
    const source = 'a\nb\nc'
    expect(applyEdits(source, removeLines(source, [2, 4]))).toBe('a')
    expect(applyEdits(source, removeLines(source, [0, 4]))).toBe('b')
    expect(applyEdits(source, removeLines(source, [0, 2]))).toBe('c')
  })

  test('deleting the last two rows of a table at end of file keeps no final newline', () => {
    const source = 'Text.\n\n' + TH + '| c-1 | | @a | | keep | |\n| c-2 | | @a | | one | |\n| c-2 | | @b | | two | |'
    expect(deleteThread(source, 'c-2')).toBe('Text.\n\n' + TH + '| c-1 | | @a | | keep | |')
  })

  test('malformed rows keep the table alive', () => {
    const source = 'Text.\n\n' + TH + '| c-1 | | @a | | resolved one | resolved |\n| junk | row |\n'
    expect(purge(source, {resolved: true})).toBe('Text.\n\n' + TH + '| junk | row |\n')
  })
})

describe('splitting rows like GFM', () => {
  const cells = (row: string) => splitRow(row, {start: 0, end: row.length}).map((c) => c.source)
  test('pipes, escapes and optional outer pipes', () => {
    expect(cells('| a | b |')).toEqual(['a', 'b'])
    expect(cells('a | b')).toEqual(['a', 'b'])
    expect(cells('| a \\| b | c')).toEqual(['a \\| b', 'c'])
    expect(cells('| a \\\\| b |')).toEqual(['a \\\\', 'b'])
    expect(cells('| | |')).toEqual(['', ''])
    expect(cells('|  |')).toEqual([''])
  })
})

describe('cell escaping (§6.4)', () => {
  test('pipes and newlines', () => {
    expect(escapeCellMarkdown('a | b\nc')).toBe('a \\| b<br>c')
    // An already escaped pipe stays escaped once.
    expect(escapeCellMarkdown('a \\| b')).toBe('a \\| b')
    expect(escapeCellMarkdown('a \\\\| b')).toBe('a \\\\\\| b')
    expect(commentFromCell('a \\| b<br/>c<BR>d')).toBe('a | b\nc\nd')
  })
})

describe('dates (§6.4)', () => {
  test('reader formats', () => {
    expect(parseDate('2026-11-17T10:32Z')?.toISOString()).toBe('2026-11-17T10:32:00.000Z')
    expect(parseDate('2026-11-17T10:32:05.5Z')?.toISOString()).toBe('2026-11-17T10:32:05.500Z')
    expect(parseDate('2026-11-17T10:32-02:30')?.toISOString()).toBe('2026-11-17T13:02:00.000Z')
    expect(parseDate('2026-11-17')?.toISOString()).toBe('2026-11-17T00:00:00.000Z')
    expect(parseDate('2026-11-31')).toBeNull()
    expect(parseDate('2026-11-17T25:00Z')).toBeNull()
    expect(parseDate('2026-11-17T10:32')).toBeNull()
    expect(parseDate('17/11/2026')).toBeNull()
  })

  test('writer format', () => {
    expect(formatDate(new Date('2026-11-17T10:32:59.999Z'))).toBe('2026-11-17T10:32Z')
  })
})
