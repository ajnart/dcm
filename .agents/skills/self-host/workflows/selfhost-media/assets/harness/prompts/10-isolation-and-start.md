# 10 - Isolate and start

## Actions

From the repository root:

```bash
scripts/session.sh create "$RUN_ID" "$ADMIN_USERNAME"
scripts/session.sh doctor "$RUN_ID"
scripts/session.sh urls "$RUN_ID"
scripts/session.sh up "$RUN_ID"
scripts/session.sh bootstrap "$RUN_ID"
```

Load the non-secret exports emitted by `scripts/session.sh env "$RUN_ID"` into
each shell that drives the run. Source `.sessions/$RUN_ID/secrets.env` only in a
command that consumes a key; never print the file.

The default hybrid bootstrap waits for core APIs, captures keys privately,
sets the chosen login, and wires the supported service graph. Skip forms it
already saved. For a browser-wiring benchmark use `--identities-only` instead.
Record the selected mode; API setup time remains part of the full-run total. Use project-scoped status for diagnosis.

## Stop gate

- Project name, state root, network, seven host ports, and browser session are
  unique to `RUN_ID`.
- Compose renders the exact Homarr test image and includes Seerr.
- Every service is running; Seerr's Docker healthcheck is healthy.
- Every line from the secret-safe core bootstrap is PASS.
