# e2e

Real-Docker end-to-end tests. They only build with the `e2e` build tag and skip
themselves when `docker info` fails, so plain `go test ./...` never runs them.

## Run locally

```sh
go test -tags e2e -timeout 90m -run '^TestE2E$' -v ./e2e/
E2E_TARGETS="ntfy" go test -tags e2e -timeout 90m -run '^TestE2E$' -v ./e2e/
E2E_BESZEL_ROOTLESS_STATS=1 E2E_TARGETS="beszel" go test -tags e2e -timeout 90m -run '^TestE2E$' -v ./e2e/
E2E_HOMARR_FUNCTIONAL=1 go test -tags e2e -timeout 45m -run '^TestHomarrFunctional$' -v ./e2e/
```

`E2E_TARGETS` is a space separated list of Recipe or App ids (default
`ntfy vaultwarden media`). Set it to `all` to walk the whole catalog.

Admission checks the filesystems holding the owned temporary Project and the
executable/helper staging before installation and later mutation/pull/restore
commands. Project storage requires 8 GiB and 100,000 free inodes;
`E2E_MIN_FREE_GB` may set a positive integer GiB floor.
A separately owned, absolute directory may be selected with
`E2E_PROJECT_TMPDIR`; each target creates and removes only its unique child
there. Executable and helper staging continues to use `TMPDIR`, with an
independent 2 GiB and 100,000-inode reserve configurable through
`E2E_MIN_EXECUTABLE_FREE_GB`. Evidence records both measurements, minima and
purposes.
A low or unavailable measurement blocks further mutations and queued targets,
records sanitized resource evidence, and preserves scoped cleanup.

Owned fixtures supply verified private TLS for NetBird and Authelia, private
TLS/STARTTLS prerequisites for Passbolt, a read-only mTLS Docker facade for
WUD's exact owned ntfy container, and an exact same-Project load container for
Beszel's rootless socket-proxy statistics proof. Passbolt browser/OpenPGP
enrollment remains manual. These fixtures provide no VPN, public DNS, real SMTP
account or mailbox delivery, or remote Docker socket acceptance. See
[acceptance.md](acceptance.md) for the probe and evidence boundaries.

## What it touches

Each target gets its own temporary roots and Compose project named
`selfhost-e2e-<8 lowercase hex>`, isolated with `SELF_HOST_HOME` and
`SELF_HOST_COMPOSE_PROJECT`. Cleanup runs
`docker compose -p <project> down --volumes --remove-orphans` for that project
only and then removes its unique Project-storage and executable-staging roots
after successful teardown. By default these share one root. A failed teardown
retains both roots and blocks further targets; a failed root removal retains
its recovery path in evidence. Cleanup does not remove unowned projects or
prune images or volumes.

Set `E2E_LOG_DIR` to persist sanitized per-target `<kind>-<target>.json` lifecycle
evidence. Raw container diagnostics require `E2E_PRIVATE_DIAGNOSTICS=1` and stay
under the private diagnostics directory.

## Timeouts

- `go test -timeout 90m` for the recipe targets (CI `recipes` job).
- `go test -timeout 340m` for `E2E_TARGETS=all` (CI `catalog` job).
- Within a target, `status` is polled every 5s for up to 3 minutes.
- The final 12 minutes of the test deadline are reserved for source and restore
  cleanup. The default Go timeout of 10 minutes is insufficient; use the
  explicit timeouts above. Seafile installation is bounded to 15 minutes;
  other CLI commands are bounded to 10 minutes and the remaining test budget.
