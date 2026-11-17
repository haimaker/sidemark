import {describe, expect, test} from 'vitest'
import {createThread, parse} from '@commentmark/core'
import {domRange, findText, setup, textNodes} from './helpers'

/** Select `needle` in the rendered body and map it to source. */
function select(source: string, needle: string, occurrence = 0) {
  const ctx = setup(source)
  const range = ctx.index.rangeToSource(domRange(findText(ctx.container, needle, occurrence)))
  return {...ctx, range}
}

/** Select, create a thread, and return what core anchored it to. */
function comment(source: string, needle: string) {
  const {range} = select(source, needle)
  expect(range).not.toBeNull()
  const created = createThread(source, {range, author: '@t', comment: 'x', date: '2026-01-01T00:00Z'})
  const thread = parse(created.source).threads.find((t) => t.id === created.id)!
  expect(thread.attachment.kind).toBe('anchored')
  return thread.attachment.kind === 'anchored' ? thread.attachment.text : ''
}

describe('DOM selection → source range', () => {
  test('plain text maps to the exact source slice', () => {
    const source = '# Title\n\nThe quick brown fox jumps.\n'
    const {range} = select(source, 'quick brown')
    expect(source.slice(range!.start, range!.end)).toBe('quick brown')
  })

  test('selection across emphasis delimiters', () => {
    const source = 'The quick **brown** fox.\n'
    const {range} = select(source, 'quick brown fox')
    expect(source.slice(range!.start, range!.end)).toBe('quick **brown** fox')
    expect(comment(source, 'quick brown fox')).toBe('quick brown fox')
  })

  test('escapes and character references map to their whole source', () => {
    const source = 'Fish &amp; chips \\*not emphasis\\* here.\n'
    const amp = select(source, '& chips').range!
    expect(source.slice(amp.start, amp.end)).toBe('&amp; chips')
    const star = select(source, '*not emphasis*').range!
    expect(source.slice(star.start, star.end)).toBe('\\*not emphasis\\*')
  })

  test('container prefixes on continuation lines are skipped', () => {
    const source = '> first line\n> second line\n\n- item one\n  continues here\n'
    const quote = select(source, 'line\nsecond').range!
    expect(source.slice(quote.start, quote.end)).toBe('line\n> second')
    expect(comment(source, 'line\nsecond')).toBe('line second')
    expect(comment(source, 'one\ncontinues')).toBe('one continues')
  })

  test('selection crossing blocks', () => {
    const source = 'First paragraph ends here.\n\nSecond paragraph starts here.\n'
    const {range} = select(source, 'ends here.Second')
    expect(source.slice(range!.start, range!.end)).toBe('ends here.\n\nSecond')
    expect(comment(source, 'ends here.Second')).toBe('ends here. Second')
  })

  test('triple-click style selection (element boundaries) covers the paragraph text', () => {
    const source = 'Alpha one.\n\nBeta two.\n\nGamma three.\n'
    const ctx = setup(source)
    const paragraphs = ctx.container.querySelectorAll('p')
    // Chrome selects a paragraph as (p, 0) → (nextP, 0).
    const range = ctx.index.rangeToSource({
      startContainer: paragraphs[1]!,
      startOffset: 0,
      endContainer: paragraphs[2]!,
      endOffset: 0
    })
    expect(source.slice(range!.start, range!.end)).toBe('Beta two.')
    // And as (container, i) → (container, i + 1).
    const whole = ctx.index.rangeToSource({
      startContainer: ctx.container,
      startOffset: 1,
      endContainer: ctx.container,
      endOffset: 2
    })
    expect(source.slice(whole!.start, whole!.end)).toBe('Beta two.')
  })

  test('an end at offset 0 of the next text node snaps back', () => {
    const source = 'Alpha one.\n\nBeta two.\n'
    const ctx = setup(source)
    const [alpha, beta] = textNodes(ctx.container)
    const range = ctx.index.rangeToSource({startContainer: alpha!, startOffset: 6, endContainer: beta!, endOffset: 0})
    expect(source.slice(range!.start, range!.end)).toBe('one.')
  })

  test('a start at the end of a text node snaps forward', () => {
    const source = 'Alpha one.\n\nBeta two.\n'
    const ctx = setup(source)
    const [alpha, beta] = textNodes(ctx.container)
    const range = ctx.index.rangeToSource({startContainer: alpha!, startOffset: 10, endContainer: beta!, endOffset: 4})
    expect(source.slice(range!.start, range!.end)).toBe('Beta')
  })

  test('code spans and code blocks', () => {
    const source = 'Run `npm test` now.\n\n```sh\necho hi\necho there\n```\n'
    const span = select(source, 'npm test').range!
    expect(source.slice(span.start, span.end)).toBe('npm test')
    const block = select(source, 'hi\necho').range!
    expect(source.slice(block.start, block.end)).toBe('hi\necho')
    // Core moves the boundaries out of the code span / around the block.
    expect(comment(source, 'npm')).toBe('npm test')
    expect(comment(source, 'hi\necho')).toBe('echo hi echo there')
  })

  test('links snap to the whole link', () => {
    const source = 'See [the docs](https://example.com) for more.\n'
    expect(comment(source, 'docs for')).toBe('the docs for')
  })

  test('images are atoms', () => {
    const source = 'Before ![a diagram](https://example.com/x.png) after.\n'
    const ctx = setup(source)
    const wrapper = ctx.container.querySelector('.sm-image')!
    const range = ctx.index.rangeToSource({
      startContainer: wrapper,
      startOffset: 0,
      endContainer: textNodes(ctx.container).at(-1)!,
      endOffset: 6
    })
    expect(source.slice(range!.start, range!.end)).toBe('![a diagram](https://example.com/x.png) after')
  })

  test('table cells in the body', () => {
    const source = '| a | b |\n|---|---|\n| one | two |\n'
    const {range} = select(source, 'onetwo')
    expect(source.slice(range!.start, range!.end)).toBe('one | two')
    expect(comment(source, 'onetwo')).toBe('one two')
  })

  test('CRLF and front matter offsets', () => {
    const source = '---\r\ntitle: x\r\n---\r\n\r\nHello &amp; welcome.\r\nSecond line.\r\n'
    const {range} = select(source, 'welcome.\r\nSecond')
    expect(source.slice(range!.start, range!.end)).toBe('welcome.\r\nSecond')
    expect(comment(source, 'welcome.\r\nSecond')).toBe('welcome. Second')
    // Front matter is shown but is not commentable.
    const fm = select(source, 'title: x').range
    expect(fm === null || fm.start >= source.indexOf('Hello')).toBe(true)
  })

  test('astral characters', () => {
    const source = 'Emoji 😀 and 𝒳 here.\n'
    const {range} = select(source, '😀 and 𝒳')
    expect(source.slice(range!.start, range!.end)).toBe('😀 and 𝒳')
  })

  test('selections outside the body or over no content map to null', () => {
    const ctx = setup('Hello.\n')
    const outside = ctx.document.getElementById('outside')!.firstChild!
    expect(ctx.index.rangeToSource({startContainer: outside, startOffset: 0, endContainer: outside, endOffset: 3})).toBeNull()
    const text = textNodes(ctx.container)[0]!
    expect(ctx.index.rangeToSource({startContainer: text, startOffset: 2, endContainer: text, endOffset: 2})).toBeNull()
  })

  test('every registered offset maps monotonically', () => {
    const source = '# T\n\n> a *b* &amp; `c`\n> d\n\n1. x\n2. y **z**\n\n```\ncode\n```\n'
    const ctx = setup(source)
    let last = -1
    for (const node of textNodes(ctx.container)) {
      for (let i = 0; i <= node.data.length; i++) {
        const offset = ctx.index.pointToSource(node, i, 'start')
        if (offset === null) continue
        expect(offset).toBeGreaterThanOrEqual(last)
        last = offset
      }
    }
  })
})

