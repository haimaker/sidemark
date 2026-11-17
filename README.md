# Sidemark

Sidemark is an open convention for keeping comment threads inside a Markdown file. You select text, comment on it, reply and resolve, as you would in Google Docs, and all of it is saved in the `.md` file itself.

```markdown
The <a id="c-x7k2m9"></a>quick brown fox<a id="c-x7k2m9-end"></a> jumps over the lazy dog.

## Comments

| Ref | Quote | Author | Date | Comment | Status |
|---|---|---|---|---|---|
| [c-x7k2m9](#c-x7k2m9) | The **quick brown fox** jumps over the lazy dog. | @wayne | 2026-11-17T10:32Z | Should this be "red fox"? | |
| [c-x7k2m9](#c-x7k2m9) | | @alex | 2026-11-17T11:02Z | Agreed, changed it. | resolved |
```

A Sidemark editor hides the table and shows each thread beside the text it refers to. Any other Markdown tool shows the document as normal, with a readable comments table at the end.

**Status:** version 0.1 is a draft. The format may change, and its behaviour in common renderers has not yet been tested systematically.

## Why

Markdown has become the default format for the documents teams keep: specs, plans, runbooks, and the files AI tools read and write. It has no shared way to discuss a document. Review ends up in pull request threads, chat, or a copy pasted into a document editor, and the discussion is separated from the file it is about.

The closest earlier attempt, [CriticMarkup](https://github.com/CriticMarkup/CriticMarkup-toolkit), is no longer maintained. It writes comments inline, so tools that do not support it show the markup in the middle of the prose, and it has no threads, authors or resolution.

## Goals

- **The file is the whole record.** Comments live in the Markdown file, with no sidecar file, database or server. The file stays portable: copy it, email it or commit it, and the comments come along.
- **Tools that do not know Sidemark still work.** The body renders cleanly everywhere. The comments are an ordinary table, so a person in any editor can read them, reply by adding a row, resolve by typing `resolved`, or delete a comment by deleting its row.
- **Works well with git, without requiring it.** One comment is one line, IDs are random so branches do not collide, and new threads are inserted in document order so parallel edits rarely conflict. Comments can be reviewed, committed and resolved like any other change.
- **Never guess, never destroy.** A comment attaches to exactly one place or is shown as detached. Tools keep anything they do not understand and delete comments only when asked.
- **Anyone can implement it.** The specification is short, and the conformance fixtures are plain files usable from any language.

## Not in version 0.1

- Suggested edits (tracked changes)
- Real-time collaboration
- Verified identity: authors are plain text, and version control history is the authority on who wrote what
- Comments on individual lines inside a code block

## How it works

1. **Anchors** mark the commented range in the body: a pair of empty `<a>` elements that render as nothing.
2. **The comments table** at the end of the file holds one row per comment. Rows that share a Ref form a thread.
3. **The Quote cell** shows the commented text in bold with a little surrounding context. If the anchors are ever lost, a tool uses it to find the text again, and only if it matches exactly once.
4. **Status** is recorded per row, so the table shows who resolved or reopened a thread and when.

Read the full rules in [SPEC.md](SPEC.md).

## Repository layout

```
SPEC.md           The specification
fixtures/         Conformance cases, usable by an implementation in any language
packages/
  core/           @sidemark/core, the reference library (TypeScript)
editors/          Standalone editors and viewers, one directory each
  web/            Static web app: open a file, comment, save
plugins/          Integrations for existing tools, one directory each
```

To add an editor or a plugin, see [editors/README.md](editors/README.md) and [plugins/README.md](plugins/README.md).

## Development

Requires Node 20 or later.

```sh
npm install
npm run build
npm test
```

## Contributing

The specification is a draft and the open questions are listed in [Appendix B of the spec](SPEC.md#appendix-b-open-questions). Issues that report how a particular renderer or editor treats a Sidemark file are especially useful.

## License

[MIT](LICENSE)
