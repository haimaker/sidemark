/** Small string helpers shared by the reader and writer. */

/**
 * §7.1 step 3: whitespace as CommonMark defines Unicode whitespace (Zs, tab,
 * line feed, form feed, carriage return). Not JavaScript's `\s`, which also
 * matches vertical tab, U+FEFF and U+2028/9.
 */
const WHITESPACE = /[\t\n\f\r\p{Zs}]/u
const WHITESPACE_RUN = /[\t\n\f\r\p{Zs}]+/gu

export function isWhitespace(char: string | undefined): boolean {
  return char !== undefined && char !== '' && WHITESPACE.test(char)
}

/** Replace each run of whitespace with one space, without trimming. */
export function collapseWhitespaceRuns(value: string): string {
  return value.replace(WHITESPACE_RUN, ' ')
}

export function codePointLength(value: string): number {
  let n = 0
  for (const _ of value) n++
  return n
}

/** First `count` code points of `value`. */
export function firstCodePoints(value: string, count: number): string {
  let out = ''
  let n = 0
  for (const cp of value) {
    if (n++ >= count) break
    out += cp
  }
  return out
}

/** Last `count` code points of `value`. */
export function lastCodePoints(value: string, count: number): string {
  const cps = Array.from(value)
  return cps.slice(Math.max(0, cps.length - count)).join('')
}

/** ASCII-only lower-casing (§6.1, §6.4 compare "ignoring ASCII case"). */
export function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (c) => c.toLowerCase())
}

/** Indexes of every occurrence of `needle` in `haystack`, overlapping ones included. */
export function occurrences(haystack: string, needle: string): number[] {
  const found: number[] = []
  if (needle === '') return found
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) return found
    found.push(at)
    from = at + 1
  }
}

const LINE_ENDING = /\r\n|\r|\n/g

/** The most common line ending in `source`, or `\n` if it has none. */
export function detectLineEnding(source: string): string {
  const counts = new Map<string, number>()
  for (const match of source.matchAll(LINE_ENDING)) {
    counts.set(match[0], (counts.get(match[0]) ?? 0) + 1)
  }
  let best = '\n'
  let bestCount = 0
  for (const [ending, count] of counts) {
    if (count > bestCount) {
      best = ending
      bestCount = count
    }
  }
  return best
}

/** Offset of the start of the line containing `offset`. */
export function lineStart(source: string, offset: number): number {
  let i = offset
  while (i > 0) {
    const c = source[i - 1]
    if (c === '\n' || c === '\r') break
    i--
  }
  return i
}

/** Offset of the end of the line containing `offset` (before its line ending). */
export function lineEnd(source: string, offset: number): number {
  let i = offset
  while (i < source.length) {
    const c = source[i]
    if (c === '\n' || c === '\r') break
    i++
  }
  return i
}

/** Length of the line ending starting at `offset` (0 at end of input). */
export function lineEndingLength(source: string, offset: number): number {
  if (source[offset] === '\r') return source[offset + 1] === '\n' ? 2 : 1
  if (source[offset] === '\n') return 1
  return 0
}

/** Number of line endings in `value`. */
export function countLineEndings(value: string): number {
  let n = 0
  for (const _ of value.matchAll(LINE_ENDING)) n++
  return n
}

export function endsWithLineEnding(value: string): boolean {
  return value.endsWith('\n') || value.endsWith('\r')
}
