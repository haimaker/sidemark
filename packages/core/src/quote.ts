/** The Quote cell: building (§7.2), writing and reading (§7.3). */
import type {Nodes, Parents, Root} from 'mdast'
import {escapeInlineText} from './cells.js'
import {parseTree} from './markdown.js'
import type {TextProjection} from './projection.js'
import {
  codePointLength,
  firstCodePoints,
  isWhitespace,
  lastCodePoints
} from './text.js'
import type {ParsedQuote} from './types.js'

export const QUOTE_LIMIT = 80
export const ELIDED_HALF = 40
export const CONTEXT_LIMIT = 32
export const ELLIPSIS = '…'

export interface QuoteParts {
  prefix: string
  quote: string
  suffix: string
}

// ---------------------------------------------------------------------------
// Reading (§7.3)

const STRONG_OPEN = /^<(strong|b)(\s[^>]*)?>$/i

/**
 * Read prefix, quote and suffix from a Quote cell's inline content.
 *
 * The quote is the text of the first strong emphasis (`**`, `__`, `<strong>`
 * or `<b>`); the prefix is the text before it and the suffix the text after.
 * Without strong emphasis the whole cell is the quote. Whitespace is
 * collapsed across the three parts together, and whitespace at the quote's
 * edges is moved into the context (§7.2: "whitespace between the context and
 * the quote belongs to the context").
 *
 * Returns `null` for a cell with no text.
 */
export function readQuoteCell(children: readonly Nodes[]): ParsedQuote | null {
  const target = findStrong(children)
  const parts = {prefix: '', quote: '', suffix: ''}
  let state: 'prefix' | 'quote' | 'suffix' = target ? 'prefix' : 'quote'

  const emit = (text: string) => {
    parts[state] += text
  }
  const walk = (nodes: readonly Nodes[]): void => {
    for (const node of nodes) {
      if (target?.kind === 'strong' && node === target.node) {
        state = 'quote'
        walk(target.node.children as Nodes[])
        state = 'suffix'
        continue
      }
      if (target?.kind === 'html' && node === target.open) {
        state = 'quote'
        continue
      }
      if (target?.kind === 'html' && node === target.close) {
        state = 'suffix'
        continue
      }
      switch (node.type) {
        case 'text':
        case 'inlineCode':
          emit(node.value)
          break
        case 'image':
        case 'imageReference':
          emit(node.alt ?? '')
          break
        case 'break':
          emit(' ')
          break
        case 'html':
          break
        default:
          if ('children' in node) walk(node.children as Nodes[])
      }
    }
  }
  walk(children)

  const normalised = normaliseParts(parts)
  if (normalised.prefix === '' && normalised.quote === '' && normalised.suffix === '') return null
  return {...normalised, marker: target ? target.kind : 'none'}
}

type StrongTarget =
  | {kind: 'strong'; node: Parents}
  | {kind: 'html'; open: Nodes; close: Nodes}

/** The first strong emphasis in document order. */
function findStrong(nodes: readonly Nodes[]): StrongTarget | null {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    if (node.type === 'strong') return {kind: 'strong', node}
    if (node.type === 'html') {
      const open = STRONG_OPEN.exec(node.value)
      if (open) {
        const closing = new RegExp(`^</${open[1]}\\s*>$`, 'i')
        const close = nodes.slice(i + 1).find((n) => n.type === 'html' && closing.test(n.value))
        if (close) return {kind: 'html', open: node, close}
      }
    }
    if ('children' in node) {
      const inner = findStrong(node.children as Nodes[])
      if (inner) return inner
    }
  }
  return null
}

/** Collapse whitespace across the three parts and move edge whitespace out of the quote. */
function normaliseParts(parts: QuoteParts): QuoteParts {
  // Collapse runs over the concatenation, remembering which part each
  // character belongs to (a run belongs to the part it starts in).
  const out: QuoteParts = {prefix: '', quote: '', suffix: ''}
  let previousWasSpace = false
  for (const key of ['prefix', 'quote', 'suffix'] as const) {
    for (const char of parts[key]) {
      const space = isWhitespace(char)
      if (space && previousWasSpace) continue
      out[key] += space ? ' ' : char
      previousWasSpace = space
    }
  }
  let {prefix, quote, suffix} = out
  if (quote.startsWith(' ')) {
    quote = quote.slice(1)
    if (!prefix.endsWith(' ')) prefix += ' '
  }
  if (quote.endsWith(' ')) {
    quote = quote.slice(0, -1)
    if (!suffix.startsWith(' ')) suffix = ' ' + suffix
  }
  // Trim the ends of the whole cell (§7.1 step 3).
  return {prefix: prefix.replace(/^ /, ''), quote, suffix: suffix.replace(/ $/, '')}
}

// ---------------------------------------------------------------------------
// Building (§7.2)

