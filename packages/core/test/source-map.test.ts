import type {Nodes, Text} from 'mdast'
import {describe, expect, test} from 'vitest'
import {parse, projectRange, sourceRangeOf, type SidemarkDocument} from '../src/index.js'

/** Every text/inlineCode/code node in the body, in document order. */
function valueNodes(doc: SidemarkDocument): Array<Extract<Nodes, {type: 'text' | 'inlineCode' | 'code'}>> {
  const out: Array<Extract<Nodes, {type: 'text' | 'inlineCode' | 'code'}>> = []
  const visit = (node: Nodes) => {
    if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code') out.push(node)
    if ('children' in node) for (const child of node.children) visit(child as Nodes)
  }
  visit(doc.root)
  return out
}

/** What a source span may legitimately decode to. */
function decodesTo(sourceSlice: string, char: string): boolean {
  if (sourceSlice === char) return true
  if (sourceSlice === '\\' + char) return true
  if (sourceSlice.startsWith('&') && sourceSlice.endsWith(';')) return true
  if (/^(\r\n|\r|\n)$/.test(sourceSlice)) return char === '\n' || char === '\r' || char === ' '
  return false
}

const samples: Record<string, string> = {
  entities: 'Fish &amp; chips &#36;5 &#x1F600; &mdash; done.\n',
  escapes: 'Not \\*emphasis\\*, a \\\\ backslash and \\[brackets\\].\n',
  blockquote: '> first line\n> second &amp; line\n>   third\n',
  nested: '> - item one\n>   continues **here**\n>   and here\n',
  list: '1. alpha\n   beta `code\n   span` gamma\n',
  crlf: 'Line one\r\nline two\r\n\r\n> quoted\r\n> more\r\n',
  tableCode: '| a | b |\n|---|---|\n| `x \\| y` | z |\n',
  astral: 'Emoji 😀 and 𝒳 here.\n',
  code: '- list\n\n  ```js\n  const a = 1\n    indented\n  ```\n',
  trailing: 'soft   \nbreak and hard  \nbreak\n',
  frontMatter: '---\ntitle: x\n---\n\nAfter &amp; front matter.\n',
  bom: '﻿BOM &amp; text.\n'
}

describe('per-character source map', () => {
  for (const [name, source] of Object.entries(samples)) {
    test(name, () => {
      const doc = parse(source)
      for (const node of valueNodes(doc)) {
        const map = doc.sourceMap.charMap(node)
        expect(map.starts.length).toBe(node.value.length)
        for (let i = 0; i < node.value.length; i++) {
          const char = node.value[i]!
          const slice = source.slice(map.starts[i], map.ends[i])
          // Surrogate halves map to the whole code point.
          if (/[\uD800-\uDFFF]/.test(char)) {
            expect(slice.length === 2 || slice.startsWith('&')).toBe(true)
            continue
          }
          expect(decodesTo(slice, char), `${JSON.stringify(char)} ← ${JSON.stringify(slice)}`).toBe(true)
        }
        // Monotonic.
        for (let i = 1; i < map.starts.length; i++) {
          expect(map.starts[i]!).toBeGreaterThanOrEqual(map.starts[i - 1]!)
        }
      }
    })
  }
})

describe('text projection (§7.1)', () => {
  test('decodes escapes and entities, joins blocks with one space', () => {
    expect(parse(samples.entities!).projection.text).toBe('Fish & chips $5 😀 — done.')
    expect(parse(samples.escapes!).projection.text).toBe('Not *emphasis*, a \\ backslash and [brackets].')
    expect(parse('# Head\n\nPara one\ncontinues.\n\n| a | b |\n|---|---|\n| c | d |\n').projection.text).toBe(
      'Head Para one continues. a b c d'
    )
  })

  test('container prefixes and line breaks become single spaces', () => {
    expect(parse(samples.blockquote!).projection.text).toBe('first line second & line third')
    expect(parse(samples.trailing!).projection.text).toBe('soft break and hard break')
  })

  test('code, images, raw HTML', () => {
    const doc = parse('Use `a  b` and ![alt *text*](x.png) and <span>html</span>.\n\n```\nx\n  y\n```\n')
    expect(doc.projection.text).toBe('Use a b and alt text and html. x y')
  })

  test('front matter and the comments table are not part of the body', () => {
    const doc = parse(
      '---\ntitle: secret\n---\n\nBody.\n\n## Comments\n\n| Ref | Quote | Author | Date | Comment | Status |\n|---|---|---|---|---|---|\n'
    )
    expect(doc.projection.text).toBe('Body.')
  })

  test('every projection character maps into the source, monotonically', () => {
    for (const source of Object.values(samples)) {
      const {projection} = parse(source)
      expect(projection.starts.length).toBe(projection.text.length)
      for (let i = 1; i < projection.starts.length; i++) {
        expect(projection.starts[i]!).toBeGreaterThanOrEqual(projection.starts[i - 1]!)
      }
      for (let i = 0; i < projection.text.length; i++) {
        expect(projection.starts[i]!).toBeLessThanOrEqual(projection.ends[i]!)
        expect(projection.ends[i]!).toBeLessThanOrEqual(source.length)
      }
    }
  })

  test('a projection range maps back to the source it came from', () => {
    const source = samples.nested!
    const doc = parse(source)
    const from = doc.projection.text.indexOf('continues')
    const to = doc.projection.text.indexOf('and here') + 'and here'.length
    const range = sourceRangeOf(doc.projection, from, to)!
    expect(source.slice(range.start, range.end)).toBe('continues **here**\n>   and here')
    expect(projectRange(doc.projection, range)).toBe('continues here and here')
  })
})

describe('editor helpers: node offset ↔ source offset', () => {
  test('text node with an entity and a continuation line', () => {
    const source = '> Fish &amp; chips\n> taste good\n'
    const doc = parse(source)
    const text = valueNodes(doc)[0] as Text
    expect(text.value).toBe('Fish & chips\ntaste good')
    expect(doc.sourceMap.toSource(text, 0)).toBe(source.indexOf('Fish'))
    expect(doc.sourceMap.toSource(text, 5)).toBe(source.indexOf('&amp;'))
    expect(doc.sourceMap.toSource(text, 6)).toBe(source.indexOf('&amp;') + 5)
    // After the line ending: past the "> " prefix.
    expect(doc.sourceMap.toSource(text, 13)).toBe(source.indexOf('taste'))
    expect(doc.sourceMap.toSource(text, text.value.length)).toBe(source.indexOf('good') + 4)

    expect(doc.sourceMap.fromSource(text, source.indexOf('&amp;'))).toBe(5)
    expect(doc.sourceMap.fromSource(text, source.indexOf('&amp;') + 2)).toBe(5)
    expect(doc.sourceMap.fromSource(text, source.indexOf('&amp;') + 5)).toBe(6)
    expect(doc.sourceMap.fromSource(text, source.indexOf('taste'))).toBe(13)
  })

  test('code block inside a list item', () => {
    const source = samples.code!
    const doc = parse(source)
    const code = valueNodes(doc).find((n) => n.type === 'code')!
    expect(code.value).toBe('const a = 1\n  indented')
    const i = code.value.indexOf('indented')
    expect(doc.sourceMap.toSource(code, i)).toBe(source.indexOf('indented'))
  })

  test('out of range offsets throw', () => {
    const doc = parse('abc\n')
    const text = valueNodes(doc)[0]!
    expect(() => doc.sourceMap.toSource(text, 4)).toThrow(RangeError)
  })
})
