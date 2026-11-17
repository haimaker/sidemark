/**
 * Renders core's mdast to DOM.
 *
 * The same renderer draws the document body (with a `BodyIndex`, so the
 * selection can be mapped back to source, and with comment highlights) and
 * the Comment cells of the comments table (no index, no highlights).
 *
 * Security (SPEC §12): raw HTML is never rendered. Anchors render as nothing;
 * `<br>` becomes a line break; any other HTML is shown as literal text. Link
 * and image URLs go through `sanitize.ts`. Nothing is ever assigned to
 * `innerHTML`.
 */
import type {Definition, Nodes, Parents, PhrasingContent, Root, RootContent, TableCell} from 'mdast'
import type {Anchor, SidemarkDocument, SourceRange} from '@sidemark/core'
import {BodyIndex, type ValueNode} from './dom-map'
import {embeddedImageSrc, remoteImageUrl, safeHref} from './sanitize'

/** A range to highlight in the body. `id` is a thread ID (or a UI pseudo-ID). */
export interface Highlight {
  id: string
  range: SourceRange
}

export interface BodyRenderResult {
  index: BodyIndex
  /** Highlight elements per highlight ID, in document order. */
  marks: Map<string, HTMLElement[]>
}

const BR = /^<br\s*\/?>$/i

interface Context {
  document: Document
  index: BodyIndex | null
  highlights: readonly Highlight[]
  anchors: readonly Anchor[]
  definitions: Map<string, Definition>
  marks: Map<string, HTMLElement[]>
}

/**
 * Render the body of `doc` into `container` (replacing its content).
 * `hidden` nodes (the comments table and its default heading) are skipped.
 */
export function renderBody(
  container: HTMLElement,
  doc: SidemarkDocument,
  options: {highlights: readonly Highlight[]; hidden: ReadonlySet<Nodes>}
): BodyRenderResult {
  const document = container.ownerDocument
  const index = new BodyIndex(container, doc.sourceMap)
  const ctx: Context = {
    document,
    index,
    highlights: options.highlights,
    anchors: doc.anchors,
    definitions: collectDefinitions(doc.root),
    marks: new Map()
  }
  const fragment = document.createDocumentFragment()
  if (doc.frontMatter) {
    const details = el(ctx, 'details', 'sm-frontmatter')
    details.append(el(ctx, 'summary', null, 'Front matter'))
    details.append(el(ctx, 'pre', null, doc.source.slice(doc.frontMatter.start, doc.frontMatter.end)))
    fragment.append(details)
  }
  for (const node of doc.root.children) {
    if (options.hidden.has(node)) continue
    const rendered = block(ctx, node, null)
    if (rendered) fragment.append(rendered)
  }
  container.replaceChildren(fragment)
  return {index, marks: ctx.marks}
}

/**
 * Render a Comment cell (already parsed by GFM as part of the comments
 * table) as inline content. `<br>` is a line break (SPEC §6.4).
 */
export function renderCell(document: Document, cell: TableCell, doc: SidemarkDocument): DocumentFragment {
  const ctx: Context = {
    document,
    index: null,
    highlights: [],
    anchors: [],
    definitions: collectDefinitions(doc.root),
    marks: new Map()
  }
  const fragment = document.createDocumentFragment()
  for (const child of cell.children) fragment.append(...inline(ctx, child))
  return fragment
}

// ---------------------------------------------------------------------------
// Blocks

