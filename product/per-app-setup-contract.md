# Per-app first-run contract

Per-app install assets live in `catalog/apps/<id>/`: `manifest.json` says what
the app is, `recipe.json` describes its services in the shared Compose project,
and `setup.ts` owns first-run account setup and private credential references.
Derived recipes instead declare `derived-recipe-adapter.json` and an app-owned
compiler. Optional `homarr.json` describes dashboard mapping; app-link and
acceptance contracts stay separate. The
shared `packages/cli/src/control-panel/setup-engine.ts` supplies exact-project
CLI reads, approval-gated mutations, and bounded parallel batches. Approval
prompts never overlap. An attempted or ambiguous one-time action stays in the
existing app checkpoint; the engine does not replay it blindly.

Optional `composition.json` maps catalog dependencies to private services
already bundled in the exact recipe. It contains `schemaVersion: 1`, `appId`,
the recipe's raw-file SHA-256, and `dependencies` entries with `appId`,
`serviceId`, and `officialUrl`. The catalog validates the dependency against the
app manifest, the primary service's dependencies, its unpublished target
service, and the recipe's publisher evidence. Changing recipe bytes requires
reviewing this mapping again. The control panel retains the complete goal plan
but deploys the owning recipe once; explicitly requested standalone databases
are never folded away. Reusing an existing app's mapping requires the same
saved recipe hash. This is goal-selection metadata, not a runtime rewrite,
shared-database configuration, or another source of Compose truth.

Shared setup rechecks literal `configFiles` on disk before returning owned
configuration metadata. Missing, changed, linked, or incorrectly permissioned
files block setup without repairing them. This read-only check never opens
secret-bearing `privateConfigs`.

The repeatable routes are small enough to describe in a catalog folder:

| Pattern | Examples | Shared primitive and verification |
| --- | --- | --- |
| Image-seeded login | Paperless-ngx, slskd, Gotify | Generate a password before Compose start, bind it through a documented file or owner-only environment, then verify the resulting account with the app's private endpoint. |
| Derived password hash | ntfy | Generate one private password, derive the upstream-required bcrypt value into an owner-only env file, reuse and verify the same hash on resume, then check authenticated access and anonymous denial. Delivery and tokens are separate. |
| App-generated key | Sonarr, Radarr, Prowlarr, Lidarr, SABnzbd | Read only the key field from the exact owned container's private config; use that key for the app's documented auth update and read back the saved policy. |
| First-page key bootstrap | Bazarr | On the exact private origin, parse only the generated key from the upstream first-page injection before auth is enabled; save it before a checkpointed API auth update, then verify both the new login and anonymous denial. Do not assume every app exposes a safe first-page key. |
| App-owned CLI key | Syncthing | Ask the exact owned container's pinned CLI for its generated key, save that key before a checkpointed REST auth update, then verify the saved login, keyed REST access, and anonymous denial. A saved key without a write checkpoint may resume only while upstream auth remains pristine. |
| One-time HTTP owner | Homarr, Immich, Docmost | Persist an attempted checkpoint before the first account write, save any one-time return value immediately, then verify a fresh login. Setup closure, when required, is a separate state. |
| Authenticated token after owner signup | Firefly III | Register once through its pinned CSRF form, verify the saved login, initialize the personal-access grant through its approved profile GET, then checkpoint token creation and verify the saved bearer identity. A lost token response stops for inspection. |
| Password-only or no account | Actual Budget; Loki, Prometheus | Preserve a null username when the app has none; do not invent credentials for a no-account service. Verify only its documented private endpoint. |
| External identity | Seerr with Jellyfin | Reuse only the selected, verified identity provider in the same Compose owner; do not create a fictitious local password. |
| Admin and database bootstrap | Keycloak | Generate separate admin and database passwords, bind them only through the documented startup inputs, and verify the saved admin through an authenticated private API read. This does not configure public TLS or SSO clients. |
| Declarative no-account service | Gatus, Vector, Glances, Caddy, Traefik | Use a pinned image and, when required, a reviewed non-secret generated config file. Check only the upstream-documented private readiness endpoint. Do not invent a login, key, monitored target, telemetry route, or working ingress. |
| Non-HTTP local readiness | Valkey, Unbound | Use a fixed read-only command in the exact owned container to prove local PING or DNS resolution. Keep host/peer reachability and authentication separate from local readiness; never treat a process or open port as a successful DNS answer. |

## Reuse existing boundaries

The app folder and typed contracts are runtime authority. Consult
`catalog/types/` for private files/configuration, mutable accounts, derived
recipes, canonical origins, Docker authority, manual jobs and acceptance.
These boundaries already cover generated secret files/env values, password
hashes, owner-issued credentials, private HTTPS and mTLS Docker APIs.
Their declared prerequisites remain separate from application acceptance.
Discover current coverage through `self-host catalog recipes --json` and
`self-host catalog compatibility --json`; source counts earn no live score.

Classify the upstream credential pattern first. Trace startup flags through the
pinned source: an existing private-file or environment binding may already
solve the input. Reuse the typed boundary instead of adding another transport.
Record genuinely missing primitives as unfinished capabilities. Request bodies
require source or captured payload evidence, not route names or log metadata.

### Add or extend an entry

1. Reuse its existing research and pinned source evidence. Recheck changed
   versions and request schemas before changing the adapter.
