/** Resolving a thread to a location (§8). */
import {pairContentRange} from './anchors.js'
import {projectRange, sourceRangeOf, type TextProjection} from './projection.js'
import {ELLIPSIS} from './quote.js'
import {occurrences} from './text.js'
import type {Anchor, Attachment, ParsedQuote} from './types.js'

export function resolveAttachment(
  pair: {start: Anchor; end: Anchor} | null,
  quote: ParsedQuote | null,
  projection: TextProjection
): Attachment {
  // Step 1: anchors win.
  if (pair) {
    const range = pairContentRange(pair)
    return {kind: 'anchored', via: 'anchors', range, text: projectRange(projection, range)}
  }
  // Step 2: no quote → document-level. A cell with only markup is empty (§7.3).
  if (!quote) return {kind: 'document'}
  // Step 3: exact fallback.
  const found = findQuote(projection, quote)
  if (found) {
    const range = sourceRangeOf(projection, found.from, found.to)
    if (range) {
      return {kind: 'anchored', via: 'quote', range, text: projection.text.slice(found.from, found.to)}
    }
  }
  return {kind: 'orphaned'}
}

/**
 * §8 step 3: locate a quote in the projection. Returns projection indexes
 * `[from, to)` of the quoted text, or `null` unless there is exactly one
 * match.
 */
export function findQuote(projection: TextProjection, quote: ParsedQuote): {from: number; to: number} | null {
  const text = projection.text
  const {prefix, suffix} = quote
  if (quote.quote === '') return null
  if (!quote.quote.includes(ELLIPSIS)) {
    const hits = occurrences(text, prefix + quote.quote + suffix)
    if (hits.length !== 1) return null
    const from = hits[0]! + prefix.length
    return {from, to: from + quote.quote.length}
  }
  const head = quote.quote.slice(0, quote.quote.indexOf(ELLIPSIS))
  const tail = quote.quote.slice(quote.quote.lastIndexOf(ELLIPSIS) + 1)
  const heads = occurrences(text, prefix + head)
  const tails = occurrences(text, tail + suffix)
  if (heads.length !== 1 || tails.length !== 1) return null
  const headEnd = heads[0]! + prefix.length + head.length
  const tailStart = tails[0]!
  if (headEnd > tailStart) return null
  const from = heads[0]! + prefix.length
  const to = tailStart + tail.length
  return to > from ? {from, to} : null
}