function block(ctx: Context, node: RootContent, parent: Parents | null): Node | null {
  switch (node.type) {
    case 'paragraph': {
      if (isAnchorOnly(ctx, node.children)) return null
      return withChildren(ctx, el(ctx, 'p'), node.children)
    }
    case 'heading':
      return withChildren(ctx, el(ctx, `h${node.depth}`), node.children)
    case 'thematicBreak':
      return el(ctx, 'hr')
    case 'blockquote':
      return blocks(ctx, el(ctx, 'blockquote'), node)
    case 'list': {
      const list = el(ctx, node.ordered ? 'ol' : 'ul')
      if (node.ordered && node.start != null && node.start !== 1) list.setAttribute('start', String(node.start))
      for (const item of node.children) list.append(block(ctx, item, node) ?? '')
      return list
    }
    case 'listItem': {
      const item = el(ctx, 'li')
      const tight = parent?.type === 'list' && !parent.spread && !node.spread
      if (typeof node.checked === 'boolean') {
        item.className = 'sm-task'
        const box = el(ctx, 'input') as HTMLInputElement
        box.type = 'checkbox'
        box.checked = node.checked
        box.disabled = true
        box.setAttribute('aria-label', node.checked ? 'Done' : 'Not done')
        item.append(box, ' ')
      }
      for (const child of node.children) {
        if (tight && child.type === 'paragraph') {
          if (isAnchorOnly(ctx, child.children)) continue
          for (const phrasing of child.children) item.append(...inline(ctx, phrasing))
        } else {
          const rendered = block(ctx, child, node)
          if (rendered) item.append(rendered)
        }
      }
      return item
    }
    case 'code': {
      const pre = el(ctx, 'pre', 'sm-code')
      if (node.lang) pre.dataset.lang = node.lang
      const code = el(ctx, 'code')
      code.append(...valueText(ctx, node))
      pre.append(code)
      return pre
    }
    case 'html': {
      if (isAnchorOnlyHtml(ctx, node)) return null
      const pre = el(ctx, 'pre', 'sm-raw-html')
      pre.title = 'Raw HTML is shown as text, not rendered'
      pre.textContent = node.value
      return pre
    }
    case 'table': {
      const table = el(ctx, 'table')
      const thead = el(ctx, 'thead')
      const tbody = el(ctx, 'tbody')
      const align = node.align ?? []
      node.children.forEach((row, r) => {
        const tr = el(ctx, 'tr')
        row.children.forEach((cell, c) => {
          const td = el(ctx, r === 0 ? 'th' : 'td')
          const a = align[c]
          if (a) td.style.textAlign = a
          withChildren(ctx, td, cell.children)
          tr.append(td)
        })
        ;(r === 0 ? thead : tbody).append(tr)
      })
      table.append(thead)
      if (tbody.childNodes.length) table.append(tbody)
      const wrap = el(ctx, 'div', 'sm-table')
      wrap.append(table)
      return wrap
    }
    case 'footnoteDefinition': {
      const div = el(ctx, 'div', 'sm-footnote')
      div.append(el(ctx, 'span', 'sm-footnote-label', `${node.label ?? node.identifier}.`))
      return blocks(ctx, div, node)
    }
    case 'definition':
    case 'yaml':
      return null
    default:
      // Phrasing content at block level does not occur in mdast from GFM;
      // render defensively.
      return wrapInline(ctx, node as PhrasingContent)
  }
}

function blocks(ctx: Context, element: HTMLElement, node: Parents): HTMLElement {
  for (const child of node.children) {
    const rendered = block(ctx, child as RootContent, node)
    if (rendered) element.append(rendered)
  }
  return element
}

function wrapInline(ctx: Context, node: PhrasingContent): HTMLElement {
  const span = el(ctx, 'span')
  span.append(...inline(ctx, node))
  return span
}

function withChildren(ctx: Context, element: HTMLElement, children: readonly PhrasingContent[]): HTMLElement {
  for (const child of children) element.append(...inline(ctx, child))
  return element
}

// ---------------------------------------------------------------------------
// Inline

