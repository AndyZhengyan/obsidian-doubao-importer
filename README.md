# Doubao Sync

[简体中文](README_zh.md)

Sync your Doubao conversations into local Obsidian Markdown notes. This first desktop-only version has an in-app login window, manual and scheduled sync, source-aware note updates, and a reviewable result notice. It uses the same naming and frontmatter style as Dedao Brain Sync.

## Install for local testing

1. Run `npm install` and `npm run build` in this repository.
2. Create `<your-vault>/.obsidian/plugins/doubao-sync/`.
3. Copy **only** `main.js`, `manifest.json`, and `styles.css` into that directory.
4. In Obsidian, enable Doubao Sync under Community plugins and reload the app.
5. Open Settings → Doubao Sync → Log in to Doubao. Complete the normal login in the opened window, close it, then click Sync.

The plugin stores the web session in Electron's persistent local partition. It does not copy Cookie values into plugin settings or log them.

## Current behavior

- Syncs the most recent conversations returned by Doubao's web conversation endpoint, up to 200 per run.
- Paginates each conversation's history. A conversation that exceeds 100 message pages is skipped rather than written incompletely.
- Saves one Markdown note per conversation under `豆包/对话` by default.
- Updates notes by their `uid`, even if moved or renamed. It preserves frontmatter fields outside plugin ownership and text outside the source-body markers.
- Skips conversations whose remote update time matches the last successful checkpoint. A failed conversation keeps its previous checkpoint.
- Keeps local notes when a remote conversation disappears.
- Leaves image and file URLs in the note when the web payload supplies them; it does not download media yet.
- Shows a warning when the returned conversation list reaches the 200-item limit. A shorter list does not prove complete account coverage.

Doubao's web endpoints are private and can change. This release has not yet been verified against the owner's logged-in account. If the API format changes, sync stops with a visible error instead of treating the response as empty.

## Note format

The core fields follow the same convention as Dedao Brain Sync: `uid`, `title`, `created`, `modified`, `source`, and `tags`. Doubao-specific protocol fields use `doubao_`. `created` and `modified` appear only when the source provides valid times. The source body is delimited by `<!-- doubao-sync:source-body:start -->` and `<!-- doubao-sync:source-body:end -->`.

## Development

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

See [the evolution plan](docs/EVOLUTION.md) for the next milestones.
