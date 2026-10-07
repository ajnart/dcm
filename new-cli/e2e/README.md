# e2e

Real-Docker end-to-end tests. They only build with the `e2e` build tag and skip
themselves when `docker info` fails, so plain `go test ./...` never runs them.

## Run locally

```sh
go test -tags e2e -v ./e2e/
E2E_TARGETS="ntfy" go test -tags e2e -v ./e2e/
```

`E2E_TARGETS` is a space separated list of Recipe or App ids (default
`ntfy vaultwarden media`). Set it to `all` to walk the whole catalog.

## What it touches

Each target gets its own temp folder and Compose project named
`selfhost-e2e-<8 lowercase hex>`, isolated with `SELF_HOST_HOME` and
`SELF_HOST_COMPOSE_PROJECT`. Cleanup runs
`docker compose -p <project> down --volumes --remove-orphans` for that project
only and then deletes the temp folder. No other Compose project, image, or
volume is touched, and nothing is pruned.

Set `E2E_LOG_DIR` to a folder to get per-target `<target>.status.json`,
`<target>.ps.txt` and `<target>.logs.txt` when a target fails.

## Timeouts

- `go test -timeout 90m` for the recipe targets (CI `recipes` job).
- `go test -timeout 340m` for `E2E_TARGETS=all` (CI `catalog` job).
- Within a target, `status` is polled every 5s for up to 3 minutes.
