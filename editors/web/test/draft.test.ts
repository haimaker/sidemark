import {describe, expect, test} from 'vitest'
import {addReply, createThread} from '@sidemark/core'
import {followSelection, hasText, mapRange, type Draft} from '../src/model/draft'
import {INTRO_DISMISSED, readPref, writePref} from '../src/model/prefs'

const ok = () => null
const r = (start: number, end: number) => ({start, end})

describe('the comment box follows the selection', () => {
  test('appears for a selection, with core’s refusal when there is one', () => {
    expect(followSelection(null, r(1, 5), ok)).toEqual({range: r(1, 5), error: null, engaged: false, text: '', stale: false})
    expect(followSelection(null, r(1, 5), () => 'nope')!.error).toBe('nope')
  })

  test('moves with a new selection and disappears when it is cleared', () => {
    const first = followSelection(null, r(1, 5), ok)
    const moved = followSelection(first, r(7, 9), ok)!
    expect(moved.range).toEqual(r(7, 9))
    expect(followSelection(moved, null, ok)).toBeNull()
  })

  test('the same selection keeps the same box (no re-check)', () => {
    const first = followSelection(null, r(1, 5), ok)
    let checked = false
    expect(followSelection(first, r(1, 5), () => ((checked = true), null))).toBe(first)
    expect(checked).toBe(false)
  })

  test('an engaged box survives the selection going away', () => {
    const engaged: Draft = {...followSelection(null, r(1, 5), ok)!, engaged: true}
    expect(followSelection(engaged, null, ok)).toBe(engaged)
    // Still empty: a new selection replaces it, unengaged.
    expect(followSelection(engaged, r(8, 9), ok)).toMatchObject({range: r(8, 9), engaged: false})
  })

  test('a box with draft text is never replaced or dropped by the selection', () => {
    const typed: Draft = {range: r(1, 5), error: null, engaged: true, text: 'my thoughts', stale: false}
    expect(followSelection(typed, null, ok)).toBe(typed)
    expect(followSelection(typed, r(20, 30), ok)).toBe(typed)
    expect(hasText(typed)).toBe(true)
    expect(hasText({...typed, text: '  '})).toBe(false)
  })

  test('a stale draft keeps its text and moves to the next selection', () => {
    const stale: Draft = {range: r(1, 5), error: null, engaged: true, text: 'keep me', stale: true}
    expect(followSelection(stale, r(10, 12), () => null)).toEqual({range: r(10, 12), error: null, engaged: false, text: 'keep me', stale: false})
  })
})

describe('mapping a draft range across edits', () => {
  const source = 'Alpha beta gamma.\n\nDelta epsilon.\n'
  const range = r(source.indexOf('epsilon'), source.indexOf('epsilon') + 7)

  test('a document-level comment (table only) keeps the range', () => {
    const after = createThread(source, {range: null, author: '@a', comment: 'x'}).source
    const mapped = mapRange(source, after, range)!
    expect(after.slice(mapped.start, mapped.end)).toBe('epsilon')
  })

  test('changes on both sides of the range are not mapped (the draft goes stale)', () => {
    // Anchors go in before the range and the table after it: one splice cannot explain both.
    const start = source.indexOf('beta')
    const after = createThread(source, {range: r(start, start + 4), author: '@a', comment: 'x'}).source
    expect(mapRange(source, after, range)).toBeNull()
    // But a range before both changes is kept.
    const alpha = r(0, 5)
    expect(mapRange(source, after, alpha)).toEqual(alpha)
  })

  test('a reply (table only) keeps the range', () => {
    const start = source.indexOf('beta')
    const withThread = createThread(source, {range: r(start, start + 4), author: '@a', comment: 'x'})
    const at = withThread.source.indexOf('epsilon')
    const replied = addReply(withThread.source, withThread.id, {author: '@b', comment: 'y'})
    const mapped = mapRange(withThread.source, replied, r(at, at + 7))!
    expect(replied.slice(mapped.start, mapped.end)).toBe('epsilon')
  })

  test('a change after the range keeps it; one before shifts it; one inside gives null', () => {
    expect(mapRange(source, source + 'more\n', range)).toEqual(range)
    const before = 'New. ' + source
    const shifted = mapRange(source, before, range)!
    expect(before.slice(shifted.start, shifted.end)).toBe('epsilon')
    expect(mapRange(source, source.replace('epsilon', 'EPSILON'), range)).toBeNull()
  })
})

describe('preferences', () => {
  test('read and write, ignoring broken storage', () => {
    const store = new Map<string, string>()
    const storage = {getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v)}
    expect(readPref(INTRO_DISMISSED, storage)).toBeNull()
    writePref(INTRO_DISMISSED, '1', storage)
    expect(readPref(INTRO_DISMISSED, storage)).toBe('1')
    const broken = {
      getItem: (): string | null => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      }
    }
    expect(readPref(INTRO_DISMISSED, broken)).toBeNull()
    expect(() => writePref(INTRO_DISMISSED, '1', broken)).not.toThrow()
  })
})
