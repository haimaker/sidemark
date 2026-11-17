import {describe, expect, test} from 'vitest'
import {createThread, parse, CommentMarkError, PlacementError} from '@commentmark/core'
import {loadAuthor, looksLikeEmail, normaliseAuthor, saveAuthor, suggestHandle} from '../src/model/author'
import {describeError} from '../src/model/errors'
import {groupThreads, hiddenNodes, highlightsFor, PENDING_ID, purgeCandidates, purgeCount, quoteText} from '../src/model/groups'
import * as H from '../src/model/history'
import {layoutCards} from '../src/model/layout'
import sample from '../src/sample.md?raw'

describe('history', () => {
  test('commit, undo, redo and the saved marker', () => {
    let h = H.createHistory('a')
    expect(H.isDirty(h)).toBe(false)
    h = H.commit(h, 'b')
    h = H.commit(h, 'c')
    expect(H.current(h)).toBe('c')
    expect(H.isDirty(h)).toBe(true)
    h = H.undo(h)
    expect(H.current(h)).toBe('b')
    expect(H.canRedo(h)).toBe(true)
    h = H.undo(h)
    expect(H.isDirty(h)).toBe(false)
    expect(H.undo(h)).toBe(h)
    h = H.redo(h)
    // A new commit drops the redo branch.
    h = H.commit(h, 'x')
    expect(H.canRedo(h)).toBe(false)
    expect(h.entries).toEqual(['a', 'b', 'x'])
    h = H.markSaved(h, 'x')
    expect(H.isDirty(h)).toBe(false)
    expect(H.isDirty(H.undo(h))).toBe(true)
  })

  test('identical sources are not recorded', () => {
    const h = H.createHistory('a')
    expect(H.commit(h, 'a')).toBe(h)
  })

  test('history is bounded', () => {
    let h = H.createHistory('0')
    for (let i = 1; i <= 250; i++) h = H.commit(h, String(i))
    expect(h.entries.length).toBe(200)
    expect(H.current(h)).toBe('250')
    expect(h.index).toBe(199)
  })
})

describe('margin layout', () => {
  test('cards keep their desired top when there is room', () => {
    const tops = layoutCards([{id: 'a', top: 0, height: 50}, {id: 'b', top: 100, height: 50}], null)
    expect([...tops]).toEqual([['a', 0], ['b', 100]])
  })

  test('overlapping cards are pushed down in order', () => {
    const tops = layoutCards(
      [{id: 'b', top: 10, height: 50}, {id: 'a', top: 0, height: 50}, {id: 'c', top: 20, height: 50}],
      null,
      8
    )
    expect(tops.get('a')).toBe(0)
    expect(tops.get('b')).toBe(58)
    expect(tops.get('c')).toBe(116)
  })

  test('the focused card sits at its range; earlier cards move up', () => {
    const cards = [{id: 'a', top: 0, height: 50}, {id: 'b', top: 10, height: 50}, {id: 'c', top: 20, height: 50}]
    const tops = layoutCards(cards, 'c', 8)
    expect(tops.get('c')).toBe(20)
    expect(tops.get('b')).toBe(20 - 8 - 50)
    expect(tops.get('a')).toBe(-38 - 8 - 50)
    // No overlaps.
    const boxes = cards.map((c) => [tops.get(c.id)!, tops.get(c.id)! + c.height]).sort((x, y) => x[0]! - y[0]!)
    for (let i = 1; i < boxes.length; i++) expect(boxes[i]![0]!).toBeGreaterThanOrEqual(boxes[i - 1]![1]!)
  })

  test('cards after the focused one are pushed down from it', () => {
    const tops = layoutCards([{id: 'a', top: 0, height: 100}, {id: 'b', top: 30, height: 50}], 'a', 8)
    expect(tops.get('a')).toBe(0)
    expect(tops.get('b')).toBe(108)
  })
})

