# CommentMark conformance fixtures

Language-agnostic test cases for implementations of the CommentMark specification (`../SPEC.md`). Any Reader or Writer, in any language, can run them. The reference implementation (`packages/core`) runs every case in its test suite.

All files are UTF-8. Line endings are significant (some cases use CRLF), so read files as bytes or with newline translation turned off. `.gitattributes` stops Git from converting them.

```
fixtures/
  reader/<case>.md          input document
  reader/<case>.json        what a Reader must report
  writer/<case>/input.md    input document
  writer/<case>/operation.json
  writer/<case>/expected.md exact output (absent for error cases)
```

## Reader cases

Parse `<case>.md` and compare your result with `<case>.json`. Ignore the `description` key. Arrays are ordered.

```jsonc
{
  "description": "What the case tests, with SPEC section numbers.",

  // §7.1 text projection of the body (§3: the comments table and the
  // heading directly above it are excluded).
  "projection": "Launch plan The quick brown fox jumps over the lazy dog.",

  // §6.1 the comments table, or null if there is none.
  "table": {
    "heading": "Comments",          // text of the heading directly above, or null
    "columns": ["Ref", "Quote", "Author", "Date", "Comment", "Status"], // header cell text, trimmed
    "rowCount": 2                   // body rows, including malformed ones
  },

  // Threads in table order (order of each thread's first row).
  "threads": [
    {
      "id": "c-x7k2m9",
      "state": "resolved",          // §6.4: "open" | "resolved"
      "attachment": "anchored",     // §8: "anchored" | "orphaned" | "document"
      "anchoredBy": "anchors",      // "anchors" (§8 step 1) | "quote" (§8 step 3) | null
      // The source text of the range, or null when not anchored.
      //  - anchors: everything between the end of the start anchor and the
      //    start of the end anchor;
      //  - quote: from the first to the last source character of the
      //    matched text (an escape or entity counts whole).
      "rangeSource": "quick brown fox",
      "rangeText": "quick brown fox", // projection of the range, trimmed
      // §7.3 the root row's Quote cell, or null if the cell has no text.
      // Whitespace is collapsed (§8 step 3); whitespace at the edges of the
      // quote belongs to the context; the cell's ends are trimmed.
      "quote": {
        "prefix": "The ",
        "quote": "quick brown fox",
        "suffix": " jumps over the lazy dog.",
        "marker": "strong"          // "strong" (** or __) | "html" (<strong>/<b>) | "none"
      },
      "comments": [
        {
          "author": "@wayne",       // cell text, trimmed
          "date": "2026-11-17T10:32Z", // cell text, trimmed
          // The instant as an ISO 8601 UTC string with milliseconds, or null
          // when the cell is empty or unparseable (§6.4).
          "dateParsed": "2026-11-17T10:32:00.000Z",
          "comment": "Should this be \"red fox\"?", // the Comment cell's source, trimmed, as written
          "status": "",             // cell text, trimmed, as written
          "statusValue": null       // "open" | "resolved" | null (empty or unrecognised)
        }
      ]
    }
  ],

  // Stray anchors (§5.5) in document order.
  "strayAnchors": [
    {"id": "c-1", "end": true, "raw": "<a id=\"c-1-end\"></a>", "reason": "duplicate"}
  ],

  // Source of each malformed row (§6.5), without its line ending.
  "malformedRows": ["| C-1 | | @a | | upper case | |"]
}
```

Cell text means the cell's inline content as GFM parses it, as plain text: text with escapes and entities decoded, code span content, image descriptions; nothing for raw HTML.

### Stray reasons

The reasons are the four kinds named in §5.5, checked in this order for each anchor:

| Reason | Meaning |
|---|---|
| `unknown-thread` | No row of the comments table has this thread ID. |
| (not stray) | The anchor is the start or end of its thread's valid pair. |
| `duplicate` | The thread has a valid pair and this anchor is not part of it. |
| `empty` | The thread has no valid pair because its first start anchor and the first end anchor after it enclose only whitespace and anchors. Both get this reason. |
| `unmatched` | Any other anchor of a thread without a valid pair: a start with no end after it, an end with no start before it, and any further anchors of a thread whose first pair is `empty` (§5.5: any other anchor not in a valid pair). |

