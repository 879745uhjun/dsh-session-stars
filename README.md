# dsh-session-stars

English | [中文](README.zh.md)

Star-rating favorites with five importance levels for sessions in the DeepSeek Harness Web UI.

Rated session rows carry one small star whose color is the importance level; the row's `...` menu opens a 1-5 star picker. When the **Session Quickbar** plugin is installed it owns the row action strip, and its built-in star button toggles the rating on and off while 1-5 stays available from the menu. Ratings are stored on the Host in one JSON file, so they survive page reloads, restarts, and web-server port changes.

## Features

- **1-5 star importance** — one star is low, five stars is critical. The row's `...` menu carries an **Importance…** item that opens the picker. The **Session Quickbar** plugin owns the hover action strip and its built-in star button toggles the rating on and off; use the menu for exact levels.
- **Obvious importance levels, minimal width** — every rated row shows one small filled star whose color is the level (gray, green, blue, amber, red), so the list stays compact. The session hover card keeps the full five-star gauge plus a tinted chip with the level name.
- **A real scale in the picker** — the picker pairs five large stars with a five-step importance scale (`Low · Minor · Important · Very important · Critical`), highlights the current level, supports number keys 1-5, and confirms with a brief “Saved”.
- **Live across windows** — `/session-stars/events` streams each committed change over Server-Sent Events, so every open Web UI window updates immediately; focus refresh stays as a fallback.
- **Durable Host storage** — ratings live in `~/.dsh/session-stars.json` (or `$DSH_HOME/session-stars.json`). Writes are serialized and published atomically.
- **Agent tool** — `session_stars` lets the agent read ratings, assign stars, or clear a rating, using the same store as the UI.
- **Localized** — Simplified Chinese and English copy; other locales fall back to English.
- **Theme-native** — the picker and badges use only `--dsw-alias-*` theme tokens, so light/dark themes work.

## Install

### From GitHub

```sh
dsh plugin --profile desktop add github:879745uhjun/dsh-session-stars
```

Reload the Web UI page after installing.

### From a local checkout

This package is a DSH bundle (`dsh.bundle.patch`). Install the directory with the Plugin Manager:

1. Ask the DSH agent to install this bundle from the project directory (it calls `plugin_manager` with `action: install_bundle` and the absolute package path).
2. The bundle is linked into the active profile and its rows are applied live; reload the Web UI page if the client half does not appear immediately.

The Host row inserts as `dsh-session-stars`; the browser half is declared by `dsh.client` in `package.json`.

## Use

| Surface | Behavior |
|---|---|
| Session row `...` menu | **Importance…** opens the importance picker. |
| Session Quickbar (optional) | The quickbar's built-in star button toggles the rating on and off (0/1); exact 1-5 levels are set from the menu. |
| Picker | Five large stars plus the five-step scale; pick 1-5, press `1`-`5`, or clear the rating. `Esc` or a click outside closes it. |
| Session row trailing badge | One small star in the importance color; the title/aria-label carries `N of 5` and the level name. |
| Session hover card | Gauge plus a tinted chip with the localized level name. |
| Agent tool `session_stars` | `list` reads ratings, `set` assigns 1-5 stars, `clear` removes one. Omitting `sessionId` targets the calling session. |

Levels: 1 low, 2 minor, 3 important, 4 very important, 5 critical.

## Self-test

Open **Settings → Plugins → dsh-session-stars**; the detail page shows a **Self-test** section. It runs only when you click **Run self-test** — never on mount — and checks:

1. `GET /session-stars` returns 200 with an object `ratings`;
2. `/session-stars/events` accepts an SSE connection (marked **Skipped** when the stream is unavailable);
3. `/session-stars/health` reports the `session_stars` tool as registered.

Every check has a 2s deadline; a failure shows its reason and never blocks the other rows. **Copy result** writes a Markdown checklist from the last run.

The health endpoint is read-only:

```json
GET /session-stars/health
{ "ok": true, "tool": "session_stars", "registered": true }
```

## Data and interface

- File: `<DSH home>/session-stars.json`, format `{ "version": 1, "updatedAt": <ms>, "ratings": { "<sessionId>": { "stars": 1-5, "updatedAt": <ms> } } }`.
- Browser route: `GET /session-stars` returns the ratings, `POST /session-stars` with `{ "sessionId": "...", "stars": 0-5 }` writes one. `GET /session-stars/events` is the Server-Sent Events stream (`event: ratings`) that pushes every committed snapshot. The routes answer same-origin requests only; a cross-site `Origin` is refused.
- Ratings are keyed by session id. Deleting a session does not delete its rating; clearing it from the picker does.
- Every open window receives each committed change over the event stream; a focus/visibility refresh stays as a fallback if the stream drops.

## Compatibility

- DSH `>=0.2.2-rc.1 <0.2.3-0`, Web profile (a `webServer` service is present).
- The Host tool still works on non-web surfaces, but the star UI requires the Web UI.

## Development

```bash
npm test
```

`pretest` checks both halves with `node --check`; the test run covers the Host route/event stream/health/tool suite and a client self-test suite (registration metadata, success, single-failure isolation, timeout, Markdown shape).

## License

MIT
