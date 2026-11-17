import {describe, expect, test} from 'vitest'
import {buildQuote, findQuote, parse, readQuoteCell, writeQuoteCell} from '../src/index.js'
import {parseCell} from '../src/quote.js'

function quoteFor(source: string, text: string) {
  const doc = parse(source)
  const from = doc.projection.text.indexOf(text)
  return buildQuote(doc.projection, from, from + text.length)
}

describe('building a quote (§7.2)', () => {
  test('short context is taken whole', () => {
    expect(quoteFor('The quick brown fox jumps.\n', 'quick brown')).toEqual({
      prefix: 'The ',
      quote: 'quick brown',
      suffix: ' fox jumps.'
    })
  })

  test('context is cut at 32 code points and shortened to a word boundary', () => {
    const q = quoteFor('We will move every tenant to the new cluster in Q3. Then we celebrate the launch.\n', 'Q3')!
    // 32 code points before "Q3" would start mid-word ("…ery tenant").
    expect(q.prefix).toBe('tenant to the new cluster in ')
    expect(q.suffix).toBe('. Then we celebrate the launch.')
  })

  test('80 code points stay whole; 81 are elided to 40 + … + 40', () => {
    const eighty = 'a'.repeat(80)
    const eightyOne = 'b'.repeat(81)
    expect(quoteFor(`${eighty}\n`, eighty)!.quote).toBe(eighty)
    expect(quoteFor(`${eightyOne}\n`, eightyOne)!.quote).toBe(`${'b'.repeat(40)}…${'b'.repeat(40)}`)
  })

  test('elision counts code points, not UTF-16 units', () => {
    const text = '😀'.repeat(81)
    const q = quoteFor(`${text}\n`, text)!
    expect(Array.from(q.quote)).toHaveLength(81)
    expect(q.quote.startsWith('😀'.repeat(40) + '…')).toBe(true)
  })

  test('whitespace at the edges of the range moves into the context', () => {
    const doc = parse('alpha beta gamma\n')
    const from = doc.projection.text.indexOf(' beta ')
    expect(buildQuote(doc.projection, from, from + 6)).toEqual({prefix: 'alpha ', quote: 'beta', suffix: ' gamma'})
  })
})

describe('reading the Quote cell (§7.3)', () => {
  const read = (cell: string) => readQuoteCell(parseCell(cell))

  test('strong emphasis with ** and __', () => {
    expect(read('The **quick** fox')).toMatchObject({prefix: 'The ', quote: 'quick', suffix: ' fox', marker: 'strong'})
    expect(read('The __quick__ fox')).toMatchObject({prefix: 'The ', quote: 'quick', suffix: ' fox', marker: 'strong'})
  })

  test('<strong> and <b>', () => {
    expect(read('call<strong>(x)</strong> now')).toMatchObject({prefix: 'call', quote: '(x)', suffix: ' now', marker: 'html'})
    expect(read('a <B>b</B> c')).toMatchObject({prefix: 'a ', quote: 'b', suffix: ' c', marker: 'html'})
  })

  test('only the first strong emphasis is the quote', () => {
    expect(read('**one** two **three**')).toMatchObject({prefix: '', quote: 'one', suffix: ' two three'})
  })

  test('without emphasis the whole cell is the quote', () => {
    expect(read('just  some   text')).toMatchObject({prefix: '', quote: 'just some text', suffix: '', marker: 'none'})
  })

  test('escapes are decoded and whitespace collapsed', () => {
    expect(read('a \\*b\\* **c \\| d**')).toMatchObject({prefix: 'a *b* ', quote: 'c | d', suffix: ''})
  })

  test('empty cell', () => {
    expect(read('')).toBeNull()
  })
})

describe('writing the Quote cell (§7.3)', () => {
  const roundTrip = (prefix: string, quote: string, suffix: string) => {
    const cell = writeQuoteCell({prefix, quote, suffix})
    const back = readQuoteCell(parseCell(cell))!
    expect({prefix: back.prefix, quote: back.quote, suffix: back.suffix}).toEqual({prefix, quote, suffix})
    return cell
  }

  test('uses ** where it parses', () => {
    expect(roundTrip('The ', 'quick', ' fox.')).toBe('The **quick** fox.')
  })

  test('falls back to <strong> next to punctuation', () => {
    expect(roundTrip('call', '(foo)', ' here')).toBe('call<strong>(foo)</strong> here')
  })

  test('escapes Markdown punctuation so the text reads back exactly', () => {
    const cell = roundTrip('a_b *c* ', '[d] `e` <f> | g & h &amp; i', ' ~j~ \\k')
    expect(cell).toContain('\\|')
    expect(cell).toContain('\\[d\\]')
  })

  test('random strings round-trip', () => {
    let seed = 42
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      return seed / 2 ** 31
    }
    const alphabet = 'ab ._*`[]()<>!&#|\\~-:;"\'{}=+é😀'
    const pick = (n: number) => {
      let s = ''
      for (let i = 0; i < n; i++) s += Array.from(alphabet)[Math.floor(random() * Array.from(alphabet).length)]
      return s.replace(/\s+/g, ' ')
    }
    for (let i = 0; i < 300; i++) {
      const quote = pick(1 + Math.floor(random() * 12)).trim() || 'x'
      const prefix = pick(Math.floor(random() * 8)).replace(/^ /, '')
      const suffix = pick(Math.floor(random() * 8)).replace(/ $/, '')
      roundTrip(prefix, quote, suffix)
    }
  })
})

describe('fallback search (§8 step 3)', () => {
  const doc = parse('one two three two one\n')
  const q = (prefix: string, quote: string, suffix: string) =>
    findQuote(doc.projection, {prefix, quote, suffix, marker: 'strong'})

  test('exactly one occurrence anchors', () => {
    expect(q('one ', 'two', ' three')).toEqual({from: 4, to: 7})
  })

  test('several occurrences do not', () => {
    expect(q('', 'two', '')).toBeNull()
  })

  test('elided quotes match head and tail separately', () => {
    expect(q('', 'one two…two one', '')).toEqual({from: 0, to: 21})
    // Head after tail: no match.
    expect(q('three ', 'two…one two', '')).toBeNull()
  })
})
