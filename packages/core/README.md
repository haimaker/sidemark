# @sidemark/core

Reference Reader and Writer for **Sidemark**, a convention for storing Google Docs style comment threads inside Markdown files (see [`SPEC.md`](../../SPEC.md)).

- Parses a document into threads, comments, anchors and a text projection with a full source map.
- Writes by splicing the original text: bytes outside an edit are never touched, and nothing is re-serialised.
- Runs in browsers and Node (ESM only, no Node APIs). Built on micromark / mdast.

## Install

```sh
npm install @sidemark/core
```

In this repository it is an npm workspace: run `npm install` at the root, then `npm run build` in `packages/core`.

## Usage

```ts
import {parse, createThread, addReply, setStatus, maintain} from '@sidemark/core'

let source = '# Plan\n\nThe quick brown fox jumps.\n'

// Comment on "quick brown" (source offsets, e.g. from an editor selection).
const start = source.indexOf('quick brown')
const created = createThread(source, {
  range: {start, end: start + 'quick brown'.length},
  author: '@wayne',
  comment: 'Should this be "red fox"?'
})
source = created.source

source = addReply(source, created.id, {author: '@alex', comment: 'Agreed.'})
source = setStatus(source, created.id, {status: 'resolved', author: '@alex'})
source = maintain(source) // on save (§9.6)

const doc = parse(source)
for (const thread of doc.threads) {
  console.log(thread.id, thread.state, thread.attachment.kind, thread.comments.length)
}
```

## API

### Reading

```ts
parse(source: string): SidemarkDocument
getThread(doc: SidemarkDocument, id: string): Thread | undefined
```

`SidemarkDocument` (all offsets are UTF-16 indexes into `source`, half-open):

| Field | |
|---|---|
| `root` | mdast tree (GFM) of everything after the BOM and front matter, positions as source offsets. Render the body from this. |
| `bodyStart`, `frontMatter` | Where Markdown starts; the front matter range or `null`. |
| `table` | The comments table (§6.1): `node`, `range`, `heading` (`{node, range, text}` or `null`), `columns`, `rows`. |
| `threads` | In table order. Each: `id`, `comments`, `state` (`open`/`resolved`), `attachment`, `quote` (parsed root Quote cell), `anchors` (valid pair or `null`). |
| `anchors`, `strayAnchors` | Every recognised anchor, and the stray ones with a `stray` reason. |
| `malformedRows` | Rows without a valid Ref (§6.5). |
| `projection` | §7.1 text projection: `{text, starts, ends}`, a source span per UTF-16 unit. |
| `sourceMap` | Maps characters of mdast `text` / `inlineCode` / `code` nodes to source offsets. |
| `lineEnding` | The document's predominant line ending. |

`attachment` is `{kind: 'anchored', via: 'anchors' | 'quote', range, text}`, `{kind: 'orphaned'}` or `{kind: 'document'}`. For `via: 'anchors'` the range is the source between the two anchors.

Each `Comment` has `author`, `date: {raw, value: Date | null}`, `comment` (Markdown for an edit box: pipes unescaped, `<br>` as newlines), `commentSource` (the cell exactly as written), `status: {raw, value: 'open' | 'resolved' | null}`, `extraCells`, `index` and `row` (with per-cell source ranges).

### Editor helpers

```ts
doc.sourceMap.toSource(node, offset): number      // char offset in a text/inlineCode/code node → source offset
doc.sourceMap.fromSource(node, sourceOffset): number // the reverse (rounds down inside escapes/entities)
doc.sourceMap.charMap(node): {starts: number[]; ends: number[]}

projectionSpan(projection, range): {from, to}  // source range → projection indexes
sourceRangeOf(projection, from, to): SourceRange | null
projectRange(projection, range): string        // trimmed projection text of a source range
indexAtOrAfter(projection, sourceOffset): number
```

