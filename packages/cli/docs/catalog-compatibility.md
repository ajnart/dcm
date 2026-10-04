# Catalog compatibility

Compatibility answers **what passed on the exact recipe and images**, not how
many manifests or adapters exist. The reusable, read-only scorer lives in
`packages/cli/src/lib/catalog-compatibility.ts`. CLI and TUI consumers share
`scoreCatalogCompatibility`; neither should invent a separate rating.

Inspect all apps or one exact app through the real packaged CLI:

```bash
self-host catalog compatibility
self-host catalog compatibility linkwarden
self-host catalog compatibility wud --json
self-host catalog compatibility ntfy --project-root /absolute/project --project-id home --json
```

The app filter narrows displayed rows only; the aggregate still counts all 94
apps. Output separates implementation coverage, per-dimension declared or
blocked states, next acceptance checks, and the verified score. A zero marked
`unverified` does not mean the app failed. The command validates the canonical
bundled catalog and recipes, hashes current source bytes, runs no adapters,
reads no project credentials, and accepts no arbitrary live-receipt files.
With the paired explicit project flags, it reads only that saved shared owner,
its validated acceptance chronology, and its sanitized publisher registry.
It never executes app adapters or probes Docker/network services. Without
project selection, it reads bundled source only and receives no live credit.

## Rubric

App ratings are `unverified`, `blocked`, `broken`, `partial`, `works` (>75),
and `excellent` (100). A current live failure wins over an older pass;
external requirements remain visible even when other dimensions pass.

Each application has five equally weighted dimensions. Each dimension earns
20 points only from matching, current live acceptance. Declarations, reviewed
source, and synthetic fixtures earn zero compatibility points; their levels
remain visible so implementation work is not confused with deployed proof.

## Run a reviewed live/restart verifier

For an installed ntfy unit whose saved recipe still matches the current catalog:

```bash
self-host app shared acceptance-begin --project-root /absolute/project --project-id home --app ntfy --json
# Review, then repeat with the returned --approve token. A canary POST has its
# own --approve-step token. Request a fresh outer review before each retry.
self-host app shared acceptance-finish --project-root /absolute/project --project-id home --app ntfy --json
# Review, then repeat with its --approve token to stop/start only ntfy and
# read back the same pre-restart message. Data is retained.
```

The reviewed, mode-0700 evidence directory is
`/absolute/project/selfhost-verification-home`; artifacts are mode 0600.
Keep this local runtime evidence out of commits. The canary remains until ntfy's
cache expires; no topic is deleted. Paperless-ngx also has a reviewed read-only
workload verifier. Select an existing original document you authorize the CLI
to read (nonempty, at most 1 MiB):

```bash
self-host app shared acceptance-begin --project-root /absolute/project --project-id home \
  --app paperless-ngx --input paperless-ngx.document-id=1 --json
# Review, then repeat with the returned --approve token.
self-host app shared acceptance-finish --project-root /absolute/project --project-id home \
  --app paperless-ngx --json
# Review, then repeat with its --approve token for the selected unit restart.
```

Finish retains the reviewed document choice and verifies the same original bytes
after restarting the exact Paperless unit and its database/broker dependencies.
Only document identity and a byte hash are checkpointed, not document contents.
It does not upload a document or prove OCR/search. Authentication failure is
immediate; transient restart readiness gets bounded read-only retries.

Reviewed contracts also cover the following existing workloads:

| App | Required `--input` at begin | Read/restart scope |
| --- | --- | --- |
| Immich | `immich.asset-id=UUID` | Administrator-owned original image, at most 1 MiB; exact bytes and identity |
| Jellyfin | `jellyfin.item-id=UUID` | Local Movie/Episode original, at most 1 MiB; exact bytes and library membership, not playback/transcoding |
| Beszel | `beszel.system-id=RECORD_ID` | Existing owned UP paired system; recent meaningful stats and original historical record, not new agent enrollment |
| Uptime Kuma | `uptime-kuma.monitor-id=NUMBER` | Existing active monitor; recent UP status and original heartbeat |

