# Generation 7 — independent browser baseline and Homarr survivor

Status: **one full Homarr UI survivor; script-first live test awaits the user's GO.**

## Scope and evidence

Three isolated GPT-6 Luna MAX agents used the standalone installed skill in
`/home/habs/.selfhostedskills`, not this source checkout. Each had its own run
ID, Compose project, ports, browser session, and private artifacts. `g7coreb`
intentionally skipped Homarr onboarding; `g7fulla` and `g7fullc` attempted the
full seven-service dashboard. No run selected an indexer, requested media,
searched a downloader, started a download, installed an MCP client, or tore
down another run. All stacks were preserved.

The private browser logger recorded command categories/timings and sanitized
HTTP method, route template, status, and resource type. It captured no request
bodies, headers, cookies, query values, passwords, or API-key values. Its
request capture polls after browser commands and has three or four gaps per
run, so it is **not** a complete HAR or proof of every call. The private logs
are outside the repo. The source-only script-first calls and expected proofs
are in [`docs/headless-setup.md`](../docs/headless-setup.md); none of the new
`setup-*.ts` paths was live-tested in this generation.

| Run | Scope and outcome | Browser CLI invocations | Nonzero | Browser observation window | Sanitized unique requests / gaps |
| --- | --- | ---: | ---: | ---: | ---: |
| `g7coreb` | Six configured services pass; Homarr intentionally uninitialized; no indexer | 570 | 6 | 105 min | 1,767 / 4 |
| `g7fulla` | Six Homarr links, generated board, seven widgets, API/MCP pass; no indexer | 820 | 10 | 139 min | 3,453 / 3 |
| `g7fullc` | Six connection tests seen, but reopening qBittorrent reset its card; no Review or board; Seerr search kept off after safety rejection | 749 | 10 | 129 min | 2,779 / 4 |

These are **run-tagged browser CLI invocations**, including helper-invoked
browser calls. They are not model turns or meaningful UI actions. The
observation window is first-to-last recorded browser command, not exact task
runtime. Exact model turn and token counters, per-service command counts, and
complete request sequences were unavailable; no estimates are substituted.

### Observed request families converted to per-service scripts

The sanitized `g7fulla` trace confirms these method/route families. Counts
include retries and background refreshes, so this is a coverage map rather
than a literal replay order or a claim that the new scripts ran live. The
script call order and exact payloads were checked against the owning service
implementations and are documented in `docs/headless-setup.md`.

| Observed browser calls (selected) | Script that now owns the call family |
| --- | --- |
| `POST /api/v2/auth/login`, `POST /api/v2/app/setPreferences` | `setup-qbittorrent.ts` |
| `GET /api/v3/config/host`, `GET /api/v3/downloadclient/schema`, `POST /api/v3/downloadclient/test`, `POST /api/v3/downloadclient` | `setup-sonarr.ts`, `setup-radarr.ts` (same Arr API family) |
| `GET /api/v1/applications/schema`, `POST /api/v1/applications/test`, `POST /api/v1/applications` | `setup-prowlarr.ts` |
| `GET /System/Info/Public`, `POST /Library/VirtualFolders` | `setup-jellyfin.ts` |
| `POST /api/v1/auth/jellyfin`, `POST /api/v1/settings/initialize`, `POST /api/v1/settings/radarr`, `POST /api/v1/settings/sonarr` | `setup-seerr.ts` |
| `POST /api/onboarding/claim`, `POST /api/trpc/onboard.testIntegration` (six observed), `POST /api/trpc/onboard.completeSetup`, `POST /api/trpc/apiKeys.create` | `setup-homarr.ts` |

Some browser requests were redacted to `/api/v3/:value` or similar route
templates and cannot be attributed from this log alone. The scripts use the
run-scoped private curl transport with one persistent cookie jar per loopback
origin; the trace deliberately stores no cookie values. Cookie reuse and the
full headless recipe still require the separately approved live test.

## Winner: `g7fulla`

The saved Seerr configuration, qBittorrent login/categories, Sonarr/Radarr
authentication, roots, downloader links, and Jellyfin libraries passed the
run-scoped verifier. Prowlarr's Sonarr/Radarr Full Sync application records
were tested and saved. Its enabled-indexer row and the resulting Sonarr/Radarr
indexer edges remain pending because no source was authorized.

Homarr Review counted **6 integrations and 6 app tiles** before Build. After
Build and reload, the `dashboard` board showed the generated apps/widgets.
The finalizer verified all six saved app/integration links. Seven fixed
read-only widget GETs passed. A management-page API key was captured directly
into the private run store; `connections-check`, native and stdio MCP checks,
and the read-only title-search probe passed. The MCP client fragment was not
installed. A screenshot alone was not used to claim integration or widget
success.

Secret-free visual evidence, inspected by the candidate:

