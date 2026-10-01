# Repository Instructions

This repository contains Doubao Sync, a desktop Obsidian plugin that copies a user's Doubao conversations into local Markdown notes.

## GitHub Workflow

- Never push directly to `main`.
- Code, workflow, documentation, release, and automation changes go through a pull request targeting `main`.
- Use branches prefixed with `codex/` unless the user requests a different name.
- After pushing a branch, create a pull request and share its URL.
- Merge only after required checks pass and the user explicitly approves the merge.
- Do not release or submit to the Obsidian Community directory without explicit authorization.

## Required Checks

Before proposing a pull request or claiming a fix is complete, run:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Run `actionlint` after changing GitHub Actions workflows.

## Data Safety

- Treat Doubao IDs as strings; never parse large IDs through JavaScript numbers.
- Only update notes containing this plugin's managed source-body markers and matching `uid`.
- Preserve user-added frontmatter fields and all content outside the managed region.
- Never delete local notes because a conversation disappeared remotely.
- Never persist, print, or transmit session cookies outside the local Doubao browser session.
- A failed conversation must not advance its checkpoint.
- Do not silently treat a malformed API response as an empty conversation.
- Add focused tests for parsing, sync behavior, and vault-write safety changes.
- Do not bump `package.json` or `manifest.json` versions unless releasing.

Release artifacts are `main.js`, `manifest.json`, and `styles.css`.