An implementation that does not classify reasons can drop the `reason` key when comparing.

### Dates

`dateParsed` follows the §6.4 grammar. Fractional seconds are truncated to milliseconds.

## Writer cases

Apply the operation in `operation.json` to `input.md` and compare the result with `expected.md` byte for byte. If the operation has `expectError`, the operation must fail instead, and no output is compared.

```jsonc
{
  "description": "What the case tests.",
  "operation": "createThread",
  "args": { ... },
  "expectError": "UNSAFE_PLACEMENT"   // optional
}
```

| `operation` | `args` |
|---|---|
| `createThread` | `range`, `author`, `comment`, `id`, `date` |
| `addReply` | `thread`, `author`, `comment`, `date` |
| `setStatus` | `thread`, `status` (`open` or `resolved`), `author`, `comment` (optional, default empty), `date` |
| `editComment` | `thread`, `index` (0 = root), `comment` |
| `deleteComment` | `thread`, `index` |
| `deleteThread` | `thread` |
| `purge` | `resolved` (bool), `orphaned` (bool) |
| `maintain` | none: the §9.6 save-time maintenance |

- `id` is the ID the writer must use for the new thread (it does not appear in the input). `date` is already in the writer form `YYYY-MM-DDThh:mmZ` and must be written as given.
- `comment` is Markdown that may contain `|` and newlines; writers escape `|` as `\|` and write newlines as `<br>` (§6.4).
- `range` is the commented source range, described without offsets so that it means the same in every language:
  - `null`: a document-level thread;
  - `{"text": "quick brown", "occurrence": 1}`: the `occurrence`-th (1-based, default 1) occurrence of that exact string in the input source;
  - `{"from": "ends", "to": "Second"}`: from the start of the first occurrence of `from` to the end of the first occurrence of `to` that starts at or after it.

  The range is what a user selected. Writers must apply the snapping rules of §5.3 and §5.4 themselves.

Error codes used by `expectError`:

| Code | When |
|---|---|
| `UNSAFE_PLACEMENT` | No anchor placement leaves the body parsing the same (§5.3 "MUST NOT change how the surrounding Markdown parses"). |
| `INVALID_RANGE` | The range is empty, outside the body, or overlaps the comments table. |
| `EMPTY_COMMENT` | The row would have both Comment and Status empty (§6.4). |
| `THREAD_NOT_FOUND` | No thread has the given ID. |

### Choices the expected outputs depend on

Writer outputs are byte-exact, so they encode choices where the spec allows more than one answer. An implementation that chooses differently will produce a different but conforming file for the cases listed; check those by reading the output back instead (same threads, same attachment, same text).

| Choice | Reference behaviour | Cases affected |
|---|---|---|
| §7.2 writers MAY shorten context at any word boundary | Only when the 32-code-point cut falls inside a word, dropping the partial word (unless nothing would be left). | every `create-*` case, `delete-root-anchored`, `maintain-refresh-*`, `maintain-crlf` |
| §7.3 escaping | Escape only `` \ ` * [ ] < \| ~ ``, `_` at a word boundary, and `&` that would start an entity; fall back to escaping all ASCII punctuation if the cell would not read back exactly. | `create-quote-escaping` |
| §5.4 forms | Own paragraphs with blank lines; if that changes the parse, the first §5.4 alternative (no blank line), then the second (end of the preceding paragraph / start of the following one). | `create-code-block*`, `create-indented-code-block` |
| §5.4 a second thread on the same block | Its anchors join the existing anchor-only paragraphs (the MAY). | (unit tests) |

Everything else the writer cases check (empty cells as `| |`, when §9.6 rewrites a Quote, rewriting a bare Ref on repair, copying the Quote when an orphaned root is deleted, refusing unsafe placements and tables) is required by the spec.
