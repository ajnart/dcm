# Shared-project CLI

The skill and terminal `self-host` panel use the same installed CLI. Replace
`/absolute/project` with the confirmed existing owned root; retain the project ID.

```bash
self-host doctor --scope plan --json
self-host catalog recipes --json
self-host app shared plan --project-root /absolute/project --project-id selfhost \
  --app sonarr --app radarr --app homarr --json
```

Review pinned images, ports, paths, owner-secret requirements and pending gates.
After user approval, repeat the selection with `apply` and the returned token.
Tokens below are placeholders, not approval.

App-owned derived recipes (HAProxy, Headscale and licensed AIStor/MinIO) collect
their declared non-secret `--input APP.KEY=VALUE` choices before either fresh
`plan`/`apply` or `add`. Keep identical inputs through approval. The panel shows
generated ports and required additional application TCP ports; the same values
are checked and locked during apply. Override a declared extra port with
`--port APP.PORT-ID=PORT`. Owner-issued license/enrollment files use the private
`--secret-file APP:FILE-ID=/absolute/file` boundary after plan approval, not
chat or `--input`. Missing external prerequisites remain pending.

```bash
self-host app shared apply --project-root /absolute/project --project-id selfhost \
  --app sonarr --app radarr --app homarr --approve EXACT_PLAN_TOKEN --json
self-host app shared status --project-root /absolute/project --project-id selfhost --json
self-host app shared setup --project-root /absolute/project --project-id selfhost \
  --app sonarr --app radarr --app homarr --json
```

Setup without approval reviews coverage, declared non-secret inputs, and peer
effects. Its token also binds the executable setup contract; after a CLI or
adapter update, review again instead of reusing the old token. Repeat after
approval with its `SHARED-SETUP` token. Review each
reported action before adding its exact `--approve-step` token; rerun to
continue saved checkpoints. `setup-attempted` or `ready` is not full acceptance.
Approved attempts append sanitized chronology to the reported owner-only
`setup-observations.json`. It contains identities and outcomes, not credentials
or request bodies. Sonarr, Radarr and Prowlarr additionally record witnessed
fresh setup and a separate credential-verifying resume; matching observations
can publish setup compatibility receipts. Other ready-only records remain
non-evidence. Independent adapters remain parallel.

The panel offers supported app connections after account setup; saved projects
also offer **Connect installed apps**. The skill uses the same `connect plan`
and `connect apply` commands with the saved root/project ID and exact
`--source APP --target APP`. Review the returned `CONNECT` token and each
`--approve-step` token before applying. Supported pairs are Sonarr/Radarr to
qBittorrent, Prowlarr to Sonarr/Radarr, and Seerr to Sonarr/Radarr. Saved account
credentials and internal Compose addresses are reused; required folders,
categories and profiles must already exist. Done: `api-link-verified` with
the exact pair and owner. Deferred or blocked pairs stay unfinished; a verified
configuration/test does not prove media acquisition or restart persistence.

For recipe-declared first-account environment closure, review
`app shared transition-plan` for the same root/project ID and one `--app APP`.
Repeat with `transition-apply --approve EXACT_TRANSITION_TOKEN`, then rerun
setup to verify closure. This separately approved step changes only the
declared environment and recreates its selected saved unit. The panel offers
`transitionCandidates` only after saved account/key proof, clears old step
tokens and re-reviews setup after closure. Validated closure history survives
unrelated changes to the shared owner.

Once Homarr and app credential checkpoints exist:

The panel offers publication after creation, app additions and saved first-run
continuation. Its separate review/approval still applies. Existing dashboard
choices are retained; failed publication leaves app setup saved and can be
retried from **Set up Homarr dashboard**.

```bash
self-host app shared homarr-plan --project-root /absolute/project --project-id selfhost \
  --app sonarr --app radarr --app homarr --json
self-host app shared homarr-apply --project-root /absolute/project --project-id selfhost \
  --app sonarr --app radarr --app homarr --approve EXACT_HOMARR_TOKEN --json
self-host app shared homarr-status --project-root /absolute/project --project-id selfhost \
  --app sonarr --app radarr --app homarr --live --json
self-host app shared status --project-root /absolute/project --project-id selfhost --live --json
self-host app shared handoff --project-root /absolute/project --project-id selfhost \
  --app sonarr --json
```

Publication reuses saved credentials, creates supported integrations/widgets,
and reads back tiles and the stack recap. Its reviewed ping-target changes set
null targets to each app's saved internal Compose address, keeping browser
links unchanged. Existing custom ping targets require a separate repair.
Known recipe/provider incompatibility stays `nativeIntegrationPending`, with
its requirement in the recap; a tile is not a working native integration.
Missing required inputs block it;
prerequisite-dependent widgets may be omitted. Runtime and rendered content
remain unverified. Normal handoff returns references; `--show` deliberately
prints secrets, only for an explicitly requested private terminal handoff.

