# Doubao Sync

[简体中文](README_zh.md)

Sync your Doubao conversations into local Obsidian Markdown notes. This desktop plugin includes local login, manual/scheduled sync, live message-page progress, cancellation, and 30-day per-conversation history. Its settings components and interaction patterns are adapted from Dedao Brain Sync; see [reuse boundaries](docs/REUSE.md).

## Install for local testing

1. Run `npm install` and `npm run build` in this repository.
2. Create `<your-vault>/.obsidian/plugins/doubao-sync/`.
3. Copy **only** `main.js`, `manifest.json`, and `styles.css` into that directory.
4. In Obsidian, enable Doubao Sync under Community plugins. For an update, disable and re-enable only this plugin; a full app reload is unnecessary.
5. Open Settings → Doubao Sync → credentials (更改凭证) → web login (网页登录). Complete the normal login; the window closes after server verification and the status shows authentication success (认证成功).
6. Choose the target folder (目标文件夹), then use manual sync (手动同步 → 同步对话). New installations start in manual mode; enable automatic sync only when wanted. The UI currently uses Simplified Chinese.

The plugin stores the web session in Electron's persistent local partition. It does not copy Cookie values into plugin settings or log them.

## Current behavior

- Manual sync opens a time-range dialog and follows the conversation-list cursor. It filters by last update, falls back to creation time, and retains undated conversations. Matching conversations are imported in full.
- Automatic sync requests up to 200 recent conversations per run.
- Paginates each conversation's history. A conversation that exceeds 1000 message pages or returns a repeated page is skipped rather than written incompletely.
- Saves one Markdown note per conversation under `豆包/对话` by default.
- Updates notes by their `uid`, even if moved or renamed. It preserves frontmatter fields outside plugin ownership and text outside the source-body markers.
- Checks both the remote update time and a fingerprint of the latest message page before skipping an unchanged conversation. Upgrading an older installation safely re-reads each discovered conversation once to initialize these fingerprints.
- Cancellation and authentication failures preserve completed outcomes/checkpoints. Incomplete conversations are not written. Unloading cancels outstanding requests and closes hidden windows.
- History keeps 30 days of timestamps, source, duration, counts, and per-conversation results, without storing message bodies or credentials.
- Keeps local notes when a remote conversation disappears.
- Leaves image and file URLs in the note when the web payload supplies them; it does not download media yet.
- Shows a warning when the returned conversation list reaches the 200-item limit. A shorter list does not prove complete account coverage.

Doubao's web endpoints are private and can change. On 2026-10-13, local acceptance on Obsidian 1.13.7 saved the 49 conversations returned by the owner's account, totaling 16,595 messages. This does not establish full account-history coverage. See [local acceptance](docs/LOCAL_ACCEPTANCE.md). If the API format changes, sync stops with a visible error instead of treating the response as empty.

## Note format

The core fields follow the same convention as Dedao Brain Sync: `uid`, `title`, `created`, `modified`, `source`, and `tags`. Existing Doubao fields are `conversation_type`, `source_url`, `message_count`, `doubao_sync_schema`, and `doubao_source_hash`; these names remain unchanged. `created` and `modified` appear only when the source provides valid times. The source body is delimited by `<!-- doubao-sync:source-body:start -->` and `<!-- doubao-sync:source-body:end -->`.

## Settings and feedback

Settings reuse Dedao Brain Sync's status bar, collapsible credentials/sync/advanced sections, scheduling summary and manual-action grouping. New installs default to automatic sync off, a 30-minute interval, and sync on start enabled only when scheduling is enabled. Upgrades preserve saved schedules; custom integer intervals from 5 to 1440 minutes are supported.

Progress reports completed conversations rather than pretending message-page counts are a percentage. History uses the same result cards, write-result rows, failed/skipped groups, and five-runs-per-page layout. It never stores message bodies. Automatic unchanged runs are silent; changes show a gentle notice, while failures, expired login and list limits are visible with consecutive identical issues deduplicated.

Existing command IDs are unchanged: sync, login, cancel and history remain available in the command palette. The ribbon uses the same sync action. See [the Chinese usage guide](README_zh.md) for exact UI labels.

## Development

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

See [the evolution plan](docs/EVOLUTION.md) for the next milestones.