- `/home/habs/.selfhostedskills/.selfhost/media-harness/.sessions/g7fulla/artifacts/homarr-onboarding-review.png`
- `/home/habs/.selfhostedskills/.selfhost/media-harness/.sessions/g7fulla/artifacts/homarr-finished-board.png`

The requested **secrets-full**, owner-only credential export is
`/home/habs/.selfhostedskills/.selfhost/media-harness/.sessions/g7fulla/artifacts/private-handoff.json`.
It contains the generated password, service usernames, available API keys,
URLs, and storage paths. The separate report is redacted; neither its existence
nor the private export is an acceptance check. From the installed harness,
`scripts/session.sh up g7fulla` starts/reconciles this run after a host restart.

## Non-survivors and prompt reductions

`g7coreb` proved the skip-Homarr variant and produced a private handoff. It is
not a seven-service dashboard result. Its qBittorrent download path was not
independently verified. The handoff lists planned Homarr login values, but
Homarr was never initialized in that run; those are **not** working Homarr
credentials.

`g7fullc` completed only four of eight grouped verifier rows. Its Seerr Radarr
automatic-search flag stayed off after a safety review rejected that future
behavior. Six Homarr connection tests appeared during an uninterrupted Connect
pass, but reopening the tested qBittorrent credential card displayed `Needs
configuration`; the candidate stopped without Review or Build. Its secret-free
failure screenshot is
`/home/habs/.selfhostedskills/.selfhost/media-harness/.sessions/g7fullc/artifacts/homarr-qbittorrent-reset.png`.

Findings promoted into focused prompt/helpers, not a monolithic runbook:

- Seerr's Jellyfin sign-in requires an email field. The benchmark's
  `admin@example.test` is nondeliverable and not tied to Jellyfin; users who
  need notices or recovery must choose a real address.
- Seerr Sonarr needs **both** standard and anime `Any` profiles and both
  `/data/media/tv` roots, plus Season Folders. `Enable Scan` synchronizes
  existing media/request status; future automatic search is a separate choice.
- Validate managed Arr/Seerr keys before Homarr `/init`. Navigating away from
  unsaved Connect forms reset prior tests in one candidate. Fill from managed
  state without revisiting source apps.
- Select qBittorrent's **Username + Password** mode; its default API-key mode
  is wrong. Do not reopen a tested card merely to inspect it. Review's six/six
  counts and post-Build reads are the persistence checkpoints.
- Homarr's `/manage/tools/api` Authentication tab reveals a one-time readonly
  `API token created` field, not the old `/init` MCP code or a generic API-key
  textbox. The strict private `capture-code` helper now accepts both exact
  layouts. It was focused-fixture tested and then passed in `g7fulla` without
  putting the value in argv, stdout, screenshots, or client config.

## Subjective scorecard (out of 100)

| Comparable scope | Setup quality | Ease | Basis |
| --- | ---: | ---: | --- |
| Then: Generation 5 promoted full UI stack | 90 | 50 | Full board and browser acceptance; about 100 *meaningful actions*, not CLI calls. |
| Then: Generation 6 installed full UI attempts | 35 | 20 | No full Homarr survivor; strongest attempt stopped before board. |
| Now: `g7fulla` full UI | 92 | 28 | Full Homarr/Seerr/MCP/widget proof, but 820 browser CLI calls and 139-minute observation window. |
| Now: `g7fullc` full UI | 43 | 16 | Six transient connection tests but no Review/board, plus Seerr policy gap. |
| Now: `g7coreb` skip-Homarr variant | 82 | 36 | Six-service graph largely verified; much longer 570-call UI path, no dashboard. |
| Next: packaged script-first path | unscored | unscored | Static/package/fixture gates passed; live setup deliberately withheld pending GO. |

These scores are reviewer judgments, not measurements or a claim that Gen 5's
meaningful actions equal Gen 7's browser CLI invocations. Full-Homarr quality
recovered relative to Generation 6; the browser-only method is still too
laborious to claim an ease improvement. The script-first method remains a
hypothesis until a separately authorized isolated live run passes the same
acceptance gates.

## Next gate

Await explicit **GO** before live-testing the new headless script-first flow.
On that run, record per-service script time, failed stage and bounded browser
fallback count, preserved private takeover paths, full saved-state acceptance,
and model turns/tokens only if exposed by the platform. Compare full Homarr to
full Homarr; keep skip-Homarr results separate. Do not add an indexer or enable
future searches after a rejected review without an explicit user choice.

Sources for the behavioral distinctions:
[Seerr media-server settings](https://docs.seerr.dev/using-seerr/settings/mediaserver/),
[Seerr service settings](https://docs.seerr.dev/using-seerr/settings/services/),
[Homarr integration management](https://homarr.dev/docs/management/integrations/),
[qBittorrent integration](https://homarr.dev/docs/1.33.0/integrations/q-bittorent/),
and [Homarr API](https://homarr.dev/docs/management/api/).