For failed setup, inspect `app shared handoff --app APP --json` with the saved
root/project flags. Its `recovery` identifies the exact owner, validated
checkpoint stage/attempted actions, private checkpoint/cookie/attempt files, and
the checked adapter path/hash. Failed setup outcomes include this handoff's
exact CLI arguments; the handoff itself does not export secrets or replay work.
Missing checkpoints or invalid files remain inspection gaps; optional session
files may be absent on API-only routes. Use the owning adapter's
protected repair path and verify its original completion criterion. HTTP
cookie envelopes are not agent-browser profiles; this snapshot grants no
write/replay authority and does not prove live authentication. Explicit
`--show` remains the private credential export; ordinary handoff exposes refs.

`homarr-status` reads the private board, tiles, recap and integration/widget
structure without publishing or exporting credentials again. Add `--live` to
request Homarr-server app pings, saved-integration connection tests and supported
widget data queries in parallel. Connection tests use Homarr's protected
`GET /api/integrations/{id}/test-connection` with its saved credentials.
Images without this endpoint report `not-run`; unavailable or inaccessible
routes do not prove connectivity. Reports contain fixed outcomes, not widget
data or upstream errors. Missing query contracts stay `not-run`; successful
checks do not prove browser rendering or restart persistence. Explicit live
status can publish owner-bound Homarr compatibility observations; the catalog
awards that dimension only for matching complete tile/integration/widget checks.
Missing, failed or stale observations earn no credit. Application acceptance
remains separate.
Widget reads use app-owned, source-pinned contracts. Unsupported or mutation-only
widgets and missing prerequisites remain `not-run`. TCP-only apps expose connection
endpoints, not HTTP URLs or dashboard tiles.
TCP apps, prepared jobs and private connectors share a managed recap Notebook.
The same review covers publication; readback checks content and estimated layout,
not runtime health, enrollment or rendered visibility. An empty selection does
not delete an existing recap.
App recipe drift is reported in `recipeChecks` without opening that app's
credentials or hiding the other dashboard checks. Setup, publication and
credential export still require the current recipe to match the saved owner;
read-only status neither migrates a recipe nor approves an update.

For a saved recipe that differs from the bundled version, review one app with
`app shared recipe-migration-plan --app APP` and the same root/project flags.
This bounded route accepts only additive, static non-secret environment
settings. Images, ports, mounts, accounts, private files and other apps remain
unchanged. After exact approval, use `recipe-migration-apply --app APP
--approve EXACT_MIGRATION_TOKEN`; it recreates only that saved app unit and
retains data and credentials. Verify its existing login and function afterward.
Broader changes remain blocked; this is not an image upgrade or a reset.
If the saved checkpoint proves interruption at `reviewed`, before any recorded
Docker attempt, the same plan command returns `resume-reviewed` and a new exact
approval. Review it before continuing with apply. `attempted` or uncertain work
requires inspection; it is never replayed automatically.

The saved-project control panel's **Update app images** uses this same route.
For image-only updates, review `app shared image-transition-plan --app APP`
with the same root/project flags. Show the old/new digest pins. After approval,
use `image-transition-apply --app APP --approve EXACT_IMAGE_TOKEN`. It verifies
the running unit's exact container owner and recreates only that unit; settings,
ports, storage and credentials stay unchanged. Only explicit bundled image
history can restore an older recipe. Other recipe drift stays blocked. Resume
a pre-Docker review with fresh approval; inspect any attempted or uncertain
operation. Recheck saved login, Homarr integrations and widgets afterward.

Read `catalog compatibility --project-root ROOT --project-id ID --json` to
load that owner's checked acceptance receipts. It uses the full catalog
denominator; missing, stale, changed or unverified work earns no points. The
command neither probes services nor runs setup. Without project flags it
reports source coverage only, with no live credit.

For upkeep, review `app shared add --app NEW_APP`, or `start`/`stop --app SAVED_APP`,
with the same root/project ID and no approval. Repeat after approval with the
fresh returned token. Repeated `--app` selects exact units; stopping retains
data. Refresh setup and Homarr plans after additions. For pre-Docker create or
prepared-add recovery, use status's exact `resumeApproval` with `app shared resume`.
Attempted apply is never blindly replayed.

Apps with a declared pre-start guard return `prepared-prestart`: their private
files and one Compose owner are saved, but the services have not started.
Retain that owner. Complete its reported prerequisites, then review status and
resume with its exact token. Setup and Homarr publication wait until startup.
The same app-owned guard runs before every scoped start, add and recreation,
including the canonical Compose lifecycle script.

