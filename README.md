# dsh-session-stars

English | [中文](README.zh.md)

Star-rating favorites with five importance levels for sessions in the DeepSeek Harness Web UI.

The workspace sidebar gets a star control on every session row: rate a session from 1 to 5 stars, and the rating is shown as an always-visible importance badge. Ratings are stored on the Host in one JSON file, so they survive page reloads, restarts, and web-server port changes.

## Features

- **1-5 star importance** — one star is low, five stars is critical. Hovering a session row reveals a star button; clicking it opens a compact picker anchored to the row.
- **Readable importance at a glance** — the row shows `★ N` next to its time label, colored by level (muted for 1-2, accent for 3, amber for 4, red for 5). The session hover card shows the full star row with the localized level name.
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
| Session row hover actions | Click the star button to open the importance picker. |
| Picker | Pick 1-5 stars, or clear the rating. `Esc` or a click outside closes it. |
| Session row trailing badge | `★ N` in the importance color while the session is rated. |
| Session hover card | Full star row plus the localized level name. |
| Agent tool `session_stars` | `list` reads ratings, `set` assigns 1-5 stars, `clear` removes one. Omitting `sessionId` targets the calling session. |

Levels: 1 low, 2 minor, 3 important, 4 very important, 5 critical.

## Data and interface

- File: `<DSH home>/session-stars.json`, format `{ "version": 1, "updatedAt": <ms>, "ratings": { "<sessionId>": { "stars": 1-5, "updatedAt": <ms> } } }`.
- Browser route: `GET /session-stars` returns the ratings, `POST /session-stars` with `{ "sessionId": "...", "stars": 0-5 }` writes one. The route answers same-origin requests; a cross-site `Origin` is refused.
- Ratings are keyed by session id. Deleting a session does not delete its rating; clearing it from the picker does.
- Changes appear immediately in the window that made them. Other open windows refresh on focus or visibility change; there is no live push channel.

## Compatibility

- DSH `>=0.2.2-rc.1 <0.2.3-0`, Web profile (a `webServer` service is present).
- The Host tool still works on non-web surfaces, but the star UI requires the Web UI.

## Development

```bash
node --check client.js
node test/host.test.mjs
```

The Host test covers the ratings store, the JSON route (including validation and the cross-origin fence), the agent tool, and persistence across remounts.

## License

MIT
