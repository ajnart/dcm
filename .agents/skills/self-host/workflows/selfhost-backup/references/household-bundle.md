# Household bundle recovery plan

`bundle backup plan` derives a local drill plan from the exact owner-controlled
media, Immich, Docmost, and Vaultwarden bundle inputs. It reads those bounded
mode-0600 JSON files and emits no secret values. Both targets must be absent,
absolute, outside the project, and non-overlapping.

```bash
self-host bundle backup plan \
  --project-root /absolute/project \
  --input /absolute/project/.selfhost/bundles/household/household-bundle.json \
  --backup-target /absolute/local-backups/home-drill \
  --restore-target /absolute/restore-drills/home-drill
```

The result names every included app-owned path, explicitly excluded rebuildable
cache, required consistency method, exact runtime identity, capture sequence,
and non-destructive isolated-restore prerequisites. It intentionally remains
`blocked`: the command does not inspect data paths, stop containers, copy data,
create either target, rewrite restore manifests, start a restored application,
or grant any approval.
Docmost Redis AOF is included by default because a safe exclusion has not been
demonstrated.

For a separately selected native Docmost database export, its application owner
provides `docmost db-export plan|apply|status`; read
[the Docmost contract](../../selfhost-setup/references/docmost-cli.md#native-database-export).
That command captures only PostgreSQL into a private local archive. It neither
captures the rest of this inventory nor establishes application consistency,
independent protection, or isolated recovery. Keep the bundle assessment
`blocked` until its complete capture and restore evidence exists.

For the bundle-owned shared-Caddy route, add `--shared-caddy-input` with the exact
`ROOT/.selfhost/bundles/ID/caddy/shared-caddy.json` path. The optional inventory
requires unchanged owner-only generated route plans and the retained applied
checkpoint. It binds the official pinned image, config/data, Caddyfile/Compose,
local CA paths, and route/checkpoint state without reading persistence or CA/key
material or calling Docker. Without this flag the route remains uncovered.
This is coverage planning only, not capture or restore evidence. A separately
approved capture must preserve complete Caddy data, including the original CA
and private key. An isolated restore must rewrite exact route/runtime paths,
preserve CA/key identity rather than regenerate it, and independently verify
HTTPS hostname checks, DNS, and intended-client trust.

A local target enables planning and a later isolated drill, but is not an
independent backup. Before treating the bundle as protected, use the general
backup contract to add encrypted off-host coverage, independent recovery-key
custody, retention, failure routing, RPO/RTO, and timestamped isolated restore
evidence. A future capture or restore adapter must keep its mutation behind a
separate exact approval and must refuse an existing restore target.
