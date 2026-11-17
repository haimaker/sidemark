/**
 * Parsing Markdown with micromark + mdast, keeping exact source offsets.
 *
 * We parse twice from the same input: once into an mdast tree (for structure)
 * and once into micromark events (for the exact source of every character of
 * text, see `source-map.ts`). Both are shifted so offsets refer to the full
 * original source, including any BOM and front matter we skipped.
 */
import type {Nodes, Root} from 'mdast'
import {fromMarkdown} from 'mdast-util-from-markdown'
import {gfmFromMarkdown} from 'mdast-util-gfm'
import {parse as micromarkParse, postprocess, preprocess} from 'micromark'
import {gfm} from 'micromark-extension-gfm'
import type {Event} from 'micromark-util-types'
import type {SourceRange} from './types.js'
import {countLineEndings, lineEndingLength} from './text.js'

export interface Preamble {
  /** Offset where Markdown starts. */
  bodyStart: number
  frontMatter: SourceRange | null
}

/**
 * Find a leading BOM and YAML front matter (§7.1 step 1): a first line of
 * exactly `---` through the next line of exactly `---` or `...`.
 */
export function splitPreamble(source: string): Preamble {
  const bom = source.startsWith('﻿') ? 1 : 0
  const firstLine = readLine(source, bom)
  if (firstLine.text !== '---' || firstLine.next === firstLine.end) {
    return {bodyStart: bom, frontMatter: null}
  }
  let at = firstLine.next
  while (at < source.length) {
    const line = readLine(source, at)
    if (line.text === '---' || line.text === '...') {
      return {bodyStart: line.next, frontMatter: {start: bom, end: line.next}}
    }
    if (line.next === at) break
    at = line.next
  }
  return {bodyStart: bom, frontMatter: null}
}

function readLine(source: string, start: number): {text: string; end: number; next: number} {
  let end = start
  while (end < source.length && source[end] !== '\n' && source[end] !== '\r') end++
  return {text: source.slice(start, end), end, next: end + lineEndingLength(source, end)}
}

const micromarkOptions = () => ({extensions: [gfm()]})

/** Parse `source` from `bodyStart` into an mdast tree with offsets into `source`. */
export function parseTree(source: string, bodyStart: number): Root {
  const input = source.slice(bodyStart)
  const root = fromMarkdown(input, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()]
  })
  if (bodyStart > 0) {
    shiftPositions(root, bodyStart, countLineEndings(source.slice(0, bodyStart)))
  }
  return root
}

/** Parse `source` from `bodyStart` into micromark events (offsets not shifted). */
export function parseEvents(source: string, bodyStart: number): Event[] {
  const input = source.slice(bodyStart)
  return postprocess(micromarkParse(micromarkOptions()).document().write(preprocess()(input, undefined, true)))
}

function shiftPositions(node: Nodes, offset: number, lines: number): void {
  const position = node.position
  if (position) {
    position.start.offset = (position.start.offset ?? 0) + offset
    position.end.offset = (position.end.offset ?? 0) + offset
    position.start.line += lines
    position.end.line += lines
  }
  if ('children' in node) {
    for (const child of node.children) shiftPositions(child as Nodes, offset, lines)
  }
}

/** Source range of an mdast node. Every node we get from the parser has one. */
export function rangeOf(node: Nodes): SourceRange {
  const position = node.position
  if (!position || position.start.offset === undefined || position.end.offset === undefined) {
    throw new Error(`Internal error: ${node.type} node has no position`)
  }
  return {start: position.start.offset, end: position.end.offset}
}

export function startOf(node: Nodes): number {
  return rangeOf(node).start
}

export function endOf(node: Nodes): number {
  return rangeOf(node).end
}

/** Phrasing nodes that themselves hold phrasing content. */
export const PHRASING_PARENTS = new Set([
  'paragraph',
  'heading',
  'tableCell',
  'emphasis',
  'strong',
  'delete',
  'link',
  'linkReference'
])