function inline(ctx: Context, node: PhrasingContent): Node[] {
  switch (node.type) {
    case 'text':
      return valueText(ctx, node)
    case 'inlineCode': {
      const code = el(ctx, 'code')
      code.append(...valueText(ctx, node))
      return [code]
    }
    case 'emphasis':
      return [withChildren(ctx, el(ctx, 'em'), node.children)]
    case 'strong':
      return [withChildren(ctx, el(ctx, 'strong'), node.children)]
    case 'delete':
      return [withChildren(ctx, el(ctx, 'del'), node.children)]
    case 'break':
      return [el(ctx, 'br')]
    case 'link':
      return [link(ctx, node.url, node.title ?? null, node.children)]
    case 'linkReference': {
      const definition = ctx.definitions.get(node.identifier)
      if (!definition) return node.children.flatMap((child) => inline(ctx, child))
      return [link(ctx, definition.url, definition.title ?? null, node.children)]
    }
    case 'image':
      return [image(ctx, node, node.url, node.alt ?? '')]
    case 'imageReference': {
      const definition = ctx.definitions.get(node.identifier)
      return [image(ctx, node, definition?.url ?? '', node.alt ?? '')]
    }
    case 'footnoteReference': {
      const sup = el(ctx, 'sup', 'sm-footnote-ref', `[${node.label ?? node.identifier}]`)
      atom(ctx, sup, node)
      return [sup]
    }
    case 'html': {
      if (isAnchorHtml(ctx, node)) return []
      if (BR.test(node.value.trim())) return [el(ctx, 'br')]
      // Shown, never rendered.
      return [el(ctx, 'code', 'sm-raw-html-inline', node.value)]
    }
    default:
      return []
  }
}

function link(ctx: Context, url: string, title: string | null, children: readonly PhrasingContent[]): HTMLElement {
  const href = safeHref(url)
  const a = el(ctx, href ? 'a' : 'span', href ? null : 'sm-unsafe-link')
  if (href) {
    a.setAttribute('href', href)
    if (!href.startsWith('#')) {
      a.setAttribute('target', '_blank')
      a.setAttribute('rel', 'noopener noreferrer nofollow')
    }
  }
  a.title = title ?? url
  return withChildren(ctx, a, children)
}

function image(ctx: Context, node: Nodes, url: string, alt: string): HTMLElement {
  const wrapper = el(ctx, 'span', 'sm-image')
  const src = embeddedImageSrc(url)
  if (src) {
    const img = el(ctx, 'img') as HTMLImageElement
    img.alt = alt
    img.setAttribute('src', src)
    wrapper.append(img)
  } else {
    // Not loaded: a remote image would tell its server that this document
    // is open, and a relative one would be requested from this app's host.
    wrapper.classList.add('sm-image-placeholder')
    wrapper.append(el(ctx, 'span', null, alt ? `Image: ${alt}` : 'Image'))
    const remote = remoteImageUrl(url)
    if (remote) {
      const host = new URL(remote).host
      const open = el(ctx, 'a', 'sm-image-open', `open from ${host}`) as HTMLAnchorElement
      open.setAttribute('href', remote)
      open.setAttribute('target', '_blank')
      open.setAttribute('rel', 'noopener noreferrer nofollow')
      open.title = `Not loaded, so opening this document contacted no other server. Opens ${remote} in a new tab.`
      wrapper.append(' · ', open)
    } else {
      wrapper.title = `Not loaded: ${url}`
    }
  }
  atom(ctx, wrapper, node)
  return wrapper
}

/** Images in `root` that point at an http(s) server (and so are not displayed). */
export function countRemoteImages(root: Root): number {
  const definitions = collectDefinitions(root)
  let count = 0
  const visit = (node: Nodes) => {
    const url = node.type === 'image' ? node.url : node.type === 'imageReference' ? definitions.get(node.identifier)?.url : undefined
    if (url !== undefined && remoteImageUrl(url)) count++
    if ('children' in node) for (const child of node.children) visit(child as Nodes)
  }
  visit(root)
  return count
}

/** Register an indivisible element and highlight it as a whole. */
function atom(ctx: Context, element: HTMLElement, node: Nodes): void {
  const range = rangeOf(node)
  if (!range) return
  ctx.index?.registerAtom(element, range)
  const ids = ctx.highlights.filter((h) => h.range.start <= range.start && range.end <= h.range.end).map((h) => h.id)
  if (ids.length) markElement(ctx, element, ids)
}

/**
 * The value of a text, inlineCode or code node as DOM text, split into runs
 * with the same set of highlights. Each run is registered with the index.
 */
