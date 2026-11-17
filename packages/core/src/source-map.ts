/**
 * Character-level source map for mdast `text`, `inlineCode` and `code` nodes.
 *
 * mdast gives each node a source range, but inside a node the value and the
 * source are not 1:1: backslash escapes (`\*` → `*`), character references
 * (`&amp;` → `&`), container prefixes on continuation lines (`> `, list
 * indentation), stripped line-trailing spaces, and so on. micromark's event
 * stream has a token for every piece of source that contributes to a value,
 * so we index those tokens ("segments") and align each node's value with the
 * segments inside its range. The result gives, for every UTF-16 unit of the
 * node's value, the source span it came from.
 */
import type {Nodes} from 'mdast'
import {decodeNamedCharacterReference} from 'decode-named-character-reference'
import {decodeNumericCharacterReference} from 'micromark-util-decode-numeric-character-reference'
import type {Event} from 'micromark-util-types'
import {rangeOf} from './markdown.js'

/** A piece of source that produces `text` in node values. */
interface Segment {
  start: number
  end: number
  text: string
  /** Escapes and references: the produced text maps to the whole span. */
  atomic: boolean
  lineEnding: boolean
}

/** Per-unit source spans of a node value. */
export interface CharMap {
  /** Source offset where unit `i` of the value starts. */
  starts: number[]
  /** Source offset where unit `i` of the value ends. */
  ends: number[]
}

/** Token types whose source text appears verbatim in node values. */
const VERBATIM = new Set([
  'data',
  'codeTextData',
  'codeFlowValue',
  'literalAutolinkHttp',
  'literalAutolinkWww',
  'literalAutolinkEmail',
  'autolinkProtocol',
  'autolinkEmail'
])

type ValueNode = Extract<Nodes, {type: 'text' | 'inlineCode' | 'code'}>

export class SourceMapper {
  private readonly segments: Segment[]
  private readonly cache = new WeakMap<object, CharMap>()

  /**
   * @param source the full document source
   * @param events micromark events for `source.slice(offset)`
   * @param offset where the parsed input starts in `source`
   */
  constructor(
    private readonly source: string,
    events: Event[],
    offset: number
  ) {
    this.segments = collectSegments(source, events, offset)
  }

  /** Source spans of every UTF-16 unit of a text, inlineCode or code node's value. */
  charMap(node: ValueNode): CharMap {
    let map = this.cache.get(node)
    if (!map) {
      map = this.align(node)
      this.cache.set(node, map)
    }
    return map
  }

  /**
   * Source offset of character offset `offset` within the value of a text,
   * inlineCode or code node. `offset === value.length` gives the source
   * offset just after the last character.
   */
  toSource(node: ValueNode, offset: number): number {
    const map = this.charMap(node)
    const length = map.starts.length
    if (offset < 0 || offset > length) {
      throw new RangeError(`Offset ${offset} is outside the node value (length ${length})`)
    }
    if (length === 0) return rangeOf(node).start
    if (offset === length) return map.ends[length - 1]!
    return map.starts[offset]!
  }

  /**
   * Character offset within the node value that corresponds to a source
   * offset: the number of value characters whose source ends at or before it.
   * Offsets inside an escape or entity round down.
   */
  fromSource(node: ValueNode, sourceOffset: number): number {
    const {ends} = this.charMap(node)
    let count = 0
    while (count < ends.length && ends[count]! <= sourceOffset) count++
    return count
  }

  private align(node: ValueNode): CharMap {
    const {start, end} = rangeOf(node)
    return this.alignValue(node.value, start, end)
  }

  /** Align an arbitrary value with the source segments inside `[start, end)`. */
  alignValue(value: string, start: number, end: number): CharMap {
    const starts: number[] = []
    const ends: number[] = []
    let i = 0
    for (const segment of this.segmentsIn(start, end)) {
      if (i >= value.length) break
      if (segment.atomic) {
        if (value.startsWith(segment.text, i)) {
          for (let k = 0; k < segment.text.length; k++) {
            starts.push(segment.start)
            ends.push(segment.end)
          }
          i += segment.text.length
        }
        continue
      }
      if (segment.lineEnding) {
        // Text keeps the raw line ending; code spans may turn it into a space.
        if (value.startsWith(segment.text, i)) {
          for (let k = 0; k < segment.text.length; k++) {
            starts.push(segment.start)
            ends.push(segment.end)
          }
          i += segment.text.length
        } else if (value[i] === '\n' || value[i] === ' ') {
          starts.push(segment.start)
          ends.push(segment.end)
          i++
        }
        continue
      }
      // Verbatim source. Characters the value does not contain are skipped:
      // this covers `\|` inside code spans in tables, which GFM turns into `|`.
      for (let k = 0; k < segment.text.length && i < value.length; k++) {
        if (value[i] !== segment.text[k]) continue
        // Both halves of a surrogate pair map to the whole code point, so no
        // offset ever falls inside one.
        const pair = isHighSurrogate(value[i]) && value[i + 1] === segment.text[k + 1] && k + 1 < segment.text.length
        const width = pair ? 2 : 1
        for (let w = 0; w < width; w++) {
          starts.push(segment.start + k)
          ends.push(segment.start + k + width)
        }
        i += width
        k += width - 1
      }
    }
    // Anything left over (should not happen) maps to the end of the node.
    while (starts.length < value.length) {
      starts.push(end)
      ends.push(end)
    }
    return {starts, ends}
  }