Use the same begin/finish review sequence with the selected `--app`. Finish
retains the original input and restarts only that app's saved unit, including
its owned database/cache dependencies. Session authentication has separate
step approval when needed. A withheld approval returns `deferred`, not an
application failure; request a fresh outer review before resuming with its
step token. No new photo, media item, monitor or system is created by these
read-only workload checks. Intended-client access remains unverified.

Sonarr, Radarr, Grafana, Gotify and Navidrome have staged read observers but
no active result contracts: library metadata, dashboard layout and stored
message reads cannot substitute for their import, query or delivery workloads.
Other apps return `blocked` until an app-owned
acceptance contract is reviewed. A recipe change requires migration, not a reset
of existing data or credentials. This verifier covers only the live/restart
dimension, not first-run setup or Homarr. The catalog command loads its registry
only for the explicitly selected project. No live run or new score is claimed
by source fixtures.

## Required dimensions

| Dimension | Required live checks |
| --- | --- |
| Compose | Fresh scoped apply, private exposure, exact owned storage inventory (stateless apps may have none) |
| Setup | First run, actual credential login or documented no-account readback, resume readback |
| Homarr | Native: tile, Homarr-origin reachability, integration test, applicable widget readback. Tile-only: tile and Homarr-origin reachability. Control plane: board/API readback and reload persistence. Not applicable: explicit reviewed applicability proof |
| Links | Selected app-to-app configuration and functional readback, or verified independence for an app that needs no links |
| Live/restart | App-specific health, meaningful core round trip, persisted data/configuration after a scoped restart |

`requiredCompatibilityChecks` exports the exact receipt check IDs. A passing
HTTP response, running container, or generated credentials alone satisfies
none of these dimension contracts. A native integration does not make the
application itself compatible. Where Homarr has no native integration, report
**tile-only**, not a broken native integration or a missing widget.

Optional Homarr widgets use existing resource IDs: pass
`--input immich.immich-album-id=EXISTING_ALBUM_ID` or
`--input beszel.beszel-system-id=EXISTING_SYSTEM_ID` to `app shared homarr-plan`
and its separately approved `homarr-apply`. Saved choices are reused by
`homarr-status`; absent IDs leave these widgets omitted, without creating an
album or enrolling an agent.
Home Assistant's `--input home-assistant.home-assistant-automation-id=EXISTING_AUTOMATION_ID`
configures its clickable automation widget; read-only functional checks never
execute that automation and report its data check as not run.

Every app stays in the denominator, including unknown, unsupported,
external-required, and missing recipes. Consumers must pass the complete
catalog, not `availableCatalog`, recipe choices, or a filtered search result.
`expectedAppIds` preserves a fixed baseline when inputs are missing. The
bundled baseline is all 94 catalog app IDs. A missing input contributes zero;
extra or duplicate IDs are rejected.

The aggregate is total earned points divided by `appCount * 100`, displayed
to two decimals. The goal is strictly **greater than 75**, checked before
rounding. At 94 apps, this means at least 7,060 earned points: 353 fully
verified dimensions out of 470. Adding source code cannot meet this goal.

## Evidence provenance

One passing receipt covers one entire dimension in one run. Partial passing
receipts cannot be combined into an apparently complete pass. A failing live
receipt may cover a nonempty, unique subset of that dimension's required
checks: its verifier must establish at least one failed check in that subset.
These IDs identify observed failed-run coverage, not positive completion of
the listed steps. Unrelated checks are rejected. Each receipt binds:

- The exact app ID, dimension, run ID, and ISO date/time.
- The recipe SHA-256 and dimension-specific implementation/contract SHA-256.
- Every service image, including database/cache dependencies. Live receipts
  require immutable `exact-recipe-tag@sha256:digest` references.
- Explicit required check IDs, pass/fail result, and a sanitized portable
  artifact path with its SHA-256.