describe('source → DOM', () => {
  test('pointAt finds the text node and offset for a source offset', () => {
    const source = 'Fish &amp; chips, **bold** words.\n\nNext paragraph.\n'
    const ctx = setup(source)
    for (const needle of ['Fish', 'chips', 'bold', 'words', 'Next']) {
      const point = ctx.index.pointAt(source.indexOf(needle))!
      expect(point.kind).toBe('text')
      expect((point.node as Text).data.slice(point.offset)).toMatch(new RegExp('^' + needle))
    }
    // An offset inside an entity rounds down to the decoded character.
    const amp = ctx.index.pointAt(source.indexOf('amp;'))!
    expect((amp.node as Text).data.slice(amp.offset)).toMatch(/^& chips/)
    // Between blocks: the next content.
    const between = ctx.index.pointAt(source.indexOf('\n\n') + 1)!
    expect((between.node as Text).data.slice(between.offset)).toMatch(/^Next/)
    expect(ctx.index.pointAt(source.length)).toBeNull()
  })

  test('pointAt and rangeToSource round-trip at every character', () => {
    const source = '# T\n\n> a *b* &amp; `c`\n> d\n\n1. x\n2. y **z**\n'
    const ctx = setup(source)
    for (const node of textNodes(ctx.container)) {
      for (let i = 0; i < node.data.length; i++) {
        const offset = ctx.index.pointToSource(node, i, 'start')!
        const point = ctx.index.pointAt(offset)!
        expect(point.node).toBe(node)
        expect(point.offset).toBe(i)
      }
    }
  })

  test('images are found as atoms', () => {
    const source = 'See ![x](https://example.com/x.png) here.\n'
    const ctx = setup(source)
    const point = ctx.index.pointAt(source.indexOf('!['))!
    expect(point.kind).toBe('atom')
    expect((point.node as Element).classList.contains('sm-image')).toBe(true)
  })
})