2. Declare its services, dependencies, storage and credential inputs in the
   app folder. Reuse the recipe types; keep Compose ownership in the engine.
3. Implement the smallest deterministic account/key route through
   `SetupContext`. Save one-time values before fallible readbacks and place
   an attempted checkpoint before each one-time write. Done: saved credentials
   authenticate the expected owner, or the exact unfinished prerequisite is named.
4. Provide `inspect` only when the restricted interface can prove that result.
   POST-based login or identity reads still require their normal approval.
5. Add the optional Homarr mapping from saved connection details. Verify tiles,
   integrations, widgets and recap separately; unsupported native integrations
   remain tile-only. Add app-link contracts only for supported relationships.
6. Run the affected source checks. Fresh deployment, credential-verifying resume,
   restart and integration evidence belong to the compatibility rubric in the
   [CLI manual](../packages/cli/README.md), not a source-coverage count.

### Password proof and stable approvals

A valid cached session is not proof that the saved password still works.
Verify the password through the existing approved login or a documented
equivalent, then match the expected owner. Preserve a valid retained token
bound to pending writes instead of rotating its approval intent.

If a fresh identity read itself needs approval, persist its pending cookie
privately before returning for review. Give retained and fresh reads distinct
action names so the panel's one-current-token-per-action rule converges.
Consume pending proof after successful identity readback; definitive rejection
clears only that pending proof, while uncertain failures preserve it. Tdarr,
Audiobookshelf, Scrypted and Docmost demonstrate these routes. Cookie envelopes
remain private HTTP state, not browser profiles or live acceptance receipts.

A recipe can be selectable before its first-run route exists. That is a
deployment candidate, **not** a configured app. In particular, a generated
password file alone does not prove that an upstream wizard accepted it.
The private HTTP transport binds fixed relative paths and bounded non-secret
query parameters to approvals; arbitrary URLs and credential query values are
rejected. Non-HTTP commands target the exact owned container with fixed argv
and private stdin, never a generic host shell. One-time writes require a
pre-send checkpoint. Side-effecting GETs require explicit mutation approval.
Use the restricted inspection interface in `catalog/types/setup.ts` for saved
first-run readbacks. Its supported protocol boundaries are authoritative;
inspection, app function and restart acceptance remain separate.

The `app shared setup` route reuses app-owned deterministic adapters for
HTTP applications and exact-container verification where HTTP is not the
upstream interface. It
resolves each app's generated password and API-key sidecar inside its app-scoped
`secrets/<app>/` folder, while one Compose file owns all selected services.
Standalone-only adapters declare `sharedOwner: false`; the shared plan marks
them pending instead of promising a first run that would call another project.
The owner revision, manifest hash, exact service labels, and published origin
must still match before an API step. Paperless-ngx now has a shared HTTP
admin/token route. Immich can verify its shared first administrator and save a
scoped Homarr API key; its shared setup result explicitly retains
`setupClosed: false`, so readiness is not setup-closure or photo/restart proof.
Homarr's shared adapter now creates/verifies its administrator and API key
through checkpointed HTTP calls. The isolated seven-app trial has saved setup
and dashboard readbacks, not blanket rendered-widget or current runtime
acceptance. Seerr requires the same project's verified Jellyfin admin, then
saves its own key without creating a separate Seerr password. Library and
Sonarr/Radarr connection adapters exist; their fresh live and restart proof
remain separate.

Earlier owner-specific routes and research remain in
[setup routes](../docs/setup-routes.md), the [reuse map](control-panel-reuse-map.md)
and the [isolated proof](control-panel-proof.md). They are historical evidence,
not the current shared CLI workflow or proof of every catalog entry. Retain
those owners on resume; use `app shared` for new shared projects.

The adapter returns a non-secret checkpoint, not a blanket health claim. The
project panel uses Docker's upstream-provided health status when present and
otherwise says **unknown**. Current installed apps can be selected even when
the bundled catalog has no new-install recipe. The new-project picker shows
recipe-backed apps and labels the rest discovery-only. A discovery listing must
never silently become an installer.

For a shared owner's exact password and key values, deliberately request
`self-host app shared handoff --app APP --project-root ROOT --project-id ID --show`.
Legacy standalone owners retain their existing handoff commands. Normal
status, logs, screenshots, and setup results show references only. The app
state and secrets stay under the selected project's mode-0700 `.selfhost/`
directory, which is gitignored; removing an app from selection preserves them.

Earlier source checks from 2026-09-29: [Homarr v2 setup and API](https://v2.preview.homarr.dev/docs/getting-started/after-the-installation/), [Immich post-install](https://docs.immich.app/install/post-install/), [Paperless configuration](https://docs.paperless-ngx.com/configuration/), [Paperless v3.2.1 upstream Compose](https://github.com/paperless-ngx/paperless-ngx/blob/v3.2.1/docker/compose/docker-compose.postgres.yml), [Prowlarr API and image](research/prowlarr.md), and [Uptime Kuma v2.5.5 setup source](research/uptime-kuma-v2-first-run.md). See the [isolated live proof](control-panel-proof.md) for its exact historical acceptance boundary. Current app-folder evidence and the running image govern version-sensitive APIs; moving tags do not refresh earlier proof. Source checks alone never prove another host.
