import {describe, expect, test} from 'vitest'
import {createThread, deleteThread, parse, PlacementError, SidemarkError, type SourceRange} from '../src/index.js'

const fixed = {generateId: () => 'c-test01', now: () => new Date('2026-11-17T10:32:00Z')}

function body(source: string): string {
  const at = source.indexOf('\n## Comments')
  return at === -1 ? source : source.slice(0, at)
}

function select(source: string, text: string, occurrence = 1): SourceRange {
  let at = -1
  for (let n = 0; n < occurrence; n++) at = source.indexOf(text, at + 1)
  if (at === -1) throw new Error(`not found: ${text}`)
  return {start: at, end: at + text.length}
}

function comment(source: string, range: SourceRange | null): string {
  return createThread(source, {range, author: '@t', comment: 'c'}, fixed).source
}

describe('inline placement (§5.3)', () => {
  test('anchors hug the selection in plain text', () => {
    const s = 'The quick brown fox.\n'
    expect(body(comment(s, select(s, 'quick')))).toBe('The <a id="c-test01"></a>quick<a id="c-test01-end"></a> brown fox.\n')
  })

  test('boundaries touching emphasis delimiters go outside them, through nesting', () => {
    const s = 'A ***very*** ~~old~~ *b* c.\n'
    expect(body(comment(s, select(s, 'very')))).toBe('A <a id="c-test01"></a>***very***<a id="c-test01-end"></a> ~~old~~ *b* c.\n')
    expect(body(comment(s, select(s, 'old')))).toBe('A ***very*** <a id="c-test01"></a>~~old~~<a id="c-test01-end"></a> *b* c.\n')
  })

  test('only the boundary that touches a delimiter moves outside it', () => {
    const s = 'A **bold words** here.\n'
    expect(body(comment(s, select(s, 'words')))).toBe('A **bold <a id="c-test01"></a>words**<a id="c-test01-end"></a> here.\n')
  })

  test('boundaries inside links, images, code spans and autolinks snap outward', () => {
    const s = 'See [the docs](http://x) and ![a chart](c.png), `code span`, <http://auto.link> end.\n'
    const linked = body(comment(s, select(s, 'docs')))
    expect(linked).toContain('<a id="c-test01"></a>[the docs](http://x)<a id="c-test01-end"></a>')
    expect(body(comment(s, select(s, 'chart')))).toContain('<a id="c-test01"></a>![a chart](c.png)<a id="c-test01-end"></a>')
    expect(body(comment(s, select(s, 'span')))).toContain('<a id="c-test01"></a>`code span`<a id="c-test01-end"></a>')
    expect(body(comment(s, select(s, 'auto')))).toContain('<a id="c-test01"></a><http://auto.link><a id="c-test01-end"></a>')
  })

  test('a link inside strong snaps to the link, then outside the strong', () => {
    const s = 'Go **[home](/)** now.\n'
    expect(body(comment(s, select(s, 'home')))).toBe('Go <a id="c-test01"></a>**[home](/)**<a id="c-test01-end"></a> now.\n')
  })

  test('boundaries inside escapes, entities and surrogate pairs snap outward', () => {
    const s = 'a &amp; b \\* c 😀 d\n'
    const r = {start: s.indexOf('amp'), end: s.indexOf('😀') + 1}
    expect(body(comment(s, r))).toBe('a <a id="c-test01"></a>&amp; b \\* c 😀<a id="c-test01-end"></a> d\n')
  })

  test('a selection that starts in a container prefix moves to the content', () => {
    const s = '> line one\n> line two\n'
    const r = {start: s.indexOf('> line two'), end: s.indexOf('two') + 3}
    expect(body(comment(s, r))).toBe('> line one<a id="c-test01"></a>\n> line two<a id="c-test01-end"></a>\n')
  })

  test('a selection of whitespace between blocks is rejected', () => {
    const s = 'One.\n\n\n\nTwo.\n'
    const r = {start: s.indexOf('\n\n'), end: s.indexOf('Two')}
    expect(() => comment(s, r)).toThrow(SidemarkError)
  })
})