function valueText(ctx: Context, node: ValueNode): Node[] {
  const value = node.value
  if (!ctx.index || value.length === 0) return value ? [ctx.document.createTextNode(value)] : []
  const relevant = ctx.highlights.filter((h) => overlaps(h.range, node))
  const out: Node[] = []
  if (relevant.length === 0) {
    const text = ctx.document.createTextNode(value)
    ctx.index.registerText(text, node, 0, value.length)
    return [text]
  }
  // Highlight membership per character: the character's whole source span
  // lies inside the range.
  const map = ctx.index.charMap(node)
  let runStart = 0
  let runKey = ''
  let runIds: string[] = []
  const flush = (end: number) => {
    if (end <= runStart) return
    const text = ctx.document.createTextNode(value.slice(runStart, end))
    ctx.index!.registerText(text, node, runStart, end)
    if (runIds.length) {
      const mark = ctx.document.createElement('mark')
      mark.append(text)
      markElement(ctx, mark, runIds)
      out.push(mark)
    } else {
      out.push(text)
    }
  }
  for (let i = 0; i < value.length; i++) {
    const s = map.starts[i]!
    const e = map.ends[i]!
    const ids = relevant.filter((h) => s >= h.range.start && e <= h.range.end).map((h) => h.id)
    const key = ids.join(' ')
    if (i === 0) {
      runKey = key
      runIds = ids
      continue
    }
    if (key !== runKey) {
      flush(i)
      runStart = i
      runKey = key
      runIds = ids
    }
  }
  flush(value.length)
  return out
}

function markElement(ctx: Context, element: HTMLElement, ids: string[]): void {
  element.classList.add('sm-hl')
  element.dataset.threads = ids.join(' ')
  if (ids.length > 1) element.classList.add('sm-hl-overlap')
  for (const id of ids) {
    const list = ctx.marks.get(id)
    if (list) list.push(element)
    else ctx.marks.set(id, [element])
  }
}

// ---------------------------------------------------------------------------
// Anchors and raw HTML

function isAnchorHtml(ctx: Context, node: Nodes): boolean {
  const range = rangeOf(node)
  if (!range) return false
  return ctx.anchors.some((a) => a.range.start <= range.start && range.end <= a.range.end)
}

/** An HTML block that holds nothing but anchors and whitespace. */
function isAnchorOnlyHtml(ctx: Context, node: Extract<Nodes, {type: 'html'}>): boolean {
  const range = rangeOf(node)
  if (!range) return false
  let rest = node.value
  for (const anchor of ctx.anchors) {
    if (anchor.range.start >= range.start && anchor.range.end <= range.end) rest = rest.replace(anchor.raw, '')
  }
  return rest.trim() === ''
}

/** A paragraph of only anchors and whitespace (SPEC §5.4): render nothing. */
function isAnchorOnly(ctx: Context, children: readonly PhrasingContent[]): boolean {
  if (children.length === 0) return false
  let sawAnchor = false
  for (const child of children) {
    if (child.type === 'html' && isAnchorHtml(ctx, child)) sawAnchor = true
    else if (child.type === 'text' && child.value.trim() === '') continue
    else return false
  }
  return sawAnchor
}

// ---------------------------------------------------------------------------
// Helpers

function el(ctx: Context, tag: string, className?: string | null, text?: string): HTMLElement {
  const element = ctx.document.createElement(tag)
  if (className) element.className = className
  if (text !== undefined) element.textContent = text
  return element
}

function rangeOf(node: Nodes): SourceRange | null {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  return start === undefined || end === undefined ? null : {start, end}
}

function overlaps(range: SourceRange, node: Nodes): boolean {
  const r = rangeOf(node)
  return r !== null && range.start < r.end && r.start < range.end
}

function collectDefinitions(root: Root): Map<string, Definition> {
  const definitions = new Map<string, Definition>()
  const visit = (node: Nodes) => {
    if (node.type === 'definition' && !definitions.has(node.identifier)) definitions.set(node.identifier, node)
    if ('children' in node) for (const child of node.children) visit(child as Nodes)
  }
  visit(root)
  return definitions
}
