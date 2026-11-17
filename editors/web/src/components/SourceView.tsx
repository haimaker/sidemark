import type {CommentMarkDocument} from '@commentmark/core'

interface Span {
  start: number
  end: number
  kind: 'anchor' | 'table'
}

/**
 * The raw Markdown, read-only, with what CommentMark wrote marked: anchors in
 * the body and the comments table at the end. Rendered as text nodes only.
 */
export function SourceView({doc}: {doc: CommentMarkDocument}) {
  const spans: Span[] = doc.anchors.map((a) => ({start: a.range.start, end: a.range.end, kind: 'anchor' as const}))
  if (doc.table) {
    const start = doc.table.heading?.range.start ?? doc.table.range.start
    spans.push({start, end: doc.table.range.end, kind: 'table'})
  }
  spans.sort((a, b) => a.start - b.start)
  const parts = []
  let at = 0
  for (const span of spans) {
    if (span.start < at) continue
    if (span.start > at) parts.push(doc.source.slice(at, span.start))
    parts.push(
      <span class={`src-${span.kind}`} key={span.start}>
        {doc.source.slice(span.start, span.end)}
      </span>
    )
    at = span.end
  }
  if (at < doc.source.length) parts.push(doc.source.slice(at))
  return (
    <div class="source-view">
      <p class="source-legend">
        Read-only. <span class="src-anchor">Anchors</span> mark commented text; the <span class="src-table">comments table</span>{' '}
        holds the threads.
      </p>
      <pre class="source" tabIndex={0} aria-label="Markdown source" data-testid="source">
        {parts}
      </pre>
    </div>
  )
}
