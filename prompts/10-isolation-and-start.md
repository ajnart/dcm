# 10 - Isolate and start

## Actions

From the installed `.selfhost/media-harness` root:
When the plan reserves seven exact ports, add `--port-start FIRST` to the
`create` command; it stops on a collision instead of leaving that range.

```bash
scripts/session.sh create "$RUN_ID" "$ADMIN_USERNAME"
scripts/session.sh doctor "$RUN_ID"
scripts/session.sh urls "$RUN_ID"
scripts/session.sh up "$RUN_ID"
bun scripts/setup-qbittorrent.ts "$RUN_ID"
bun scripts/setup-sonarr.ts "$RUN_ID"
bun scripts/setup-radarr.ts "$RUN_ID"
bun scripts/setup-prowlarr.ts "$RUN_ID"
```

Load the non-secret exports emitted by `scripts/session.sh env "$RUN_ID"` into
each shell that drives the run. Source `.sessions/$RUN_ID/secrets.env` only in a
command that consumes a key; never print the file.

The four headless reconcilers wait for core APIs, capture keys privately,
set the chosen login, and wire the supported service graph. Each failure
writes a private, secrets-full takeover artifact for that service. Retry only
the failed command after a targeted browser repair. For a browser-wiring
benchmark, use `session.sh bootstrap "$RUN_ID" --identities-only` instead.
Record the selected mode; API setup time remains part of the full-run total.
Use project-scoped status for diagnosis.

## Stop gate

- Project name, state root, network, seven host ports, and browser session are
  unique to `RUN_ID`.
- Compose renders the exact Homarr test image and includes Seerr.
- Every service is running; Seerr's Docker healthcheck is healthy.
- All four core setup commands report PASS.
