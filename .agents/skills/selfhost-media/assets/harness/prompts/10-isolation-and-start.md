# 10 - Isolate and start

## Actions

From the repository root:

```bash
scripts/session.sh create "$RUN_ID"
scripts/session.sh doctor "$RUN_ID"
scripts/session.sh urls "$RUN_ID"
scripts/session.sh up "$RUN_ID"
scripts/session.sh bootstrap "$RUN_ID"
```

Load the non-secret exports emitted by `scripts/session.sh env "$RUN_ID"` into
each shell that drives the run. Source `.sessions/$RUN_ID/secrets.env` only in a
command that consumes a key; never print the file.

`bootstrap` waits for the core APIs, captures the freshly generated Arr keys,
configures qBittorrent, Sonarr, Radarr, Prowlarr, and full indexer sync, and emits
only secret-safe summaries. It also creates the private connections file and
reports how the user can reveal it locally. Use
`scripts/session.sh status "$RUN_ID"` and
only project-scoped Compose logs to diagnose startup. Do not touch the legacy
containers or another session.

## Stop gate

- Project name, state root, network, seven host ports, and browser session are
  unique to `RUN_ID`.
- Compose renders the exact Homarr test image and includes Seerr.
- Every service is running; Seerr's Docker healthcheck is healthy.
- Every line from the secret-safe core bootstrap is PASS.
