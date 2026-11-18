# Comments that live <a id="c-m4d8qf"></a>in the Markdown file<a id="c-m4d8qf-end"></a>

CommentMark is an open format for comment threads on Markdown documents. Select text, comment on it, reply, and resolve, as you would in Google Docs. All of it is saved in the `.md` file itself.

[Open the editor](https://waynepan.github.io/commentmark/) · [Read the specification](https://github.com/waynepan/commentmark/blob/main/SPEC.md)

## Why

Teams write plans and specifications in Markdown and share them with each other and with coding agents. Markdown suits that. It is portable, it lives in the repository next to the code, and it is cheap for people and agents to read. Commenting on those files as a team was the missing part.

- **One file holds both.** The document and the discussion about it are the same file. Copy it, email it, or commit it, and the comments come along.
- **Version control tracks the discussion.** Comments and their resolutions are committed, diffed, and reviewed with the text they are about.
- **No lock-in.** There is no account, no server, and no sidecar file. You are not tied to a platform or an editor.
- **Nothing to plug in.** <a id="c-r7t2ka"></a>An agent reads the comments by reading the file<a id="c-r7t2ka-end"></a>. There are no special tools or MCP servers to connect.

## The same file, three ways

This page is a CommentMark file, and the comments on it are examples. Use the switch at the top of the page to see it three ways.

1. **Editor.** A CommentMark editor shows each thread beside the text it is about.
2. **Other tools.** A tool that has never heard of CommentMark shows <a id="c-h3w9xb"></a>a normal document, with a readable table of comments at the end<a id="c-h3w9xb-end"></a>. You can reply by adding a row, or resolve a thread by typing `resolved`.
3. **Source.** In the raw Markdown, two small anchors mark the commented text, and one table at the end of the file holds the threads.

## How it works

```markdown
The <a id="c-x7k2m9"></a>quick brown fox<a id="c-x7k2m9-end"></a> jumps over the lazy dog.

## Comments

| Ref | Quote | Author | Date | Comment | Status |
|---|---|---|---|---|---|
| [c-x7k2m9](#c-x7k2m9) | The **quick brown fox** jumps over the lazy dog. | @wayne | 2026-11-17T10:32Z | Should this be "red fox"? | |
| [c-x7k2m9](#c-x7k2m9) | | @alex | 2026-11-17T11:02Z | Agreed, changed it. | resolved |
```

- **Anchors** are a pair of empty `<a>` elements around the commented text. They render as nothing.
- **The table** holds one row for each comment. Rows that share a Ref form a thread.
- **The quote** repeats the commented text in bold, with a little context. If the anchors are lost, a tool uses the quote to find the text again, and only when it matches exactly once.
- **Status** is recorded on each row, so the file shows who resolved a thread and when.

## The editor

The reference editor runs in your browser. Open or drop a local `.md` file, select text, and comment. The contents of your file and your edits <a id="c-b6n1ze"></a>never leave your device<a id="c-b6n1ze-end"></a>.

[Open the editor](https://waynepan.github.io/commentmark/)

To try it on this page, [download this page as Markdown](commentmark.md) and open the file in the editor.

## Build on it

The specification is short, and anyone can implement it. The repository has a reference library in TypeScript and 119 conformance cases. The cases are plain files, so you can use them from any language. All of it is under the MIT licence.

[Read the specification](https://github.com/waynepan/commentmark/blob/main/SPEC.md) · [CommentMark on GitHub](https://github.com/waynepan/commentmark)

---

Version 0.1 is a draft, and the format may change. CommentMark is an independent project. It builds on CommonMark and GitHub Flavored Markdown, and it is not affiliated with either.

<!-- CommentMark: the table below holds comment threads on this document, tied to the <a id="c-..."> anchors in the text. Read https://github.com/waynepan/commentmark/blob/main/SPEC.md before editing either. -->

## Comments

| Ref | Quote | Author | Date | Comment | Status |
|---|---|---|---|---|---|
| [c-m4d8qf](#c-m4d8qf) | Comments that live **in the Markdown file** CommentMark is an open format | @sam | 2026-11-16T09:12Z | In the file itself? Not in a sidecar file or a database? | |
| [c-m4d8qf](#c-m4d8qf) | | @priya | 2026-11-16T09:20Z | In the file. Choose Source at the top of the page and scroll to the end. | |
| [c-r7t2ka](#c-r7t2ka) | an editor. Nothing to plug in. **An agent reads the comments by reading the file**. There are no special tools or | @priya | 2026-11-16T10:02Z | So there is no server for the agent to connect to? | |
| [c-r7t2ka](#c-r7t2ka) | | @agent | 2026-11-16T10:03Z | None. I read this thread by reading the file. | |
| [c-h3w9xb](#c-h3w9xb) | heard of CommentMark shows **a normal document, with a readable table of comments at the end**. You can reply by adding a row, | @tom | 2026-11-16T14:41Z | What does GitHub show for a file like this? | |
| [c-h3w9xb](#c-h3w9xb) | | @priya | 2026-11-16T15:05Z | The text as usual, then a Comments table. Choose Other tools at the top to see it. | |
| [c-h3w9xb](#c-h3w9xb) | | @tom | 2026-11-17T08:30Z | | resolved |
| [c-b6n1ze](#c-b6n1ze) | of your file and your edits **never leave your device**. Open the editor To try it on | @sam | 2026-11-17T09:48Z | Is that enforced, or only promised? | |
| [c-b6n1ze](#c-b6n1ze) | | @priya | 2026-11-17T10:15Z | Enforced by the browser. The content security policy of the editor stops the page from sending anything to a server. | |
