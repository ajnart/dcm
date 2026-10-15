# Local CI with act on macOS

Run from the repository root. Use the native [contribution gate](../CONTRIBUTING.md#gate)
for ordinary changes; act exercises the existing workflow, not a second CI script.
Install act with `brew install act` if missing, and use an available Docker Engine
(for example Docker Desktop) for container runs. No Go module dependency is added.

## Default: Linux checks in a container

```sh
act --list
act push
```

Only `test` in `.github/workflows/ci.yml` is selected: formatting, build, vet,
tests, race checks and installer syntax. It does not execute the installer or e2e.
The runner uses Linux amd64, including emulation on Apple Silicon, to match the
GitHub `ubuntu-latest` job; it is not native macOS or Linux arm64 acceptance.
The first run downloads the runner image, actions and Go toolchain.

`.actrc` disables the container's Docker socket mount and automatic loading of
`.env`, `.secrets`, `.vars` and `.input`. No token is required for these public
actions. Do not pass credentials or bind your Home folder into a runner.
act also reads global configuration before this file: audit your own global
flags for secrets, mounts, privileged mode or host-runner mappings.

The workflow and job filters exclude release publishing and real e2e by default.
They are defaults, not a security sandbox: overriding `-W` or `-j` changes the scope.
Do not point act at `release.yml` or `e2e.yml` on this machine.

## Explicit opt-in: native macOS smoke

This runs workflow code directly on your Mac, without container isolation. Review
`native-smoke` first: setup actions install tools/use caches, a loopback HTTP server
is started, and the installer writes a test binary beneath the runner's temporary
directory. It does not install Apps or operate the real Project. Use a disposable
checkout and environment, with Node.js compatible with the pinned actions, Go and
Python available. This is not part of the default contribution gate.

For Apple Silicon only:

```sh
act workflow_dispatch -j native-smoke --matrix runner:macos-15 \
  -P macos-15=-self-hosted \
  --artifact-server-path="$(mktemp -d "${TMPDIR:-/tmp}/self-host-act-artifacts.XXXXXX")" \
  --artifact-server-addr=127.0.0.1
```

For an Intel Mac, replace both occurrences of `macos-15` with `macos-15-intel`.
The matrix filter selects one existing runner, never maps another OS to macOS.
The artifact directory remains for inspection; remove that specific directory
when finished. act manages its own host workspace/cache separately.

## Limits

Local runs do not certify the other native matrix entries, hosted runner images,
release publication or Docker e2e. Runner images are intentionally incomplete;
compatibility with this repository's pinned actions (including artifact upload)
must be verified by an actual run. act does not enforce all GitHub permissions,
timeouts or concurrency. Keep GitHub Actions as the acceptance check.

References: [usage/configuration/matrix/artifacts](https://nektosact.com/usage/index.html),
[container and host runners](https://nektosact.com/usage/runners.html),
[unsupported functionality](https://nektosact.com/not_supported.html).