describe('rendering with highlights', () => {
  const base = 'The quick brown fox jumps over the lazy dog.\n\nA second paragraph here.\n'

  test('selection still maps exactly when text is split into marks', () => {
    const at = (s: string) => base.indexOf(s)
    const ctx = setup(base, [
      {id: 'c-a', range: {start: at('quick'), end: at('quick') + 'quick brown'.length}},
      {id: 'c-b', range: {start: at('brown'), end: at('jumps') + 5}}
    ])
    expect(ctx.container.querySelectorAll('mark').length).toBe(3)
    const overlap = ctx.container.querySelector('mark.sm-hl-overlap') as HTMLElement
    expect(overlap.textContent).toBe('brown')
    expect(overlap.dataset.threads).toBe('c-a c-b')
    expect(ctx.marks.get('c-a')!.map((m) => m.textContent).join('')).toBe('quick brown')
    expect(ctx.marks.get('c-b')!.map((m) => m.textContent).join('')).toBe('brown fox jumps')
    const range = ctx.index.rangeToSource(domRange(findText(ctx.container, 'ick brown fo')))
    expect(base.slice(range!.start, range!.end)).toBe('ick brown fo')
  })

  test('a range across blocks highlights in both blocks', () => {
    const start = base.indexOf('lazy')
    const end = base.indexOf('second') + 6
    const ctx = setup(base, [{id: 'c-x', range: {start, end}}])
    const marks = ctx.marks.get('c-x')!
    expect(marks.map((m) => m.textContent)).toEqual(['lazy dog.', 'A second'])
    expect(marks[0]!.closest('p')).not.toBe(marks[1]!.closest('p'))
  })

  test('anchors, anchor-only paragraphs and the comments table are not rendered', () => {
    const source = [
      'We will <a id="c-x7k2m9"></a>move every tenant<a id="c-x7k2m9-end"></a> soon.',
      '',
      '<a id="c-4f9tq1"></a>',
      '',
      '```sh',
      './migrate',
      '```',
      '',
      '<a id="c-4f9tq1-end"></a>',
      '',
      '## Comments',
      '',
      '| Ref | Quote | Author | Date | Comment | Status |',
      '|---|---|---|---|---|---|',
      '| [c-x7k2m9](#c-x7k2m9) | We will **move every tenant** soon. | @w | 2026-11-17T10:32Z | Hi | |',
      '| [c-4f9tq1](#c-4f9tq1) | soon. **./migrate** | @w | 2026-11-17T10:32Z | Hi | |',
      ''
    ].join('\n')
    const doc = parse(source)
    const highlights = doc.threads.map((t) => ({id: t.id, range: (t.attachment as {range: {start: number; end: number}}).range}))
    const ctx = setup(source, highlights)
    expect(ctx.container.textContent).not.toContain('<a')
    expect(ctx.container.textContent).not.toContain('Comments')
    expect(ctx.container.textContent).not.toContain('Ref')
    expect(ctx.container.querySelectorAll('p').length).toBe(1)
    expect(ctx.marks.get('c-x7k2m9')!.map((m) => m.textContent).join('')).toBe('move every tenant')
    expect(ctx.marks.get('c-4f9tq1')!.map((m) => m.textContent).join('')).toBe('./migrate')
  })

  test('a renamed heading above the table stays visible', () => {
    const source = 'Body.\n\n## Discussion\n\n| Ref | Quote | Author | Date | Comment | Status |\n|---|---|---|---|---|---|\n| c-1 | | @a | | Hi | |\n'
    const ctx = setup(source)
    expect(ctx.container.querySelector('h2')!.textContent).toBe('Discussion')
    expect(ctx.container.querySelector('table')).toBeNull()
  })
})
