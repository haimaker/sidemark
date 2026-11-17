# Editors

Standalone applications that read and write Sidemark files. Each editor has its own directory and is self-contained.

| Directory | What it is | Status |
|---|---|---|
| [`web/`](web/) | Static web app: open a local Markdown file, comment, save | In development |

Integrations that add Sidemark to an existing tool belong in [`../plugins/`](../plugins/).

## Adding an editor

1. Create `editors/<name>/` with its own `README.md` covering what it is, how to run it and how to build it.
2. Implement the specification in [`../SPEC.md`](../SPEC.md).
   - JavaScript and TypeScript editors should use [`@sidemark/core`](../packages/core/), which implements reading, resolving and every write operation. The directory is picked up as an npm workspace automatically.
   - Editors in other languages implement the spec directly and run the cases in [`../fixtures/`](../fixtures/).
3. State in the editor's README which parts of the spec it supports:
   - **Reader:** parses the comments table and resolves threads (§6 to §8). Say whether the optional quote fallback (§8, step 3) is implemented.
   - **Writer:** which operations in §9 it performs.
4. Add a row to the table above.

## What every editor must get right

- Change only the bytes an operation requires. Never reformat the body or the table (§9.1).
- Preserve rows and columns it does not understand (§6.5, §6.6).
- Delete threads only when the user asks (§9.5).
