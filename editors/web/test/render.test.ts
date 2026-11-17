import {describe, expect, test} from 'vitest'
import type {TableCell} from 'mdast'
import {JSDOM} from 'jsdom'
import {parse} from '@sidemark/core'
import {renderCell} from '../src/body/render'
import {safeHref, safeImageSrc} from '../src/body/sanitize'
import {setup} from './helpers'

describe('URL policy', () => {
  test.each([
    ['https://example.com/a?b#c', 'https://example.com/a?b#c'],
    ['http://example.com', 'http://example.com/'],
    ['mailto:ada@example.com', 'mailto:ada@example.com'],
    ['#section', '#section'],
    ['javascript:alert(1)', null],
    ['JaVaScRiPt:alert(1)', null],
    ['java\tscript:alert(1)', null],
    ['\u0001javascript:alert(1)', null],
    [' javascript:alert(1)', null],
    ['data:text/html,<script>alert(1)</script>', null],
    ['vbscript:x', null],
    ['relative/path.md', null],
    ['//evil.example/x', null],
    ['', null]
  ])('link %j', (url, expected) => {
    expect(safeHref(url)).toBe(expected)
  })

  test('images: remote http(s) only', () => {
    expect(safeImageSrc('https://example.com/x.png')).toBe('https://example.com/x.png')
    expect(safeImageSrc('data:image/svg+xml,<svg onload=alert(1)>')).toBeNull()
    expect(safeImageSrc('img/local.png')).toBeNull()
  })
})

/** Render the Comment cell of the first row of a comments table. */
function cell(comment: string) {
  const source = `Body.\n\n| Ref | Quote | Author | Date | Comment | Status |\n|---|---|---|---|---|---|\n| c-1 | | @a | | ${comment} | |\n`
  const doc = parse(source)
  const node = doc.threads[0]!.comments[0]!.row.node.children[4] as TableCell
  const {window} = new JSDOM('<!doctype html><div id="out"></div>')
  const out = window.document.getElementById('out')!
  out.append(renderCell(window.document, node, doc))
  return out
}

describe('comment text is untrusted (§12)', () => {
  test('inline Markdown renders', () => {
    const out = cell('Use *this*, **that**, `code` and ~~not~~ [docs](https://example.com).')
    expect(out.querySelector('em')!.textContent).toBe('this')
    expect(out.querySelector('strong')!.textContent).toBe('that')
    expect(out.querySelector('code')!.textContent).toBe('code')
    expect(out.querySelector('del')!.textContent).toBe('not')
    const a = out.querySelector('a')!
    expect(a.getAttribute('href')).toBe('https://example.com/')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer nofollow')
  })

  test('raw HTML is shown as text, never rendered', () => {
    const out = cell('<img src=x onerror=alert(1)> and <script>alert(1)</script> <b>bold</b>')
    expect(out.querySelector('img, script, b')).toBeNull()
    expect(out.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(out.textContent).toContain('<script>')
  })

  test('<br> is a line break', () => {
    const out = cell('one<br>two<br/>three')
    expect(out.querySelectorAll('br').length).toBe(2)
    expect(out.textContent).toBe('onetwothree')
  })

  test('unsafe link destinations are not links', () => {
    const out = cell('[click](javascript:alert(1)) [rel](notes.md)')
    expect(out.querySelector('a')).toBeNull()
    expect(out.querySelectorAll('.sm-unsafe-link').length).toBe(2)
    expect(out.textContent).toBe('click rel')
  })

  test('images in comments do not load local or data URLs', () => {
    const out = cell('![x](data:image/png;base64,AAAA)')
    expect(out.querySelector('img')).toBeNull()
    expect(out.textContent).toBe('Image: x')
  })

  test('escaped pipes read as pipes', () => {
    expect(cell('a \\| b').textContent).toBe('a | b')
  })
})

describe('document body rendering', () => {
  test('raw HTML in the body is shown as text', () => {
    const {container} = setup('<div onclick="x()">block</div>\n\nInline <span style="x">span</span> here.\n')
    expect(container.querySelector('div[onclick], span[style]')).toBeNull()
    expect(container.querySelector('.sm-raw-html')!.textContent).toContain('<div onclick="x()">block</div>')
    expect(container.querySelectorAll('.sm-raw-html-inline').length).toBe(2)
  })

  test('GFM constructs', () => {
    const {container} = setup(
      [
        '- [x] done',
        '- [ ] todo',
        '',
        '3. three',
        '4. four',
        '',
        '| L | R |',
        '|:--|--:|',
        '| a | b |',
        '',
        'See [ref][1] and a note[^n].',
        '',
        '[1]: https://example.com/ref',
        '[^n]: The note.',
        ''
      ].join('\n')
    )
    const boxes = container.querySelectorAll('input[type=checkbox]')
    expect([...boxes].map((b) => (b as HTMLInputElement).checked)).toEqual([true, false])
    expect(container.querySelector('ol')!.getAttribute('start')).toBe('3')
    expect((container.querySelector('td:last-child') as HTMLElement).style.textAlign).toBe('right')
    expect(container.querySelector('a')!.getAttribute('href')).toBe('https://example.com/ref')
    expect(container.querySelector('.sm-footnote-ref')!.textContent).toBe('[n]')
    expect(container.querySelector('.sm-footnote')!.textContent).toContain('The note.')
  })

  test('tight list items render without paragraph wrappers', () => {
    const {container} = setup('- one\n- two\n')
    expect(container.querySelector('li p')).toBeNull()
    const loose = setup('- one\n\n- two\n').container
    expect(loose.querySelector('li p')).not.toBeNull()
  })
})
