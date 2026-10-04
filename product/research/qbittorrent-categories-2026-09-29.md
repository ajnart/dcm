# qBittorrent category API delta (2026-09-29)

Checked against upstream `release-5.2.3`, the catalog pin. Upstream review is
source-only; one mocked local fixture ran. No live API, Docker, browser, or
credential access. This is a delta to [Arr download-client wiring](arr-downloaders-2026-09-29.md),
not a replacement for it.

## Pinned contract

- Login is `POST /api/v2/auth/login` with URL-encoded `username` and
  `password`. In v5.2.3 success is `204 No Content`, not the mutable wiki's
  `200` example; the WebUI sets `QBT_SID_<configured-port>` (for port 8080:
  `QBT_SID_8080`). Retain and send the complete cookie pair on authenticated
  calls. Invalid credentials map to `401`, but host/CSRF validation can also
  produce 401, so check the request authority before treating it as a bad
  password. The per-app adapter accepts 200/204 and requires a QBT_SID cookie;
  still require a protected read before treating the session as usable.
  [auth controller](https://github.com/qbittorrent/qBittorrent/blob/release-5.2.3/src/webui/api/authcontroller.cpp#L40-L55),
  [cookie prefix](https://github.com/qbittorrent/qBittorrent/blob/release-5.2.3/src/webui/webapplication.cpp#L71-L72),
  [port suffix](https://github.com/qbittorrent/qBittorrent/blob/release-5.2.3/src/webui/webapplication.cpp#L434-L439),
  [pinned login status](https://github.com/qbittorrent/qBittorrent/blob/release-5.2.3/src/webui/webapplication.cpp#L339-L401),
  [cookie emission](https://github.com/qbittorrent/qBittorrent/blob/release-5.2.3/src/webui/webapplication.cpp#L681-L695),
  [authority checks](https://github.com/qbittorrent/qBittorrent/blob/release-5.2.3/src/webui/webapplication.cpp#L605-L610).
- Read categories with `GET /api/v2/torrents/categories` (no parameters):
  `200` JSON object keyed by category name. Each value includes `name` and
  `savePath`; v5.2.3 also serializes `downloadPath` (null/string/false),
  `ratio_limit`, `seeding_time_limit`, `inactive_seeding_time_limit`, and
  `share_limit_action`. Compare only the selected category's exact `name` and
  `savePath`, not harmless option fields.
  [official route/shape](https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-%28qBittorrent-5.0%29#get-all-categories),
  [pinned serialization](https://github.com/qbittorrent/qBittorrent/blob/release-5.2.3/src/webui/api/torrentscontroller.cpp#L1794-L1808),
  [category option fields](https://github.com/qbittorrent/qBittorrent/blob/release-5.2.3/src/base/bittorrent/categoryoptions.cpp#L58-L75).
- Create with URL-encoded `POST /api/v2/torrents/createCategory` (`category`,
  `savePath`); edit with `POST /api/v2/torrents/editCategory` (`category`,
  `savePath`). The wiki lists `200` for both successes, but pinned source calls
  `setResult(QString())`; v5.2.3 maps this empty result to `204 No Content`.
  Do not require 200 or parse a body for these writes. Create errors: `400`
  empty name, `409` invalid name or add failure; a duplicate name is rejected
  by `addCategory` and becomes `409`. Edit errors: `400` empty name, `404`
  missing category in WebAPI 2.15.1. The pinned changelog says an unchanged
  edit no longer errors.
  [official create/edit routes](https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-%28qBittorrent-5.0%29#add-new-category),
  [pinned actions](https://github.com/qbittorrent/qBittorrent/blob/release-5.2.3/src/webui/api/torrentscontroller.cpp#L1737-L1782),
  [response/status mapping](https://github.com/qbittorrent/qBittorrent/blob/release-5.2.3/src/webui/webapplication.cpp#L339-L401),
  [v2.15.1 change](https://github.com/qbittorrent/qBittorrent/blob/release-5.2.3/WebAPI_Changelog.md#L1-L12),
  [duplicate rejection](https://github.com/qbittorrent/qBittorrent/blob/release-5.2.3/src/base/bittorrent/sessionimpl.cpp#L982-L1003).

## Implementation delta and replay

The qBittorrent adapter checkpoints each create before sending, reads inventory
first, compares exact name/path, verifies after success, and refuses to resend
an attempted create if a later read still finds it absent. That is the right
lost-response boundary: after a timeout, reconcile with GET; exact desired
state means complete, a conflicting path means stop for owner choice, and
absent state after an attempted POST remains uncertain rather than an automatic
retry. A blind duplicate create is not successful replay: it conflicts with
409.

During this review the category-create guard was corrected to require pinned
`204`; keep the focused fixture aligned with this status and preserve exact GET
readback. Do not “repair” a same-name/different-path category automatically:
`setCategoryOptions` applies changed options to torrents already assigned there
via `handleCategoryOptionsChanged`, so path edits can affect existing torrent
placement. [category option mutation](https://github.com/qbittorrent/qBittorrent/blob/release-5.2.3/src/base/bittorrent/sessionimpl.cpp#L1005-L1036).

The pre-existing `scripts/check-bootstrap-qbittorrent.ts` fixture passed, but it exercises only mocked identity fallback and preference update; it does not establish category status, shape, or lost-response behavior. No runtime acceptance was performed.
The new `packages/cli/tests/qbittorrent-categories.test.ts` fixture covers pinned
204 responses, exact category readback, replay after a lost response, conflict
refusal, and adding Radarr after Sonarr; it is also synthetic.