/**
 * Compute prefix, quote and suffix for the projection characters
 * `[from, to)`. Returns `null` when the range has no text.
 *
 * §7.2 lets writers shorten context at any word boundary. This
 * implementation shortens only when the 32-code-point cut falls inside a
 * word, dropping the partial word (unless that would leave nothing).
 */
export function buildQuote(projection: TextProjection, from: number, to: number): QuoteParts | null {
  const text = projection.text
  let a = from
  let b = to
  while (a < b && text[a] === ' ') a++
  while (b > a && text[b - 1] === ' ') b--
  if (a === b) return null

  let quote = text.slice(a, b)
  if (codePointLength(quote) > QUOTE_LIMIT) {
    quote = firstCodePoints(quote, ELIDED_HALF) + ELLIPSIS + lastCodePoints(quote, ELIDED_HALF)
  }

  const before = text.slice(0, a)
  let prefix = lastCodePoints(before, CONTEXT_LIMIT)
  const cut = before.length - prefix.length
  if (cut > 0 && !isWhitespace(before[cut - 1]) && !isWhitespace(before[cut])) {
    const space = prefix.indexOf(' ')
    if (space !== -1 && space + 1 < prefix.length) prefix = prefix.slice(space + 1)
  }
  prefix = prefix.replace(/^ +/, '')

  const after = text.slice(b)
  let suffix = firstCodePoints(after, CONTEXT_LIMIT)
  if (suffix.length < after.length && !isWhitespace(after[suffix.length - 1]) && !isWhitespace(after[suffix.length])) {
    const space = suffix.lastIndexOf(' ')
    if (space > 0) suffix = suffix.slice(0, space)
  }
  suffix = suffix.replace(/ +$/, '')

  return {prefix, quote, suffix}
}

/**
 * Whether a stored quote still describes a range. The quote must be equal;
 * the stored prefix must end the text before the range and the stored suffix
 * must start the text after it.
 *
 * §9.6: a cell is rewritten only when this returns false, so context that
 * is merely shorter or longer than ours is left alone.
 */
export function quoteStillAccurate(
  stored: ParsedQuote,
  computed: QuoteParts,
  projection: TextProjection,
  from: number,
  to: number
): boolean {
  if (stored.quote !== computed.quote) return false
  const text = projection.text
  let a = from
  let b = to
  while (a < b && text[a] === ' ') a++
  while (b > a && text[b - 1] === ' ') b--
  return text.slice(0, a).endsWith(stored.prefix) && text.slice(b).startsWith(stored.suffix)
}

// ---------------------------------------------------------------------------
// Writing (§7.3)

/**
 * Markdown for a Quote cell. Tries `prefix**quote**suffix`; if `**` would not
 * parse as strong emphasis there (or the text would not read back exactly),
 * falls back to `<strong>…</strong>`. The result is verified by parsing it in
 * a table cell and reading it back.
 */
export function writeQuoteCell(parts: QuoteParts): string {
  const attempts: string[] = []
  for (const level of ['minimal', 'all'] as const) {
    const p = escapeInlineText(parts.prefix, level)
    const q = escapeInlineText(parts.quote, level)
    const s = escapeInlineText(parts.suffix, level)
    attempts.push(`${p}**${q}**${s}`)
  }
  for (const level of ['minimal', 'all'] as const) {
    const p = escapeInlineText(parts.prefix, level)
    const q = escapeInlineText(parts.quote, level)
    const s = escapeInlineText(parts.suffix, level)
    attempts.push(`${p}<strong>${q}</strong>${s}`)
  }
  for (const cell of attempts) {
    const read = readQuoteCell(parseCell(cell))
    if (read && read.prefix === parts.prefix && read.quote === parts.quote && read.suffix === parts.suffix) {
      return cell
    }
  }
  throw new Error(`Internal error: cannot write a Quote cell for ${JSON.stringify(parts)}`)
}

/**
 * Escape plain text for a cell so that it reads back as exactly `text`
 * (used for Author). Verified by parsing.
 */
export function writePlainCell(text: string): string {
  for (const level of ['minimal', 'all'] as const) {
    const cell = escapeInlineText(text, level)
    const read = parseCell(cell)
    if (plainTextOf(read) === text) return cell
  }
  return escapeInlineText(text, 'all')
}

function plainTextOf(nodes: readonly Nodes[]): string {
  const read = readQuoteCell(nodes)
  if (!read) return ''
  return read.marker === 'none' ? read.quote : read.prefix + read.quote + read.suffix
}

/** Parse `cell` as the only cell of a one-row table; return the cell's children. */
export function parseCell(cell: string): Nodes[] {
  const root: Root = parseTree(`| x |\n|---|\n| ${cell} |\n`, 0)
  const table = root.children[0]
  if (table?.type !== 'table') return []
  const row = table.children[1]
  const first = row?.children[0]
  return first ? (first.children as Nodes[]) : []
}

