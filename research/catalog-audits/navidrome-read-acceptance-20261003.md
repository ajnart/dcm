# Navidrome existing-track byte acceptance: gap; metadata staged

Pinned `deluan/navidrome:0.64.0` supports safe header-authenticated native song
metadata, but its native API has no original-song stream/download route.
The app-owned `acceptance.ts` stages approved authentication and selected-track
metadata across trusted restart evidence. It deliberately has **no
acceptance-contract.json**, so production dispatch remains unavailable and no
metadata result maps to core-round-trip. Source and synthetic checks earn
**zero live compatibility points**. No Docker, browser, private runtime,
credential store or live evidence receipt was accessed or mutated.

## Protected authentication and metadata

Pinned [server/auth.go](https://github.com/navidrome/navidrome/blob/v0.64.0/server/auth.go)
defines password-authenticated `POST /auth/login`, returning JWT and admin
identity. It reads `Bearer` from `X-ND-Authorization`, the exact header defined
in [consts.go](https://github.com/navidrome/navidrome/blob/v0.64.0/consts/consts.go).
Generic `Authorization: Bearer` is not interchangeable. The staged observer
reads the generated saved password, uses the common factory's exact declared
`navidrome-acceptance-login` step approval, validates admin identity and bounded
ID/JWT, and keeps JWT only in private request memory. No account/key is created,
token persisted, configuration changed, or secret submitted in a URL or shell.
Login updates upstream last-login housekeeping; it is not a zero-effect API.

Pinned [native_api.go](https://github.com/navidrome/navidrome/blob/v0.64.0/server/nativeapi/native_api.go)
registers authenticated `GET /api/song/{id}` but no song original-file/download/
stream endpoint. The observer checks one reviewed opaque `track-id`,
`missing=false`, positive size up to 1 MiB, and bounded numeric audio metadata.
[mediafile.go](https://github.com/navidrome/navidrome/blob/v0.64.0/model/mediafile.go)
defines its JSON fields, including fractional duration. Only opaque identity,
size and hashes of allowlisted fields enter checkpoints; no title/path/token/
cookie/filename/media bytes. The common factory binds input, CAS and exact
shared owner/image/start lineage. Matching metadata after trusted restart proves
**metadata persistence only**, never original-byte delivery or client playback.

## Remaining original-byte boundary

The [official Subsonic API](https://www.subsonic.org/pages/api.jsp) uses password
or salted password-derived token request parameters. Pinned
[Subsonic middleware](https://github.com/navidrome/navidrome/blob/v0.64.0/server/subsonic/middlewares.go)
reads `p`, `t`, `s`, and `jwt` through query `req.Params(r)`. Its internal/proxy
branches are separate trust mechanisms, not native JWT-header authentication.
[server/auth.go](https://github.com/navidrome/navidrome/blob/v0.64.0/server/auth.go)
shows `InternalAuth` reads an explicitly injected internal-auth context, not
the native JWT. The pinned
[UI Subsonic client](https://github.com/navidrome/navidrome/blob/v0.64.0/ui/src/subsonic/index.js)
constructs media URLs with username/token/salt parameters. POST form support
converts forms to URL parameters internally; it is not a native header-auth
original-media endpoint.

The [ordinary HTTP transport](../../packages/cli/src/control-panel/setup-transport.ts)
permits non-secret query values only. Short `p`/`t` names would bypass its
lexical denylist but still violate its contract. Enabling external auth,
impersonating internal auth, or leaking credential-bearing URLs is not allowed.
No workaround is installed. Approved login POST alone does not resolve this.

Pinned [stream.go](https://github.com/navidrome/navidrome/blob/v0.64.0/server/subsonic/stream.go)
supports selected media-file download using explicit `format=raw` and enabled
downloads. Other IDs can produce archives, so authenticated song identity/type/
size must precede a future byte request. The route also runs `getPlayer`, which
registers upstream housekeeping and returns a cookie. Future protected Subsonic
auth handling requires a separately reviewed credential/housekeeping boundary.

Future active input schema: `{ "key": "track-id", "format": "opaque-id",
"maximumLength": 128 }`. Read one authorized existing original track of at
most 1 MiB, or a separately source-verified documented range segment. Compare
exact original byte size/hash, selected metadata/configuration and trusted
scoped `navidrome` restart lineage. Reject HTTP-200 error/auth documents and
changed/denied/oversized bytes. No transcoding, external fetch, library download,
media writes or client-playback claim. Until safe authenticated original-byte
delivery exists, do not add a production result contract.

Context7 resolved `/navidrome/navidrome`; master snippets located files, while
behavioral conclusions were verified against exact v0.64.0 source.

## Focused validation

The named `packages/cli/tests/navidrome-read-acceptance.test.ts` passes approved
auth denial, non-admin rejection, exact native JWT header/route, fractional
duration, changed-metadata restart rejection, sanitized checkpoints/results,
false media/playback flags and absent contract/production subject/availability.
Only that fixture, its Bun build and the staged adapter build were run. These
synthetic checks are not live Navidrome authentication or restart acceptance.