  private *segmentsIn(start: number, end: number): Generator<Segment> {
    // Binary search for the first segment that ends after `start`.
    let lo = 0
    let hi = this.segments.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.segments[mid]!.end <= start) lo = mid + 1
      else hi = mid
    }
    for (let k = lo; k < this.segments.length; k++) {
      const segment = this.segments[k]!
      if (segment.start >= end) break
      if (segment.start >= start && segment.end <= end) yield segment
    }
  }
}

function collectSegments(source: string, events: Event[], offset: number): Segment[] {
  const segments: Segment[] = []
  let skipUntil: unknown = null
  for (const [kind, token] of events) {
    if (skipUntil) {
      if (kind === 'exit' && token === skipUntil) skipUntil = null
      continue
    }
    if (kind !== 'enter') continue
    const start = token.start.offset + offset
    const end = token.end.offset + offset
    const raw = source.slice(start, end)
    if (token.type === 'characterEscape') {
      segments.push({start, end, text: raw.slice(1), atomic: true, lineEnding: false})
      skipUntil = token
    } else if (token.type === 'characterReference') {
      segments.push({start, end, text: decodeReference(raw), atomic: true, lineEnding: false})
      skipUntil = token
    } else if (token.type === 'lineEnding') {
      // In some containers the token also covers the next line's indentation.
      const match = /^(\r\n|\r|\n)/.exec(raw)
      const text = match ? match[1]! : raw
      segments.push({start, end: start + text.length, text, atomic: false, lineEnding: true})
    } else if (VERBATIM.has(token.type)) {
      segments.push({start, end, text: raw, atomic: false, lineEnding: false})
    }
  }
  segments.sort((a, b) => a.start - b.start)
  return segments
}

/** Decode `&name;`, `&#123;` or `&#x1F;` the way micromark does. */
function decodeReference(raw: string): string {
  const body = raw.slice(1, -1)
  if (body.startsWith('#x') || body.startsWith('#X')) {
    return decodeNumericCharacterReference(body.slice(2), 16)
  }
  if (body.startsWith('#')) {
    return decodeNumericCharacterReference(body.slice(1), 10)
  }
  const decoded = decodeNamedCharacterReference(body)
  return decoded === false ? raw : decoded
}

/**
 * Give a position to every node that lacks one.
 *
 * mdast-util-gfm-autolink-literal finds some literal autolinks (for example
 * `www.x.com` right after raw HTML, as GitHub does) in a transform that runs
 * after parsing, and the nodes it creates have no position. They always
 * replace a run of a text node, so we align the run's combined text with the
 * source between its positioned neighbours.
 */
export function fillMissingPositions(parent: Nodes, mapper: SourceMapper, source: string): void {
  if (!('children' in parent) || !parent.position) return
  const children = parent.children as Nodes[]
  let i = 0
  while (i < children.length) {
    if (children[i]!.position) {
      fillMissingPositions(children[i]!, mapper, source)
      i++
      continue
    }
    let j = i
    while (j < children.length && !children[j]!.position) j++
    const previous = children[i - 1]
    const next = children[j]
    const from = previous ? rangeOf(previous).end : contentStart(parent)
    const to = next ? rangeOf(next).start : contentEnd(parent)
    const run = children.slice(i, j)
    const map = mapper.alignValue(run.map(plainValue).join(''), from, to)
    let k = 0
    for (const node of run) {
      const length = plainValue(node).length
      const start = length > 0 ? map.starts[k]! : k > 0 ? map.ends[k - 1]! : from
      const end = length > 0 ? map.ends[k + length - 1]! : start
      node.position = {start: pointAt(source, start), end: pointAt(source, end)}
      k += length
      fillMissingPositions(node, mapper, source)
    }
    i = j
  }
}

function plainValue(node: Nodes): string {
  if ('value' in node && typeof node.value === 'string') return node.value
  if ('children' in node) return (node.children as Nodes[]).map(plainValue).join('')
  return ''
}

function contentStart(parent: Nodes): number {
  return rangeOf(parent).start
}

function contentEnd(parent: Nodes): number {
  return rangeOf(parent).end
}

function pointAt(source: string, offset: number): {line: number; column: number; offset: number} {
  let line = 1
  let lineStart = 0
  for (let i = 0; i < offset; i++) {
    const c = source[i]
    if (c === '\n' || (c === '\r' && source[i + 1] !== '\n')) {
      line++
      lineStart = i + 1
    }
  }
  return {line, column: offset - lineStart + 1, offset}
}

function isHighSurrogate(char: string | undefined): boolean {
  return char !== undefined && char >= '\uD800' && char <= '\uDBFF'
}