WUD's remote Docker route additionally reviews `authority-plan --app wud
--authority-input /absolute/owner-only-choices.json`. That non-secret input
contains endpoint/certificate identities, opaque credential references, mode
and expiry—not owner hashes, credentials or observations. Repeat with
`authority-apply --approve EXACT_AUTHORITY_TOKEN`, then separately review and
approve `authority-probe`. The engine binds the real prepared journal, recipe,
images and executable sources; each start rechecks the pinned TLS identity.
Expired connection observations need another approved probe. Intent renewal,
endpoint/certificate replacement and guarded app updates remain unsupported.
Inventory mode stays blocked without trusted deny-write proof; management mode
explicitly grants host-wide Docker authority. Neither is live acceptance.

For deselected apps, review `app shared remove --app APP` with the same root and
project flags. After approval, repeat with `--apply --approval SHARED-REMOVE:ID:DIGEST`
using its fresh token. Only selected containers are stopped/removed; data and
credentials stay. Retained dependencies, configured links and private HTTPS
routes block removal. The final app remains protected; stop the project instead
of inventing a teardown. An uncertain
removal requires inspection. Homarr resource retirement remains separate.

For a removed standard app, review `app shared reinstall --app APP` with the
same owner flags, then repeat with its exact `--approve` token. This restores
the historical selection and starts only its services, preserving data,
credentials and setup checkpoints. It runs no account setup. Missing resources,
conflicts, recipe drift and uncertain removal block restoration. Derived/manual,
canonical-HTTPS, bootstrap-closure, mutable/private-config and pre-start-authority
cases remain unsupported. Done: `restored-unverified`; verify existing login,
function and required integrations before claiming the capability usable.

For a private HTTPS request on an existing shared owner, inspect
`app shared https-plan --app APP [--hostname APP=NAME.localhost] [--https-port 4443]`
with the same root/project flags. It reviews one same-owner Caddy using saved
frontend targets without changing containers. After approval, repeat bindings
with `https-apply --approve EXACT_HTTPS_ADD_TOKEN`. Review `https-proof` separately
and apply its transport token to check the owned CA/SNI route; this does not
modify client trust stores or prove private DNS/client access. Select a
`.home.arpa` name with `--hostname APP=NAME.home.arpa` for an explicit
host-only, per-request loopback override; this is not LAN DNS configuration.
Apps requiring a canonical origin have separate `canonical-origin-plan`/`canonical-origin-apply`
settings gates. Keep an existing Caddy unchanged; LAN/public routing needs the
ingress owner's separate facts. Uncertain writes require inspection.

When Homarr needs this private CA, review `app shared homarr-trust-plan --app APP`
with the same owner flags after `https-proof`. Approve its returned token through
`homarr-trust-apply`. The CLI derives the certificate from the owned proxy,
adds it without overwriting another certificate, and reads back its hash.
This widens Homarr server trust only; browser trust and integration connectivity
remain separate. It requires Homarr's certificate inspect/ensure API; older
images report an unsupported step. Retained attempts reconcile by readback,
not replay. For a descriptor requiring private HTTPS, publication uses the
verified owned route as its integration URL, while browser links and app ping
targets stay unchanged. Missing route aliases, certificate API or matching
trust readback keep native publication pending. Run `homarr-plan` again after
trust verification, then separately approve publication and check
`homarr-status --live`; trust alone does not prove integration or widget data.

Manual-job recipes remain selected and prepared, not executed: no HTTP frontend,
administrator account, browser tile, or ordinary start/stop. To check only the
declared version probe, review `app shared job-plan` with the exact root/project
ID and one `--app JOB`; after approval repeat with `job-run --approve TOKEN`.
This separately approved ephemeral probe does not initialize repositories,
perform backups/restores, or prove the job's actual function. An uncertain probe
requires inspection before recovery; it is not automatically replayed.
Their credential handoff lists named private-file paths; explicit `handoff --show`
exports those values without implying a local account or executed workload.

Private connectors are running daemons, not manual jobs or browser frontends.
Tailscale starts portless without enrollment. Its setup resolves only an exact
same-owner app target and separately reviews enrollment and private Serve;
the imported auth-key bytes are bound to the enrollment approval. Connector
recaps report enrollment pending and no app API key until verified. Client ACL,
internet isolation and restart acceptance remain separate; Serve is not a
torrent egress VPN or permission to enable Funnel, SSH, subnet or exit routing.

Current boundary: local non-root Linux/Docker, validated bundled v2 recipes,
loopback frontend ports, recipe-owned storage and private secret files. Apps
with unmet external prerequisites stay pending. The scoped HTTPS, recipe/image
transition and app acceptance routes above require their own exact reviews;
ordinary apply/setup does not complete those gates. Legacy conversion and
broader ingress remain separate. Retain the same owner when resolving a gap.
