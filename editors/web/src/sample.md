# Welcome to CommentMark

CommentMark keeps Google Docs style comment threads <a id="c-intro1"></a>inside the Markdown file itself<a id="c-intro1-end"></a>. There is no server and no sidecar file: the comments live in a table at the end of the document, and invisible anchors mark the text they refer to.

This page is a working editor. **Select any text** and a comment box appears beside it. Files are read and saved in your browser; <a id="c-done66"></a>nothing is uploaded<a id="c-done66-end"></a>.

## Try it

1. Select a phrase on this page and add a comment.
2. Reply to a thread, resolve it, then press Undo.
3. Switch to *Source* to see exactly what CommentMark writes into the file.
4. Open one of your own Markdown files, or drop it onto the page.

## What this sample shows

Threads can overlap: this sentence has <a id="c-ovl1a2"></a>two comments that <a id="c-ovl2b3"></a>share<a id="c-ovl1a2-end"></a> some of the same words<a id="c-ovl2b3-end"></a>.

A comment can also span more than one block. This one <a id="c-span44"></a>starts here,

and ends in the next paragraph<a id="c-span44-end"></a>.

Code blocks are commented on as a whole:

<a id="c-code55"></a>

```js
const doc = parse(source)
console.log(doc.threads.length)
```

<a id="c-code55-end"></a>

One thread on this page is resolved and hidden until you choose *Show resolved*. Another is detached: the text it was about has been deleted, so it is listed under *Detached* with its last known quote. A third is about the document as a whole.

## Comments

| Ref | Quote | Author | Date | Comment | Status |
|---|---|---|---|---|---|
| [c-intro1](#c-intro1) | Docs style comment threads **inside the Markdown file itself**. There is no server and no | @ada | 2026-11-16T09:12Z | This is the whole idea: the file is the record. | |
| [c-intro1](#c-intro1) | | @lin | 2026-11-16T09:40Z | And a tool that has never heard of CommentMark still shows a readable table at the end. | |
| [c-done66](#c-done66) | read and saved in your browser; **nothing is uploaded**. Try it Select a phrase on this | @lin | 2026-11-16T10:02Z | Is that true for drag and drop too? | |
| [c-done66](#c-done66) | | @ada | 2026-11-16T10:05Z | Yes. Dropped files are read locally, like opened ones. | |
| [c-done66](#c-done66) | | @lin | 2026-11-16T10:06Z | | resolved |
| [c-ovl1a2](#c-ovl1a2) | can overlap: this sentence has **two comments that share** some of the same words. A | @lin | 2026-11-16T11:20Z | First of two overlapping comments. | |
| [c-ovl2b3](#c-ovl2b3) | sentence has two comments that **share some of the same words**. A comment can also span more | @ada | 2026-11-16T11:24Z | The second one. Where they overlap the highlight is darker. | |
| [c-span44](#c-span44) | more than one block. This one **starts here, and ends in the next paragraph**. Code blocks are commented on | @lin | 2026-11-16T11:30Z | This range crosses a paragraph break. | |
| [c-code55](#c-code55) | are commented on as a whole: **const doc = parse(source) console.log(doc.threads.length)** One thread on this page is | @ada | 2026-11-16T11:41Z | A comment on code covers the whole block. Anchors go in paragraphs of their own, just before and after it. | |
| [c-gone77](#c-gone77) | Readers should know that **the old storage format** is described in an appendix. | @ada | 2026-11-15T16:00Z | Do we still need to mention this? | |
| c-doc888 | | @lin | 2026-11-16T12:00Z | Feedback on the sample as a whole goes in a document-level thread like this one. | |
