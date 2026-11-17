# CommentMark

**Version 0.1 (draft).**

CommentMark is a convention for storing Google Docs style comment threads inside a Markdown file. Comments are anchored to ranges of text, can be replied to and resolved, and travel with the file. There is no sidecar file, database or server.

## 1. Overview

A commented document has two parts:

- **Anchors** in the body: pairs of empty `<a>` elements that mark the start and end of each commented range. They render as nothing.
- **A comments table** at the end: an ordinary Markdown table with one row per comment.

```markdown
# Launch plan

The <a id="c-x7k2m9"></a>quick brown fox<a id="c-x7k2m9-end"></a> jumps over the lazy dog.

## Comments

| Ref | Quote | Author | Date | Comment | Status |
|---|---|---|---|---|---|
| [c-x7k2m9](#c-x7k2m9) | The **quick brown fox** jumps over the lazy dog. | @wayne | 2026-11-17T10:32Z | Should this be "red fox"? | |
| [c-x7k2m9](#c-x7k2m9) | | @alex | 2026-11-17T11:02Z | Agreed, changed it. | resolved |
```

A tool that knows this convention hides the table and shows the threads beside the text they refer to. A tool that does not know it shows the body unchanged, followed by a readable table whose Ref links jump to the commented text.

## 2. Design principles

These principles decide every case the rules below do not cover.

1. **The file is the whole record.** Every piece of comment data is in the Markdown file. Version control is useful but never required.
2. **Unaware tools come first.** The body must render cleanly in a tool that has never heard of this convention, and a person using such a tool must be able to read, add, reply to, resolve and delete comments by editing the table.
3. **Never guess.** A thread resolves to exactly one location, or it is treated as having none. A tool never attaches a comment to text it is not sure about.
4. **Never destroy.** A tool preserves anything it does not understand, and deletes comment data only when a person explicitly asks.
5. **Change as little as possible.** A tool rewrites only the bytes an operation requires, so diffs stay small and merges stay clean.

## 3. Conformance and terminology

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as described in RFC 2119.