Use dimension subject hashes that bind the actual implementation and reviewed
acceptance contract. For Homarr this includes its mapping, exact Homarr image,
and relevant attachment code; for links it includes the selected peer contracts
and image identities. For restart it includes the app-specific round-trip and
persistence verifier. A recipe hash alone does not bind these changes.

The default freshness window is 90 days. Future dates, stale receipts,
changed recipes/contracts/images, incomplete service inventories, secret-file
paths, and missing checks receive no credit. Latest matching live failure,
including a verified partial failed run, supersedes an older pass; a tied
failure wins. A newer complete live pass supersedes an older failure. Partial
source/fixture failures retain the complete-coverage requirement and cannot
invalidate a live pass. Source or fixture passes cannot
override a live failure. Explicit unsupported/external-required capability
states remain blockers until the reviewed capability changes.

The scorer performs no filesystem or network access. Its caller must obtain
receipts from a trusted verifier, verify the referenced sanitized artifact's
actual hash, and compute current recipe/subject hashes before supplying them.
An operator-authored JSON assertion is not a live verifier. Never import
private state, `.sessions`, credential exports, cookies, or `.env` contents to
construct a public compatibility report. No receipts are synthesized from
source filenames, manifest lifecycle dates, fixture results, or benchmark prose.

## Baseline and next work

Use `self-host catalog compatibility --json` for current implementation counts.
The 2026-10-04 source inventory contains 81 static recipes, 13 declared derived
recipes and 94 setup modules. A module may report an external prerequisite or
configuration-only preparation; its presence earns no live compatibility
credit. Homarr descriptors now include source-validated Stats metric selections
for all 48 native mappings, but widget seeding is not rendered-content acceptance.
The 2026-10-03 expansion adds source-backed Tracearr/PatchMon recipes and
94 Homarr descriptors (48 native, 46 tile-only). These counts describe
implementation coverage, not working integrations or upstream compatibility.
Catalog work can change them without changing the verified score.

`generations/generation-07.md` records historical browser acceptance of a
seven-service media harness, but explicitly withholds live proof for its new
script-first paths. `research/homarr-integration-audit.md` establishes source
coverage, not live compatibility. Neither supplies exact dated receipts bound
to every current app recipe, adapter, and service image. With no such receipts,
the verified compatibility baseline is **0/100 across all 94 apps**. This
means unverified, not that all applications fail.

Required progress: close safe recipe/setup gaps or preserve explicit blockers;
verify application-specific setup/resume behavior; verify native Homarr or
tile-only behavior from Homarr's own origin; exercise selected app links;
then run separately approved isolated fresh-instance/core-round-trip/restart
acceptance and retain sanitized, version-bound receipts. External accounts,
public ingress, Docker API access, VPN fail-closed behavior, and restore drills
keep their own approval and evidence boundaries. The scorer grants no mutation
authority and does not weaken those gates to reach a target.

## Acceptance primitives, not score shortcuts

The internal `compatibility-receipts.ts` publisher stores bounded sanitized
observations and a create-only, hash-linked registry in an explicit owner-only
evidence directory. Its loader verifies every referenced file and current
contract. Partial positive runs earn nothing; newer incomplete observations
withhold old passes. Registry gaps fail closed; a caller-pinned revision/hash
also detects an otherwise valid rollback to an earlier prefix. The production
catalog loader derives that pinned revision/hash from the selected owner's
checked acceptance ledger, not command arguments. It binds the receipt to
the current saved owner revision, manifest, remapped service IDs and immutable
images, current recipe bytes, and current executable acceptance subject. A
changed owner/recipe/source/image or unanchored registry earns no credit;
registry corruption, gaps and prefix rollback fail closed. ntfy, Paperless-ngx,
Uptime Kuma, Immich, Jellyfin and Beszel have reviewed production result-to-check
mappings. These are executable contracts, not proof that a live run passed.
A known saved-recipe drift
with no existing acceptance ledger returns zero plus an explicit per-app
migration blocker; it never changes source/image identities or accepts receipts
for the old recipe. Existing chronology still requires validation, and malformed
registry data remains an error even for a drifted app. Local ownership
and hashes are operational safeguards, not cryptographic proof against edits
by that same owner. The shared acceptance command publishes through
this registry; `catalog compatibility --project-root ABS --project-id ID`
loads matching current observations, including failures, through this boundary.
No arbitrary receipt-import option exists.