To turn a DOM selection into a `createThread` range: map each end of the selection to the mdast text node it is in (the editor knows which node rendered which DOM text) and call `doc.sourceMap.toSource(node, offset)`. The writer snaps the range to a safe placement itself.

### Writing

Every writer is a pure function `source → source`.

```ts
createThread(source, {range: SourceRange | null, author, comment, date?}, options?): {source: string; id: string}
addReply(source, threadId, {author, comment, date?}, options?): string
setStatus(source, threadId, {status: 'open' | 'resolved', author, comment?, date?}, options?): string
editComment(source, {threadId, index}, comment): string
deleteComment(source, {threadId, index}): string
deleteThread(source, threadId): string
purge(source, {resolved?: boolean, orphaned?: boolean}): string
maintain(source): string

interface WriterOptions {
  generateId?: () => string // default: c- + 6 random [0-9a-z]
  now?: () => Date          // default: new Date()
}
```

- `range: null` creates a document-level thread. Otherwise the range is snapped out of code spans, links, images, autolinks, escapes and entities, placed outside emphasis delimiters, and turned into own-paragraph anchors around code blocks, HTML blocks and thematic breaks (§5.3, §5.4). The result is re-parsed and must parse exactly as before apart from the anchors.
- `comment` is Markdown; `|` is escaped and newlines become `<br>`. `date` is a `Date` or a string already in the form `YYYY-MM-DDThh:mmZ`.
- `maintain` removes stray anchors, inserts anchors for threads found through their Quote (turning a bare root Ref into `[ID](#ID)`), and refreshes stale Quote cells. It never deletes a thread and is idempotent.

### Errors

Every deliberate failure is a `SidemarkError` with a `code`: `INVALID_RANGE`, `UNSAFE_PLACEMENT` (thrown as `PlacementError`), `UNSAFE_EDIT`, `THREAD_NOT_FOUND`, `COMMENT_NOT_FOUND`, `EMPTY_COMMENT`, `INVALID_ID`, `ID_COLLISION`, `INVALID_DATE`, `INVALID_ARGUMENT`.

### Building blocks

`buildQuote`, `readQuoteCell`, `writeQuoteCell`, `findQuote`, `anchorHtml`, `escapeCellMarkdown`, `commentFromCell`, `parseDate`, `formatDate`, `isThreadId`, `randomThreadId`, `THREAD_ID`.

## How it is organised

| Module | Spec | |
|---|---|---|
| `markdown.ts` | §7.1 | Front matter, parsing to mdast and micromark events with source offsets. |
| `source-map.ts` | | Per-character source map of text nodes, built from micromark tokens. |
| `projection.ts` | §7.1 | Text projection with source spans. |
| `anchors.ts` | §5.1, §5.5 | Recognising anchors, valid pairs, stray reasons. |
| `table.ts`, `cells.ts` | §6 | Finding the comments table, splitting and reading rows. |
| `quote.ts` | §7.2, §7.3 | Building, reading and writing Quote cells. |
| `resolve.ts` | §8 | Attachment, including the exact fallback. |
| `parse.ts` | | The Reader. |
| `placement.ts` | §5.3, §5.4 | Where anchors go, with verification by re-parsing. |
| `rows.ts`, `anchor-edits.ts`, `edits.ts` | §6.2, §9 | Splices for rows, cells, the table and anchors. |
| `writer.ts`, `maintain.ts` | §9 | The Writer operations. |

Comments cite the spec section they implement. Comments marked `SPEC NOTE` mark the few places where the code goes beyond or differs from the spec text.

## Tests

```sh
npm test
```

Runs the language-agnostic suite in [`/fixtures`](../../fixtures/README.md) plus unit tests for the source map, quotes, placement (including randomised create → delete round trips that must restore the input byte for byte) and maintenance idempotence. `UPDATE_FIXTURES=1 npm test` rewrites expected fixture outputs from this implementation; review the diff before committing.