The base syntax is [CommonMark](https://spec.commonmark.org/) with the table extension from [GitHub Flavored Markdown](https://github.github.com/gfm/). Documents are UTF-8.

- **Thread:** a root comment plus its replies, identified by a thread ID.
- **Comment:** one row of the comments table.
- **Body:** the document excluding the comments table and a heading that immediately precedes it.
- **Anchor:** an empty inline `<a>` element in the body that marks one end of a thread's range.
- **Reader:** software that parses a document and resolves its threads.
- **Writer:** software that modifies a document. Every writer is also a reader.
- **Aware / unaware tool:** a tool that does or does not implement this specification.

## 4. Thread IDs

A thread ID is `c-` followed by 1 to 32 characters from `0-9` and `a-z`, that is, `c-[0-9a-z]{1,32}`. IDs are case-sensitive.

- Writers MUST generate new IDs as `c-` followed by 6 characters chosen uniformly at random from `0-9a-z`, and MUST regenerate if the ID already appears in the document.
- Readers MUST accept every valid ID, so that a person can hand-write one such as `c-1`.

Random IDs let two people add comments on separate branches or copies without colliding. IDs carry no meaning; a viewer that wants "comment 3" numbers threads at display time.

## 5. Anchors

### 5.1 Syntax

A thread with ID `c-x7k2m9` is anchored by a start anchor and an end anchor:

```html
<a id="c-x7k2m9"></a> ... <a id="c-x7k2m9-end"></a>
```

- Writers MUST emit anchors exactly in this form: lowercase `a`, a single `id` attribute in double quotes, no content, no whitespace inside the tags.
- An anchor is inline HTML: an `<a>` open tag immediately followed by `</a>`, whose `id` attribute is a thread ID or a thread ID followed by `-end`. Readers MUST recognise it whatever the quoting or spacing of the attribute, and MUST ignore other attributes.
- Tag and attribute names are matched without regard to case, as in HTML. Thread IDs remain case-sensitive.
- An `<a>` with anything between its tags, including whitespace, is not an anchor. Neither is one inside an HTML block.

### 5.2 Ranges

The **range** of a thread is everything between its start anchor and its end anchor in document order.

- A range MAY cross block boundaries (for example, start in one paragraph and end in the next).
- Ranges of different threads MAY overlap or nest in any way.

### 5.3 Placement

An anchor may be placed anywhere CommonMark parses inline content: paragraphs, headings, list items, block quotes and table cells.

Writers MUST NOT place an anchor inside:

- a code span, fenced code block or indented code block
- an HTML block
- link text, a link destination or a link title
- an image description
- an autolink, whether written with angle brackets or recognised by GFM as a bare URL or email address
- a character reference (`&amp;`) or backslash escape
- a hard line break
- other raw inline HTML
- a footnote reference
- the prefix of a container on a continuation line (`> ` or list indentation)
- front matter
- the comments table

The general rule is that **inserting an anchor MUST NOT change how the surrounding Markdown parses**. The list above is the known cases, not a complete one.

- If a requested range boundary falls where an anchor is not allowed, the writer MUST move that boundary outward until the anchor can be inserted without changing the parse. A comment on part of a link's text therefore covers the whole link.
- A boundary that falls on structure with no text of its own, such as a blank line between blocks, a list marker or a table pipe, moves to the nearest position where an anchor is allowed. The range MUST NOT lose any of the requested text.
- A boundary at the inner edge of emphasis, strong emphasis or strikethrough delimiters MUST move outside the delimiters. An anchor directly inside a delimiter (`**<a id="…"></a>word**`) can stop the emphasis from parsing.
- Writers SHOULD verify a placement by parsing the result.
- A writer that cannot find a position that leaves the parse unchanged MUST refuse the operation and leave the document as it was.

### 5.4 Blocks that cannot contain anchors

To comment on a code block, HTML block or other block that cannot hold inline HTML, the writer places each anchor in a paragraph of its own, directly before and directly after the block, in the same container (list item or block quote) as the block:

````markdown
<a id="c-4f9tq1"></a>

```js
const retries = 3;
```

<a id="c-4f9tq1-end"></a>
````

This is an ordinary range; the anchors happen to sit in their own paragraphs. Unaware renderers show each anchor paragraph as a small vertical gap. Commenting on a sub-range of a code block is not supported in this version.

The blank lines in the form above can themselves change the parse: inside a list they turn a tight list into a loose one. Writers MUST NOT add blank lines where they would do that. When the form above is not safe, a writer MAY use either of these instead, which give the same range:

- the anchor on its own line with no blank line between it and the block, where the block can interrupt a paragraph (fenced code and HTML blocks can)
- the start anchor at the end of the preceding paragraph or heading, and the end anchor at the start of the following one

A second thread on the same block MAY add its anchors to the existing anchor-only paragraphs.

### 5.5 Valid and stray anchors

For a given thread ID, the **valid anchor pair** is the first start anchor in document order together with the first end anchor that follows it, provided that the source between them contains something other than whitespace and other anchors.

Every other anchor is **stray**. The conformance fixtures name four kinds, checked in this order:

- `unknown-thread`: an anchor whose ID matches no thread in the comments table
- `duplicate`: a repeat of an anchor already used in a valid pair (for example, after a paragraph was copied and pasted)
- `empty`: both anchors of a pair with nothing between them (the commented text was deleted)
- `unmatched`: any other anchor that is not part of its thread's valid pair, such as a start anchor with no end anchor after it, or an end anchor with no start anchor before it

Readers MUST ignore stray anchors. Writers SHOULD remove stray anchors when saving.

## 6. The comments table

### 6.1 Identification

The comments table is a top-level GFM table whose first six header cells are, in order:

```markdown
| Ref | Quote | Author | Date | Comment | Status |
```

Header cells are compared by their text as GFM parses them (so `**Ref**` matches), after trimming whitespace and ignoring ASCII case. To qualify, a table must also either have no body rows or have at least one row with a valid Ref cell (§6.4).

If more than one table qualifies, the comments table is the last one that has at least one row with a valid Ref cell. If none has, it is the last qualifying table. The others are ordinary content. Preferring a table with rows means that an empty table with the same header, such as a template pasted at the end, cannot hide existing threads.

No marker, heading or hidden sentinel identifies the table. The header row is the only signal.

### 6.2 Placement

- When a writer creates the comments table, it MUST append it as the last block of the document, preceded by the heading `## Comments`.
- Readers MUST accept the table anywhere at the top level of the document, with or without a heading. The heading's text is not significant and may be renamed or translated.
- A writer that removes the last row MUST remove the table, and SHOULD remove an immediately preceding heading whose text is exactly `Comments`. A heading with any other text is the author's own and is kept.
- If the document ends inside a block that would absorb appended text, such as an unclosed fenced code block or an unterminated HTML block, the table cannot be appended without changing the body. The writer MUST refuse to create it.

### 6.3 Rows and threads

Each body row with a valid Ref cell is a comment. A **thread** is all comments that share a thread ID, in row order. The first is the **root**; the rest are replies.

- Writers MUST NOT make a thread's rows non-contiguous: a new row for a thread goes directly after that thread's last row.
- Readers MUST group rows by ID even when they are not contiguous, keeping row order.
- Row order, not the Date column, defines the order of comments within a thread.

### 6.4 Columns

Cells are interpreted as GFM parses them. Wherever this specification compares a cell with a fixed value (the header names, a bare ID, a Status), it compares the cell's text after inline parsing, with escapes and entities decoded.

Literal `|` characters in any cell MUST be written as `\|`. Two limits follow from GFM tables: a cell cannot contain a literal `\|`, even inside a code span, and a `<br>` inside a code span cannot be told apart from a line break.

**Ref.** Identifies the thread.

- A Ref cell is valid if it contains a link whose destination is `#` followed by a thread ID, or if its text is exactly a thread ID.
- Readers take the ID from the link destination when there is a link.
- Writers MUST emit `[ID](#ID)` for threads that have anchors, and SHOULD emit the bare ID for document-level threads (§8) so the table has no dead link.

**Quote.** The commented text with surrounding context, used for display and as a fallback anchor. See §7.

- Only the root row's Quote is meaningful. Writers MUST leave it empty on replies; readers MUST ignore it on replies.

**Author.** Who wrote the comment.

- An opaque, human-readable string. The recommended form is `@handle`, using the handle the person has on the team's code host or chat.
- Authorship is not verified (§12). Readers compare authors by exact string after trimming.
- An empty Author is valid and means unknown.

**Date.** When the comment was written.

- Writers MUST emit UTC in the form `YYYY-MM-DDThh:mmZ`.
- Readers MUST accept a bare date `YYYY-MM-DD`, read as midnight UTC, and `YYYY-MM-DDThh:mm` with optional `:ss` and optional fractional seconds, followed by `Z` or a numeric offset `±hh:mm`.
- Anything else is unparseable, including a time with no zone, lowercase `t` or `z`, an offset without a colon, and an impossible date.
- An empty or unparseable Date is valid and means unknown.

**Comment.** The comment text.

- GFM inline content: emphasis, code spans, links and so on. Block content (paragraphs, lists, code blocks) is not possible in a table cell.
- A line break is written `<br>`.
- May be empty on a row that only records a status change.

**Status.** A status event for the thread.

- Empty, `open` or `resolved`, compared after trimming and ignoring ASCII case.
- A thread's **state** is the last non-empty recognised Status among its rows, in row order. A thread with none is open.
- Readers MUST ignore unrecognised values when computing state, and writers MUST preserve them.

Writers MUST NOT emit a row in which both Comment and Status are empty.

### 6.5 Malformed rows

A body row without a valid Ref cell is malformed. It belongs to no thread. Writers MUST preserve malformed rows byte for byte. Viewers MAY show a warning.

### 6.6 Additional columns

Future versions may add columns after the first six. Readers MUST ignore columns they do not recognise. Writers MUST preserve those columns in existing rows and MUST emit empty cells for them in new rows.

## 7. Text projection and the Quote cell

### 7.1 Text projection

Fallback anchoring compares plain text, so every tool must derive the same plain text from the same body. The **text projection** of the body is the string produced as follows.

1. Parse the body as GFM. Skip a leading byte order mark. If the document then begins with YAML front matter (a first line of exactly `---` through the next line of exactly `---` or `...`), skip it.
2. Walk the parse tree in document order and emit:
   - the literal text of text nodes, after backslash escapes and entities are decoded
   - the content of code spans and code blocks
   - for an image, the text of its description
   - one space for each soft or hard line break
   - one space between adjacent blocks, including adjacent table cells
   - the content of footnote definitions, like any other blocks
   - nothing for raw HTML, inline or block (so anchors emit nothing)
   - nothing for footnote references, link reference definitions, thematic breaks and task-list checkboxes
3. Replace every run of whitespace with a single space, and trim both ends. Whitespace is as CommonMark defines Unicode whitespace: any character in the Unicode `Zs` category, or a tab, line feed, form feed or carriage return.

The comments table and a heading immediately before it are not part of the body and contribute nothing.

### 7.2 Building a Quote

For a thread with a valid anchor pair:

- **quote:** the text projection of the range, trimmed. If it is longer than 80 code points, it becomes its first 40 code points, then `…` (U+2026), then its last 40 code points.
- **prefix:** up to 32 code points of the projection immediately before the range, with leading whitespace trimmed.
- **suffix:** up to 32 code points of the projection immediately after the range, with trailing whitespace trimmed.

Context is taken from the projection, so it can come from a neighbouring block. Writers MAY shorten the prefix and suffix at any word boundary, for example to avoid cutting a word or to stay within the range's own block. Readers use whatever context the cell holds.

Whitespace between the context and the quote belongs to the context, so the prefix may end with a space and the suffix may begin with one.

A range can have no projected text, for example an image with no description or a thematic break. Its quote is empty, and the writer leaves the Quote cell empty.

### 7.3 Writing and reading the cell

The cell is the prefix, then the quote in strong emphasis, then the suffix:

```markdown
The **quick brown fox** jumps over the lazy dog.
```

- Writers MUST backslash-escape characters in the prefix, quote and suffix so that parsing the cell as inline Markdown yields exactly that text.
- If `**` would not parse as strong emphasis in that position (CommonMark's delimiter rules can prevent it next to punctuation), writers MUST use `<strong>…</strong>` instead.
- Readers parse the cell as inline content. The quote is the text of the first strong emphasis, whether written with `**`, `__`, `<strong>` or `<b>`. The prefix is all text before it and the suffix all text after it.
- If a non-empty cell has no strong emphasis, the whole cell text is the quote and the context is empty. This lets a person hand-write a Quote in an unaware editor.
- Readers collapse whitespace across the three parts as in §7.1 and trim the ends of the cell. Whitespace at the edges of the quote moves into the context.
- A cell with no text is empty, even if it contains markup such as `<strong></strong>`.

## 8. Resolving a thread

Every thread is in exactly one of three attachment states.

| State | Meaning |
|---|---|
| **Anchored** | The thread has exactly one location in the body. |
| **Orphaned** | The thread had a location that can no longer be found. |
| **Document-level** | The thread is about the document as a whole. |

Attachment is computed each time the document is read. It is never stored.

Readers MUST resolve each thread with this procedure:

1. **Anchors.** If the thread has a valid anchor pair (§5.5), it is anchored to that range. Stop.
2. **No quote.** If the root row's Quote is empty, the thread is document-level. Stop.
3. **Fallback.** Read the prefix, quote and suffix from the root row's Quote (§7.3), collapsing whitespace as in §7.1. Search the text projection of the body:
   - If the quote contains no `…`: find every occurrence of prefix + quote + suffix. If there is exactly one, the thread is anchored to the quote's part of that occurrence.
   - If the quote contains `…`: let the head be the text before the first `…` and the tail the text after the last `…`. Find every occurrence of prefix + head and of tail + suffix. If each occurs exactly once and the head ends at or before the tail begins, the thread is anchored from the start of the head to the end of the tail.
4. **Otherwise** the thread is orphaned.

Notes on step 3:

- A `…` in the quote always selects head and tail matching, whether a writer elided the quote or the text itself contains the character. Both cases resolve correctly.
- An empty search string never matches. A Quote with context but an empty quote, or a quote that is only `…`, is therefore orphaned.

Implementing step 3 is OPTIONAL for readers; a reader that does not implement it treats those threads as orphaned. A reader that does implement it MUST follow it exactly. Fuzzy or approximate matching is not permitted.

Consequences worth knowing:

- Anchors always win. While they exist, the Quote is only a display copy.
- A person can create an anchored comment in an unaware editor by adding a row with a new ID and the exact text as its Quote. If that text occurs once, an aware tool attaches the thread and writes the anchors.
- If deleted text is restored together with its anchors, the thread becomes anchored again with no further action.

## 9. Writer behaviour

### 9.1 General rules

- Writers MUST NOT reformat any part of the document. This includes re-wrapping lines, changing list or emphasis markers, and re-padding table columns.
- Writers MUST preserve the document's line endings and final newline.
- Writers MUST emit new table rows in compact form, with one space on each side of each cell's content and no alignment padding. An empty cell is a single space: `| |`.
- Writers MUST NOT reorder existing rows.

### 9.2 Creating a thread

1. Generate an ID (§4).
2. For an anchored thread, insert the anchor pair (§5.3, §5.4). For a document-level thread, insert nothing in the body.
3. Create the comments table if there is none (§6.2).
4. Add the root row. For an anchored thread, go through the existing threads in table order and insert the row immediately before the first row of the first anchored thread whose range starts later in the body. Threads anchored by the Quote fallback count; a range with the same start does not count as later. If there is no such thread, add the row at the end of the table. Add a document-level thread at the end of the table.

If the anchors cannot be placed (§5.3) or the table cannot be created (§6.2), the writer refuses and changes nothing.

Inserting in document order means two people commenting on different parts of a document rarely touch the same lines of the table.

### 9.3 Replying, resolving and reopening

- A reply is a new row added directly after the thread's last row, with a Ref for the same thread, written as §6.4 requires, and an empty Quote.
- To resolve a thread, add a row whose Status is `resolved`. To reopen it, add a row whose Status is `open`. The Comment may be empty or may explain the change. The Author and Date record who changed the state and when.
- Writers SHOULD NOT edit the Status of an existing row.

### 9.4 Editing and deleting

- Any comment's cells may be edited in place. This version defines no "edited" marker.
- Deleting a comment removes its row. If the root is deleted, the next row of the thread becomes the root and takes over the Quote:
  - if the thread is anchored, the writer MUST fill in the new root's Quote (§7.2)
  - otherwise the writer MUST copy the deleted root's Quote cell to the new root unchanged, so an orphaned thread keeps its last known text
- Deleting a thread's only comment deletes the thread.
- Deleting a thread removes all its rows and its anchors.

### 9.5 Purging

Purging removes whole threads in bulk: resolved threads, orphaned threads, or both.

- Writers MUST purge only on an explicit request from the user.
- Writers MUST NOT purge, or delete any thread, as a side effect of saving or of any other operation.

### 9.6 Maintenance when saving

When saving, a writer SHOULD do the following and nothing else beyond the user's own changes:

- **Refresh quotes.** For each thread with a valid anchor pair, rewrite the root row's Quote cell (§7.2) only if it has gone stale: the stored quote differs from the quote §7.2 would compute, or the stored prefix and suffix are no longer the text immediately before and after the range. A cell whose context is merely shorter or longer than this writer would choose is left alone, so two tools do not rewrite each other's cells. A writer MUST NOT replace a non-empty Quote with an empty one.
- **Repair anchors.** For each thread anchored by fallback (§8, step 3), insert its anchor pair. If the root row's Ref is a bare ID, rewrite it to the link form `[ID](#ID)`. If the anchors cannot be placed safely (§5.3), skip the thread; it stays anchored by its Quote.
- **Remove stray anchors** (§5.5).

Orphaned threads are left untouched. Their Quote keeps the last known text.

Maintenance MUST be idempotent: running it on its own output changes nothing.

## 10. Presentation guidance

This section is not normative.

- Hide the comments table, and a default `Comments` heading directly above it, from the document view. Show threads beside their ranges and highlight each range.
- Collapse or hide resolved threads by default, with a way to show them.
- Do not show orphaned threads beside the text. List them in a separate "detached" group with their Quote, so a person can read or purge them. This version defines no operation for re-attaching a thread.
- List document-level threads in a group for the document as a whole.
- Prompt for the author string once, and remember it.

## 11. What unaware tools do

This section is not normative. It records the behaviour the rules above are designed to produce.

| Action in an unaware tool | Result |
|---|---|
| Render the file | Body renders unchanged; the comments table appears at the end; Ref links jump to the commented text. |
| Edit text inside a range | Thread stays anchored. An aware tool refreshes the Quote on its next save. |
| Delete the commented text and both anchors | Thread is orphaned and stays in the table. |
| Delete the commented text but leave the anchors | Same; the empty pair is stray and is removed on the next aware save. |
| Delete one anchor | Fallback finds the text if it is unique, and the pair is rewritten. Otherwise the thread is orphaned. |
| Copy and paste a commented paragraph | The thread stays on the first copy. Duplicate anchors in the second copy are stray. |
| Strip all HTML from the file | Each thread re-attaches by its Quote where the text is unique, and is orphaned where it is not. No thread is deleted. |
| Delete a table row | That comment is deleted. If it was the thread's only row, its anchors become stray. |
| Add a row with an existing Ref | A reply. |
| Type `resolved` in a Status cell | The thread is resolved, if that is its last non-empty Status. |
| Add a row with a new ID and a Quote | A new thread, attached if the Quote text occurs exactly once. |
| Reformat the table (re-pad columns) | No effect on meaning. |
| Type an unescaped `\|` in a comment | The row gains a cell and the text is split across columns. Nothing else is affected. |

## 12. Security and privacy

- **Authorship is unverified.** Anyone who can edit the file can write any Author and Date. Where it matters, the history in a version control system is the authority.
- **Comment text is untrusted Markdown.** Viewers MUST sanitise it as they would any untrusted Markdown, including raw HTML and link destinations.
- **Author strings are visible** to everyone who can read the file. Email addresses SHOULD NOT be used as authors in public documents.

## 13. Versioning

- The format carries no version marker. A document is identified by the header row of its comments table.
- Future versions add columns (§6.6) and Status values (§6.4). Both are designed so that a reader of this version handles a later document without loss.

## Appendix A. Complete example

````markdown
# Migration plan

We will <a id="c-x7k2m9"></a>move every tenant<a id="c-x7k2m9-end"></a> to the new cluster in Q3.

<a id="c-4f9tq1"></a>

```sh
./migrate --all --window 2h
```

<a id="c-4f9tq1-end"></a>

Rollback is manual.

## Comments

| Ref | Quote | Author | Date | Comment | Status |
|---|---|---|---|---|---|
| [c-x7k2m9](#c-x7k2m9) | We will **move every tenant** to the new cluster in Q3. | @wayne | 2026-11-17T10:32Z | Including the EU tenants? | |
| [c-x7k2m9](#c-x7k2m9) | | @alex | 2026-11-17T11:02Z | Yes, added a note below. | resolved |
| [c-4f9tq1](#c-4f9tq1) | to the new cluster in Q3. **./migrate --all --window 2h** Rollback is manual. | @sam | 2026-11-17T12:40Z | Is 2h enough for the largest tenant? | |
| [c-9b2hd7](#c-9b2hd7) | **the old cluster stays read-only for a week** | @sam | 2026-11-16T09:05Z | Do we still need this? | |
| c-m3k8za | | @wayne | 2026-11-17T13:00Z | Needs an owner before we circulate it. | |
````

- `c-x7k2m9` is anchored and resolved.
- `c-4f9tq1` is anchored to a whole code block and open.
- `c-9b2hd7` is orphaned: it has a Quote but no anchors, and the quoted text is no longer in the body.
- `c-m3k8za` is document-level: it has no anchors and no Quote.

## Appendix B. Open questions

These points were decided provisionally while drafting and need review or testing.

1. **Anchors cannot sit inside link text.** HTML does not allow an `<a>` inside an `<a>`, so a range boundary inside a link snaps to the whole link (§5.3). A `<span id>` anchor would not have this limit, but it is less certain to survive HTML sanitisers.
2. **Two spellings of the quote emphasis.** `**` cannot always be used next to punctuation, so `<strong>` is a required alternative (§7.3). A single always-safe spelling would be simpler.
3. **Duplicate anchors.** The first valid pair wins (§5.5). The alternative is to treat any duplicate as invalid and fall back to the Quote.
4. **Constants.** 32 code points of context, an 80 code point quote limit and 40 + 40 elision are first guesses.
5. **Renderer behaviour is mostly untested.** GitHub's renderer has been checked by hand: it keeps anchors, an anchor at the start of a line does not affect formatting, anchor-only paragraphs render empty, and Ref links are kept. VS Code, Obsidian and other common renderers have not been checked, and none of this is yet an automated fixture suite. Renderers that disable raw HTML will show anchors as literal text.
6. **Ranges with no text.** A range over an image with no description or a thematic break has an empty Quote (§7.2). If its anchors are lost, §8 reads the thread as document-level, not orphaned. Deciding by the Ref form (a link means it once had anchors) would fix this.
7. **Bare URLs after an anchor.** GFM links a bare `www.example.com` depending on the character before it. Renderers disagree on whether an anchor directly before one stops it linking.
8. **Author handles on GitHub.** In some GitHub views `@name` becomes a link to the GitHub user of that name, who may not be the comment's author.
9. **A renamed heading above the table.** Any heading directly above the comments table is outside the body (§3), so it cannot be commented on, but viewers hide it only when its text is `Comments` (§10). A renamed heading is therefore visible and not commentable.
10. **Raw HTML and relative links in the body.** §12 covers comment text only. The reference editor shows raw HTML in the body as literal text and leaves relative links inert; the specification does not say what a viewer should do.
11. **Deferred features.** Suggested edits, reactions, mentions with notification semantics, an "edited" marker, and comments on line ranges inside code blocks.

## Appendix C. Prior art

[CriticMarkup](https://github.com/CriticMarkup/CriticMarkup-toolkit) defines inline syntax for comments and tracked changes (`{>>comment<<}`, `{==highlight==}`). It is no longer maintained. It places comment text inline, so unaware renderers show the delimiters and the comment in the middle of the prose, and it has no threads, authors, dates or resolution. This specification makes the opposite trade: the body stays clean, and the discussion is structured data at the end of the file.

The fallback anchor in §7 and §8 follows the idea of the `TextQuoteSelector` in the W3C [Web Annotation Data Model](https://www.w3.org/TR/annotation-model/), restricted to exact matching.
