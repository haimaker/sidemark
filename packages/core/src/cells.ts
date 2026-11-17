/** Table rows and cells: splitting, reading and escaping (§6.4). */
import type {Nodes} from 'mdast'
import type {Cell, SourceRange} from './types.js'

/**
 * Split a table row line into cells the way GFM does: cells are separated by
 * `|`; a backslash followed by `\` or `|` is an escape pair and never
 * separates; a leading and a trailing `|` are optional.
 *
 * `range` is the row's text (no line ending).
 */
export function splitRow(source: string, range: SourceRange): Cell[] {
  const bounds: Array<[number, number]> = []
  let i = range.start
  while (i < range.end && (source[i] === ' ' || source[i] === '\t')) i++
  if (source[i] === '|') i++
  let cellStart = i
  while (i < range.end) {
    const c = source[i]
    if (c === '\\' && i + 1 < range.end && (source[i + 1] === '\\' || source[i + 1] === '|')) {
      i += 2
      continue
    }
    if (c === '|') {
      bounds.push([cellStart, i])
      cellStart = i + 1
    }
    i++
  }
  if (source.slice(cellStart, range.end).trim() !== '' || bounds.length === 0) {
    bounds.push([cellStart, range.end])
  }
  return bounds.map(([start, end]) => {
    let s = start
    let e = end
    while (s < e && /\s/.test(source[s]!)) s++
    while (e > s && /\s/.test(source[e - 1]!)) e--
    return {range: {start, end}, contentRange: {start: s, end: e}, source: source.slice(s, e)}
  })
}

/**
 * Plain text of inline content: text, code, image descriptions; a space for
 * a line break; nothing for raw HTML.
 */
export function inlineText(nodes: readonly Nodes[]): string {
  let out = ''
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
      case 'inlineCode':
        out += node.value
        break
      case 'image':
      case 'imageReference':
        out += node.alt ?? ''
        break
      case 'break':
        out += ' '
        break
      case 'html':
        break
      default:
        if ('children' in node) out += inlineText(node.children as Nodes[])
    }
  }
  return out
}

/**
 * Remove the table-level pipe escapes from a cell's source, giving Markdown
 * that parses the same outside a table: `\|` becomes `|`, `\\` stays.
 */
export function unescapeCellPipes(cellSource: string): string {
  let out = ''
  for (let i = 0; i < cellSource.length; i++) {
    const c = cellSource[i]
    const next = cellSource[i + 1]
    if (c === '\\' && next === '\\') {
      out += '\\\\'
      i++
    } else if (c === '\\' && next === '|') {
      out += '|'
      i++
    } else {
      out += c
    }
  }
  return out
}

/**
 * Make Markdown safe for a table cell: every `|` that is not already
 * backslash-escaped gets a backslash, and line endings become `<br>` (§6.4).
 *
 * Limitation (inherent to GFM tables): a `\|` inside a code span cannot be
 * written in a cell; it reads back as `|`.
 */
export function escapeCellMarkdown(markdown: string): string {
  const oneLine = markdown.replace(/\r\n|\r|\n/g, '<br>')
  let out = ''
  let backslashes = 0
  for (const c of oneLine) {
    if (c === '|' && backslashes % 2 === 0) out += '\\'
    out += c
    backslashes = c === '\\' ? backslashes + 1 : 0
  }
  return out
}

const BR = /<br\s*\/?>/gi

/** Comment cell source → editable Markdown (pipes unescaped, `<br>` → newline). */
export function commentFromCell(cellSource: string): string {
  return unescapeCellPipes(cellSource).replace(BR, '\n')
}

/**
 * Backslash-escape plain text so that parsing it as inline Markdown in a
 * table cell gives back exactly that text (§7.3). `level` `minimal` escapes
 * only characters that commonly start inline syntax; `all` escapes every
 * ASCII punctuation character, which is always safe.
 */
export function escapeInlineText(text: string, level: 'minimal' | 'all'): string {
  let out = ''
  const chars = Array.from(text)
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!
    if (level === 'all' ? /[!-/:-@[-`{-~]/.test(c) : needsMinimalEscape(chars, i)) out += '\\'
    out += c
  }
  return out
}

function needsMinimalEscape(chars: string[], i: number): boolean {
  const c = chars[i]!
  if ('\\`*[]<|~'.includes(c)) return true
  if (c === '_') {
    // Intraword underscores never form emphasis.
    return !(/[\p{L}\p{N}]/u.test(chars[i - 1] ?? '') && /[\p{L}\p{N}]/u.test(chars[i + 1] ?? ''))
  }
  if (c === '&') {
    const rest = chars.slice(i, i + 40).join('')
    return /^&(#[0-9]{1,7};|#[xX][0-9a-fA-F]{1,6};|[A-Za-z][A-Za-z0-9]{1,31};)/.test(rest)
  }
  return false
}
