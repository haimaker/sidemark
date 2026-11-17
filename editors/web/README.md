# Sidemark web editor

The reference editor for [Sidemark](../../SPEC.md): a static web app that opens a local Markdown file, shows it rendered with its comment threads in the margin, lets you comment, reply, resolve and delete, and saves the file. Everything runs in the browser. Nothing is uploaded.

It is also meant to be read. All Sidemark logic comes from [`@sidemark/core`](../../packages/core/); this app only renders, maps the selection to source offsets, and keeps an undo history of source strings.

## Run it

From the repository root:

```sh
npm install
npm run build --workspace @sidemark/core   # the editor imports core's built output
cd editors/web
npm run dev        # development server
npm run build      # static site in dist/ (relative paths: host it under any path)
npm run preview    # serve dist/
npm test           # unit tests (vitest + jsdom)
npm run test:e2e   # browser smoke tests against dist/ (Playwright; run `npx playwright install chromium` once)
```

## Spec support

- **Reader:** full (§5 to §8), through `@sidemark/core`, including the optional Quote fallback (§8 step 3). Threads found through their Quote are highlighted, and get their anchors back on the next save.
- **Writer:** every operation in §9: create (anchored and document-level), reply, resolve, reopen (with an optional note), edit, delete a comment, delete a thread, purge (resolved and/or orphaned, on explicit request), and maintenance on save (§9.6).
- **Presentation (§10):** the comments table and a default `Comments` heading are hidden; threads sit beside their ranges; resolved threads are hidden until you ask; orphaned threads are listed under *Detached* with their quote; document-level threads have their own group; the author is asked for once and remembered.
- **Security (§12):** raw HTML in the body and in comments is shown as text, never rendered (`<br>` in comments is a line break). Links become links only for `http:`, `https:`, `mailto:` and `#fragment`; images load only from `http(s)` URLs, without a referrer. Nothing is assigned to `innerHTML`, and the page ships a restrictive Content Security Policy.

Not supported: editing the body text, and re-attaching a detached thread to new text (the spec mentions it in §10 but defines no operation).

## How it works

**One source string is the whole state.** Every action calls a pure core operation (`createThread`, `addReply`, `setStatus`, `editComment`, `deleteComment`, `deleteThread`, `purge`, `maintain`), gets a new string, and the view re-parses it. Undo and redo move through a list of strings.

**The body is rendered from core's mdast**, not by a second Markdown renderer. While rendering, every DOM text node is registered with the mdast `text` / `inlineCode` / `code` node and the slice of its value it shows. A selection boundary `(container, offset)` then becomes a source offset through `doc.sourceMap.toSource(node, offset)`, and core's `createThread` snaps the range to a safe placement. Boundaries between blocks or on decoration snap inwards to the nearest registered text. Highlights go the other way: a character is highlighted when its whole source span lies inside a thread's range.

| File | |
|---|---|
| `src/body/dom-map.ts` | DOM ↔ source mapping (`BodyIndex`). The part worth reading first. |
| `src/body/render.ts` | mdast → DOM for the body (registering text with the index, splitting text into highlight marks) and for Comment cells. |
| `src/body/sanitize.ts` | URL policy for links and images. |
| `src/model/history.ts` | Undo/redo over source strings, and the saved marker. |
| `src/model/groups.ts` | Grouping threads for display (§10), purge counts, which nodes to hide. |
| `src/model/layout.ts` | Margin layout: cards beside their ranges without overlapping. |
| `src/model/author.ts`, `errors.ts` | Remembered author; messages for core's refusals. |
| `src/files.ts` | Open (File System Access API, file input, drag and drop) and save (in place, or download). |
| `src/app.tsx` | State and actions. |
| `src/components/` | Preact components: toolbar, document view, margin, thread cards, dialogs, source view. |
| `src/sample.md` | The sample document shown on first load. |
| `test/` | Unit tests: mapping, rendering and sanitising, model. |
| `e2e/` | Playwright smoke tests against the production build. |

## Using it

- **Comment:** select text and press *Comment* (or Ctrl+Alt+M / ⌘⌥M). *Comment on the document* adds a document-level thread.
- **Threads:** click a highlight to focus its thread, or a thread to highlight its text. Overlapping highlights cycle on repeated clicks. Ctrl+Enter / ⌘↩ submits a comment or reply.
- **Save:** Ctrl+S / ⌘S. A file opened through the system file picker (or dropped, in Chromium) is written back in place, after checking it has not changed on disk. Otherwise the file is downloaded. Saving runs core's `maintain`, which may refresh Quote cells, repair anchors and remove stray anchors; those changes can be undone like any other.
- **Undo / redo:** Ctrl+Z / ⌘Z and Ctrl+Shift+Z / ⌘⇧Z outside text fields.
- **Source:** shows the raw Markdown, with anchors and the comments table marked.