Fresh approved shared-project creation also publishes Compose observations.
The verifier witnesses selected containers absent before apply, then checks
their actual immutable image identities, private port bindings and owned
declared mounts, including an empty or read-only inventory. Unexpected writable
mounts fail the check. This does not prove restart persistence.
It saves per-app owner-only `compose-run-APP.json` anchors;
the catalog loader can use these independently of an app's restart adapter.
An existing installation cannot retrospectively claim a fresh apply. Missing
or incomplete runtime evidence earns no Compose credit, and evidence failure
never authorizes replaying an already completed deployment.

The shared setup observer records adapter-call chronology in a private owner
journal. An app-owned live result selector can additionally prove fresh setup
and a separate credential-verifying resume. Sonarr, Radarr, Prowlarr, Navidrome,
Audiobookshelf and Grafana provide paired selectors. No-account adapters
inherit first-read/resume proof from the shared read-only factory; that first
read is not account creation. Gotify and PhotoPrism currently provide resume
proof only, which cannot supply the required fresh/resume pair. The shared
`setup-proof.ts` helper stores opaque result identity; each app still owns its
actual authentication, identity/key readback and entry provenance.
Copied records, inspection-only results and legacy journals
cannot supply proof. Matching fresh/resume observations publish setup receipts
with atomic, owner-only `setup-run-APP.json` anchors. Later incomplete attempts
withhold prior credit until a successful re-verification; rollback fails closed.
`adapter-ready` alone never proves login, setup acceptance or restart persistence.

Explicit shared Homarr live status publishes owner-bound Homarr observations.
Tile-only entries require tile/recap readback and Homarr-origin reachability;
native entries additionally require the saved integration test and every
expected widget's structure and data. Empty or omitted widget results earn no
native credit. This does not prove browser rendering, MCP access, or app-to-app
wiring. Provider-pending mappings and Homarr itself receive no app integration
credit.

Each live check invalidates older credit before reading the dashboard. Failed,
missing or ambiguous responses cannot leave an old pass active. Approved
dashboard writes likewise invalidate old observations before publication,
including uncertain writes. Owner-only `homarr-run-APP.json` ledgers retain
registry anchors while current owner, recipe, image, source and publication
generation must still match. Stale history remains inspectable but uncredited.

App folders may also contain `acceptance.ts` and `acceptance-contract.json`;
packaging compiles the adapter beside `setup.ts` and ships the strict declarative
result contract. One shared loader evaluates the app-owned check predicates;
there is no app-specific command router. The acceptance subject binds the
selected app contract, adapter, setup, common lifecycle and engine sources.
The common read-only factory enforces exact owner/images, immutable reviewed
inputs, sanitized baseline hashes and trusted stop/start chronology. Shipped
Node uses its packaged catalog, without a source checkout. ntfy's adapter records
one synthetic, authenticated notification and refuses uncertain publish
replays. Its finish step requires trusted, persisted stop/start evidence for
the exact saved owner and image identity. The shared CLI dispatcher runs this
adapter through the real owner described above. The recipe now
persists notification history at `/var/lib/ntfy/cache.db`; existing projects
need a reviewed recipe migration, not a silent config rewrite. Source and
fixture validation do not award live compatibility points.

Focused source checks:

```bash
bun packages/cli/tests/catalog-compatibility.test.ts
bun packages/cli/tests/catalog-compatibility-command.test.ts
bun packages/cli/tests/catalog-compatibility-project.test.ts
bun build packages/cli/src/lib/catalog-compatibility.ts --target=bun --outfile=/dev/null
bun build packages/cli/src/catalog-compatibility.ts --target=node --outfile=/dev/null
```
