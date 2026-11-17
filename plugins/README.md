# Plugins

Integrations that add Sidemark support to an existing tool, such as a code editor extension, a note-taking app plugin or a Markdown renderer plugin. Each plugin has its own directory and is self-contained.

There are no plugins yet.

Standalone applications belong in [`../editors/`](../editors/).

## Adding a plugin

1. Create `plugins/<host>-<name>/`, for example `plugins/vscode-sidemark/`, with its own `README.md` covering what it does, how to install it and how to build it.
2. Implement the specification in [`../SPEC.md`](../SPEC.md).
   - JavaScript and TypeScript plugins should use [`@sidemark/core`](../packages/core/). To be picked up as an npm workspace, add `plugins/*` to `workspaces` in the root `package.json`.
   - Plugins in other languages implement the spec directly and run the cases in [`../fixtures/`](../fixtures/).
3. State in the plugin's README which parts of the spec it supports, as described in [`../editors/README.md`](../editors/README.md).
4. List the plugin in this file.
