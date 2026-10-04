# Same-owner service links

`packages/cli/src/lib/service-links.ts` implements a separate link boundary;
account-only setup does not imply these links succeeded. Each app owns its
`links.ts` descriptors. All peers must have fresh verified accounts in one
exact shared Compose owner (root, project ID, manifest hash, revision).
Only the narrow private transport releases registered/redacted saved credentials.
Dedicated per-link checkpoints must not replace account setup checkpoints.

| Link | Canonical inspected evidence | Readback/test |
| --- | --- | --- |
| Sonarr/Radarr -> qBittorrent | `scripts/bootstrap-core.ts`: live `/api/v3/downloadclient/schema`, required host/port/username/password and `tvCategory`/`movieCategory` fields | GET `/api/v3/downloadclient`; POST `/api/v3/downloadclient/test` |
| Prowlarr -> Sonarr/Radarr | `scripts/bootstrap-core.ts`: live `/api/v1/applications/schema`, `prowlarrUrl`, `baseUrl`, `apiKey`, `fullSync` | GET `/api/v1/applications`; POST `/api/v1/applications/test` |
| Seerr -> Sonarr/Radarr | `scripts/bootstrap-seerr.ts`: `/api/v1/settings/{sonarr,radarr}/test`, exact Any profile and selected accessible root | GET `/api/v1/settings/{sonarr,radarr}` and test response profile/root selection |

The media `setup-*.ts` wrappers invoke these canonical bootstrap paths through
`scripts/lib/setup-core-cli.ts`. Arr account keys come from the exact owned
`/config/config.xml`, never guessed browser URLs. Links use internal Compose
ports derived from the exact saved manifest's frontend target, not a catalog
default or browser port. Hotio qBittorrent binds its chosen `WEBUI_PORTS`, so
its saved target may be 41445 rather than 8080. Non-secret external URLs
are display links only. Seerr neither initializes its entire setup nor requests
media here. qBittorrent account setup owns its categories.

Save requests require explicit approval. A checkpoint is persisted before POST;
resume starts with GET and refuses a missing/different resource after an
attempted save. Existing differing resources are never overwritten. Lost
responses remain inspect-required until exact readback reconciles them.
Connection-test POSTs are separately approved and do not start downloads.

Source/synthetic validation is not live compatibility or acceptance. No live
Docker apply, indexer provisioning, media request/download, restart persistence,
VPN fail-closed test, or browser acceptance is established by this module.

## CLI boundary

Run `self-host connect plan --project-root /absolute/project --project-id ID
--source prowlarr --target sonarr --json`, then use the returned exact
`CONNECT:ID:DIGEST` with `connect apply` and identical owner/link arguments.
Apply rechecks both account adapters and exact runtime ownership before releasing
credentials. Each newly discovered HTTP POST has its own returned
`--approve-step TOKEN`; review and resubmit it, preserving earlier approvals.
All six descriptors use this same route. Plan does not inspect Docker or read
credentials. Apply records only redacted service-link results.

The runner reuses the shared-project mutation lock. Its dedicated `service-links/`
ledger has owner-only directories and immutable mode-0600 revision files; writes
compare the prior revision and content hash. The save-attempt record is persisted
only after that HTTP step is approved and before bytes are sent. Denying a review
does not create an attempted save. Account setup checkpoints remain untouched.