describe('blocks that cannot hold anchors (§5.4)', () => {
  test('fenced code at top level: own paragraphs with blank lines', () => {
    const s = 'Intro.\n\n```\ncode\n```\n\nOutro.\n'
    expect(body(comment(s, select(s, 'code')))).toBe(
      'Intro.\n\n<a id="c-test01"></a>\n\n```\ncode\n```\n\n<a id="c-test01-end"></a>\n\nOutro.\n'
    )
  })

  test('a fence that interrupts a paragraph gets a blank line before the anchor', () => {
    const s = 'Intro.\n```\ncode\n```\nOutro.\n'
    expect(body(comment(s, select(s, 'code')))).toBe(
      'Intro.\n\n<a id="c-test01"></a>\n\n```\ncode\n```\n\n<a id="c-test01-end"></a>\n\nOutro.\n'
    )
  })

  test('HTML blocks and thematic breaks', () => {
    const s = 'A.\n\n<div>\nhi\n</div>\n\nB.\n\n***\n\nC.\n'
    const html = parse(comment(s, select(s, 'hi'))).threads[0]!
    expect(html.attachment).toMatchObject({kind: 'anchored', via: 'anchors'})
    const hr = comment(s, select(s, '***'))
    expect(body(hr)).toContain('<a id="c-test01"></a>\n\n***\n\n<a id="c-test01-end"></a>')
  })

  test('a range from text into a code block ends after the block', () => {
    const s = 'Intro text.\n\n```\ncode\n```\n'
    const out = body(comment(s, {start: s.indexOf('text'), end: s.indexOf('code') + 2}))
    expect(out).toBe('Intro <a id="c-test01"></a>text.\n\n```\ncode\n```\n\n<a id="c-test01-end"></a>\n')
  })

  test('a second thread on the same block joins the existing anchor paragraphs', () => {
    const s = 'Intro.\n\n```\ncode\n```\n\nOutro.\n'
    const once = comment(s, select(s, 'code'))
    const twice = createThread(once, {range: select(once, 'code'), author: '@u', comment: 'again'}, {
      generateId: () => 'c-test02',
      now: fixed.now
    }).source
    expect(body(twice)).toBe(
      'Intro.\n\n<a id="c-test01"></a><a id="c-test02"></a>\n\n```\ncode\n```\n\n<a id="c-test02-end"></a><a id="c-test01-end"></a>\n\nOutro.\n'
    )
  })

  test('unsafe placements throw PlacementError', () => {
    const s = '* ---\n* next\n'
    expect(() => comment(s, select(s, '---'))).toThrow(PlacementError)
  })
})

describe('placement never changes how the body parses', () => {
  const corpus = [
    '# Title\n\nPlain *em* **strong** ~~del~~ `code` [link](http://x "t") ![img](i.png) www.auto.com <b>html</b> &amp; \\* text.\nSecond line  \nhard break.\n',
    '- one\n- two\n  continued\n- ```js\n  code\n  ```\n- [ ] task\n\n1. ordered\n2. list\n\n> quote\n> > nested\n> lazy\ncontinuation\n',
    '| a | b |\n|:--|--:|\n| `x \\| y` | **z** |\n| c | d |\n\nSetext\n===\n\n    indented code\n\nTerm[^1].\n\n[^1]: Footnote text.\n\n[ref]: http://example.com\n',
    'Intro\r\n\r\n> CRLF quote\r\n> continues\r\n\r\n```\r\nfenced\r\n```\r\n\r\n* item\r\n* item two\r\n',
    '---\ntitle: front\n---\n\nAfter front matter, a_b_c and 2*3*4 and foo*bar*baz and snake_case_name.\n\n<div>\nhtml block\n</div>\n\nEnd.\n',
    'Emoji 😀 text, tabs\tand  double  spaces, punctuation (parens) "quotes" — dashes.\n\n***\n\nAfter break.\n'
  ]

  let seed = 7
  const random = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31
    return Math.floor((seed / 2 ** 31) * n)
  }

  for (const [index, source] of corpus.entries()) {
    test(`random ranges in document ${index}: create → verify → delete restores the bytes`, () => {
      const original = parse(source)
      let placed = 0
      for (let attempt = 0; attempt < 60; attempt++) {
        const a = original.bodyStart + random(source.length - original.bodyStart)
        const b = original.bodyStart + random(source.length - original.bodyStart)
        const range = {start: Math.min(a, b), end: Math.max(a, b) + 1}
        if (range.end > source.length) continue
        let created: string
        try {
          created = comment(source, range)
        } catch (error) {
          expect(error).toBeInstanceOf(SidemarkError)
          expect(['INVALID_RANGE', 'UNSAFE_PLACEMENT']).toContain((error as SidemarkError).code)
          continue
        }
        placed++
        const doc = parse(created)
        const thread = doc.threads.find((t) => t.id === 'c-test01')!
        expect(thread.attachment).toMatchObject({kind: 'anchored', via: 'anchors'})
        expect(doc.projection.text).toBe(original.projection.text)
        expect(doc.strayAnchors).toEqual([])
        expect(deleteThread(created, 'c-test01')).toBe(source)
      }
      expect(placed).toBeGreaterThan(20)
    })
  }
})