describe('thread groups', () => {
  const doc = parse(sample)

  test('the sample demonstrates every attachment state', () => {
    const kinds = doc.threads.map((t) => `${t.attachment.kind}/${t.state}`)
    expect(kinds).toContain('anchored/open')
    expect(kinds).toContain('anchored/resolved')
    expect(kinds).toContain('orphaned/open')
    expect(kinds).toContain('document/open')
    expect(doc.strayAnchors).toHaveLength(0)
    expect(doc.malformedRows).toHaveLength(0)
  })

  test('resolved threads are hidden unless asked for', () => {
    const hidden = groupThreads(doc, false)
    expect(hidden.anchored.every((t) => t.state === 'open')).toBe(true)
    expect(hidden.hiddenResolved).toEqual({anchored: 1, detached: 0, document: 0, total: 1})
    const shown = groupThreads(doc, true)
    expect(shown.anchored.length).toBe(hidden.anchored.length + 1)
    expect(shown.detached.map((t) => t.id)).toEqual(['c-gone77'])
    expect(shown.document.map((t) => t.id)).toEqual(['c-doc888'])
  })

  test('anchored threads are in document order', () => {
    const starts = groupThreads(doc, true).anchored.map((t) => (t.attachment as {range: {start: number}}).range.start)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
  })

  test('highlights include the pending selection', () => {
    const groups = groupThreads(doc, false)
    const highlights = highlightsFor(groups, {start: 1, end: 5})
    expect(highlights.at(-1)).toEqual({id: PENDING_ID, range: {start: 1, end: 5}})
    expect(highlights.length).toBe(groups.anchored.length + 1)
  })

  test('only a default Comments heading is hidden', () => {
    expect([...hiddenNodes(doc)].map((n) => n.type).sort()).toEqual(['heading', 'table'])
    const renamed = parse('Hi.\n\n## Notes\n\n| Ref | Quote | Author | Date | Comment | Status |\n|---|---|---|---|---|---|\n| c-1 | | | | x | |\n')
    expect([...hiddenNodes(renamed)].map((n) => n.type)).toEqual(['table'])
    const lower = parse('Hi.\n\n## comments\n\n| Ref | Quote | Author | Date | Comment | Status |\n|---|---|---|---|---|---|\n| c-1 | | | | x | |\n')
    expect(hiddenNodes(lower).size).toBe(2)
    expect(hiddenNodes(parse('No table.\n')).size).toBe(0)
  })

  test('purge candidates and counts', () => {
    const candidates = purgeCandidates(doc)
    expect(candidates.resolved.map((t) => t.id)).toEqual(['c-done66'])
    expect(candidates.orphaned.map((t) => t.id)).toEqual(['c-gone77'])
    expect(purgeCount(candidates, {resolved: true, orphaned: true})).toBe(2)
    expect(purgeCount(candidates, {resolved: false, orphaned: true})).toBe(1)
    expect(purgeCount(candidates, {resolved: false, orphaned: false})).toBe(0)
    // A thread that is both resolved and orphaned counts once.
    const both = parse('Body.\n\n| Ref | Quote | Author | Date | Comment | Status |\n|---|---|---|---|---|---|\n| c-1 | **gone** | @a | | x | resolved |\n')
    expect(purgeCount(purgeCandidates(both), {resolved: true, orphaned: true})).toBe(1)
  })

  test('quote text', () => {
    const byId = (id: string) => doc.threads.find((t) => t.id === id)!
    expect(quoteText(byId('c-intro1'))).toBe('inside the Markdown file itself')
    expect(quoteText(byId('c-gone77'))).toBe('the old storage format')
    expect(quoteText(byId('c-doc888'))).toBe('')
  })
})

describe('author', () => {
  test('remembered in storage, and storage failures are ignored', () => {
    const store = new Map<string, string>()
    const storage = {getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v)}
    expect(loadAuthor(storage)).toBe('')
    saveAuthor('@ada', storage)
    expect(loadAuthor(storage)).toBe('@ada')
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      }
    }
    expect(loadAuthor(broken)).toBe('')
    expect(() => saveAuthor('@x', broken)).not.toThrow()
    expect(loadAuthor(null)).toBe('')
  })

  test('handle suggestions and email detection', () => {
    expect(normaliseAuthor('  Ada   Lovelace ')).toBe('Ada Lovelace')
    expect(suggestHandle('ada')).toBe('@ada')
    expect(suggestHandle('@ada')).toBeNull()
    expect(suggestHandle('Ada Lovelace')).toBeNull()
    expect(looksLikeEmail('ada@example.com')).toBe(true)
    expect(looksLikeEmail('@ada')).toBe(false)
  })
})

describe('error messages', () => {
  test('core refusals become short messages', () => {
    let error: unknown
    try {
      createThread('Text.\n', {range: {start: 0, end: 0}, author: '', comment: 'x'})
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(CommentMarkError)
    expect(describeError(error)).toMatch(/can’t be commented on/)
    expect(describeError(new PlacementError('x'))).toMatch(/can’t be anchored/)
    expect(describeError(new Error('boom'))).toBe('boom')
  })
})
