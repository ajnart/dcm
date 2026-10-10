# Dependency refresh evidence

Issue: [#247](https://github.com/ajnart/selfhost-skills/issues/247), part of #191.
Checked on 2026-10-10. Consolidates open Dependabot PRs #214–#218.
No other open Dependabot PRs were found. Their diffs only change workflow action references.

## Scope and method

The repository has one Go module, three workflows, a Dependabot configuration,
and a GoReleaser configuration. There are no current npm or Python dependency
manifests. App images, the installer, Project state, and host software are unchanged.

Resolved versions with `go list -m -u -json all`, checked the latest modules'
Go requirements, ran `go get -u -t ./...`, then `go mod tidy`. All modules used
by project packages and their tests are now at their latest non-retracted
release for their existing module paths. No source/API adaptation was needed.
Tidy corrected direct/indirect classification, removed unused Harmonica, and
completed upstream test checksums; checksum additions do not introduce runtime
dependencies or new tests.

Context7 lookup was attempted for Go, GitHub Actions and GoReleaser, but all
returned a monthly-quota error. Evidence below uses official documentation,
upstream tagged metadata/release notes, and Go's module proxy instead.

## Go versions

| Module                                 | Before                             | After                              |
| -------------------------------------- | ---------------------------------- | ---------------------------------- |
| charm.land/bubbles/v2                  | v2.2.1                             | v2.2.1                             |
| charm.land/bubbletea/v2                | v2.0.10                            | v2.1.0                             |
| charm.land/huh/v2                      | v2.0.3                             | v2.0.3                             |
| charm.land/lipgloss/v2                 | v2.0.6                             | v2.0.6                             |
| filippo.io/age                         | v1.3.2                             | v1.3.2                             |
| filippo.io/hpke                        | v0.4.0                             | v0.4.0                             |
| github.com/andybalholm/brotli          | v1.1.1                             | v1.2.6                             |
| github.com/atotto/clipboard            | v0.1.4                             | v0.1.4                             |
| github.com/catppuccin/go               | v0.2.0                             | v0.3.0                             |
| github.com/charmbracelet/colorprofile  | v0.4.3                             | v0.4.3                             |
| github.com/charmbracelet/harmonica     | v0.2.0                             | removed: unused                    |
| github.com/charmbracelet/ultraviolet   | v0.0.0-20260811164956-006e29f97886 | v0.0.0-20261008173134-6b8d4baf91b4 |
| github.com/charmbracelet/x/ansi        | v0.11.8                            | v0.11.9                            |
| github.com/charmbracelet/x/exp/ordered | v0.1.0                             | v0.1.0                             |
| github.com/charmbracelet/x/exp/strings | v0.0.0-20240722160745-212f7b056ed0 | v0.1.0                             |
| github.com/charmbracelet/x/term        | v0.2.2                             | v0.2.2                             |
| github.com/charmbracelet/x/termios     | v0.1.1                             | v0.1.1                             |
| github.com/charmbracelet/x/windows     | v0.2.2                             | v0.2.2                             |
| github.com/clipperhouse/displaywidth   | v0.11.0                            | v0.11.0                            |
| github.com/clipperhouse/uax29/v2       | v2.7.0                             | v2.7.0                             |
| github.com/dustin/go-humanize          | v1.0.1                             | v1.1.0                             |
| github.com/goccy/go-json               | v0.10.6                            | v0.11.2                            |
| github.com/google/uuid                 | v1.6.0                             | v1.6.0                             |
| github.com/hashicorp/golang-lru/v2     | v2.0.7                             | v2.0.7                             |
| github.com/inconshreveable/mousetrap   | v1.1.0                             | v1.1.0                             |
| github.com/klauspost/compress          | v1.20.1                            | v1.20.1                            |
| github.com/lucasb-eyer/go-colorful     | v1.4.1                             | v1.4.1                             |
| github.com/mattn/go-runewidth          | v0.0.27                            | v0.0.31                            |
| github.com/mitchellh/hashstructure/v2  | v2.0.2                             | v2.0.2                             |
| github.com/muesli/cancelreader         | v0.2.2                             | v0.2.2                             |
| github.com/posthog/posthog-go          | v1.34.0                            | v1.34.0                            |
| github.com/rivo/uniseg                 | v0.4.7                             | v0.4.7                             |
| github.com/spf13/cobra                 | v1.10.2                            | v1.10.2                            |
| github.com/spf13/pflag                 | v1.0.9                             | v1.0.10                            |
| github.com/xo/terminfo                 | v0.0.0-20220910002029-abceb7e1c41e | v1.2.0                             |
| go.yaml.in/yaml/v3                     | v3.0.5                             | v3.0.5                             |
| golang.org/x/crypto                    | v0.55.0                            | v0.58.0                            |
| golang.org/x/sync                      | v0.22.0                            | v0.24.0                            |
| golang.org/x/sys                       | v0.47.0                            | v0.49.0                            |
| golang.org/x/text                      | v0.41.0                            | v0.43.0                            |

Ultraviolet has no tagged release: its existing pseudo-version dependency
advances to the revision required by the stable Bubble Tea v2.1.0 release.
No pre-release tags or incompatible major module paths were selected.
Every used dependency still supports the existing Go 1.26.0 minimum.
README.md's source-build claim therefore remains correct and unchanged.

### Upstream-only graph entries not pinned

`go list -m -u all` also reports updates for entries inherited from upstream
module manifests that `go list -deps -test ./...` confirms are not imported by
this project's packages or tests. Adding otherwise unnecessary top-level
requirements solely to override upstream test/tool dependencies would bloat
the manifest. These remain governed by upstream requirements:

Upstream requirements also advanced four unimported graph entries without
top-level pins: `golang.org/x/mod` v0.38.0 → v0.41.0, `golang.org/x/net`
v0.57.0 → v0.60.0, `golang.org/x/term` v0.45.0 → v0.47.0, and
`golang.org/x/tools` v0.49.0 → v0.51.0. The latter two are already latest.

| Module                                | Selected                           | Available                          |
| ------------------------------------- | ---------------------------------- | ---------------------------------- |
| c2sp.org/CCTV/age                     | v0.0.0-20260829155415-4448f2097b2d | v0.0.0-20260925130909-50a8ecf2a220 |
| github.com/bits-and-blooms/bitset     | v1.24.6                            | v1.26.0                            |
| github.com/charmbracelet/x/conpty     | v0.1.1                             | v0.2.0                             |
| github.com/charmbracelet/x/errors     | v0.0.0-20240508181413-e8d8b6e2de86 | v0.0.0-20261008172826-faa4adf95555 |
| github.com/charmbracelet/x/exp/golden | v0.0.0-20250806222409-83e3a29d542f | v0.1.0                             |
| github.com/charmbracelet/x/xpty       | v0.1.3                             | v0.1.4                             |
| github.com/stretchr/testify           | v1.11.1                            | v1.12.1                            |
| github.com/xyproto/randomstring       | v1.0.5                             | v1.2.0                             |
| golang.org/x/exp                      | v0.0.0-20231006140011-7918f672742d | v0.0.0-20261009195045-ca0d7ba23607 |
| golang.org/x/mod                      | v0.41.0                            | v0.42.0                            |
| golang.org/x/net                      | v0.60.0                            | v0.61.0                            |
| gopkg.in/check.v1                     | v0.0.0-20161208181325-20d25e280405 | v1.0.0-20201130134442-10cb98267c6c |

## Workflow dependencies

| Dependency                   | Before           | After / verified stable release                                               |
| ---------------------------- | ---------------- | ----------------------------------------------------------------------------- |
| actions/checkout             | v4               | [v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1)             |
| actions/setup-go             | v5               | [v7.0.0](https://github.com/actions/setup-go/releases/tag/v7.0.0)             |
| actions/setup-python         | v5               | [v7.0.0](https://github.com/actions/setup-python/releases/tag/v7.0.0)         |
| actions/upload-artifact      | v4               | [v7.0.2](https://github.com/actions/upload-artifact/releases/tag/v7.0.2)      |
| goreleaser/goreleaser-action | v6               | [v7.2.3](https://github.com/goreleaser/goreleaser-action/releases/tag/v7.2.3) |
| GoReleaser binary            | floating `~> v2` | [v2.18.3](https://github.com/goreleaser/goreleaser/releases/tag/v2.18.3)      |
| Workflow Go toolchain        | go.mod: 1.26.0   | [1.27.2](https://go.dev/dl/?mode=json)                                        |
| Workflow Python              | floating `3.x`   | unchanged: already selects stable Python 3                                    |

All five actions use Node 24; the documented minimum runner is 2.327.1.
The workflows use GitHub-hosted Ubuntu/macOS runners. Checkout's separate
credential file requires runner 2.329.0 for authenticated Git inside Docker
container actions, which these workflows do not use. No unsafe fork-checkout
opt-in was added; existing triggers do not use `pull_request_target` or
`workflow_run`. Setup Python v7 removes `pip-install`, which is not used here.
Upload Artifact retains zipped archives by default, distinct artifact names,
hidden-file exclusion, and existing private-log exclusions. GHES was already
unsupported by the previous v4 artifact action.

GoReleaser remains v2 with the same four tar.gz targets, checksum naming,
snapshot version template and workflow-owned publication. Exact stable tags
are used instead of moving action major tags and a floating GoReleaser range.
Go 1.27.2 is selected only for workflows; no local toolchain was installed.

## Sources

- [Go module resolution, upgrades, retractions and tidy](https://go.dev/ref/mod).
  Latest-version metadata is available at
  `https://proxy.golang.org/<module-path>/@latest`; the before/after audit used
  `go list -m -u -json all` and each available module's `@latest` Go metadata.
- [Bubble Tea v2.1.0](https://github.com/charmbracelet/bubbletea/releases/tag/v2.1.0):
  additive OSC 7501 support and terminal-size/shutdown fixes.
- [Ultraviolet revision](https://github.com/charmbracelet/ultraviolet/commit/6b8d4baf91b4).
- [Catppuccin v0.3.0](https://github.com/catppuccin/go/releases/tag/v0.3.0),
  [Go JSON v0.11.2](https://github.com/goccy/go-json/releases/tag/v0.11.2),
  [pflag v1.0.10](https://github.com/spf13/pflag/releases/tag/v1.0.10),
  [terminfo v1.2.0](https://github.com/xo/terminfo/releases/tag/v1.2.0).
- Official tag/module metadata for releases without GitHub release notes:
  [Brotli](https://github.com/andybalholm/brotli/tree/v1.2.6),
  [go-humanize](https://github.com/dustin/go-humanize/tree/v1.1.0),
  [go-runewidth](https://github.com/mattn/go-runewidth/tree/v0.0.31),
  [Charm x](https://github.com/charmbracelet/x),
  [Go crypto](https://cs.opensource.google/go/x/crypto/+/refs/tags/v0.58.0:),
  [Go sync](https://cs.opensource.google/go/x/sync/+/refs/tags/v0.24.0:),
  [Go sys](https://cs.opensource.google/go/x/sys/+/refs/tags/v0.49.0:),
  [Go text](https://cs.opensource.google/go/x/text/+/refs/tags/v0.43.0:).
- Tagged action READMEs and `action.yml` definitions:
  [checkout](https://github.com/actions/checkout/tree/v7.0.1),
  [setup-go](https://github.com/actions/setup-go/tree/v7.0.0),
  [setup-python](https://github.com/actions/setup-python/tree/v7.0.0),
  [upload-artifact](https://github.com/actions/upload-artifact/tree/v7.0.2),
  [goreleaser-action](https://github.com/goreleaser/goreleaser-action/tree/v7.2.3).
- [GoReleaser v2.18.3 configuration schema](https://github.com/goreleaser/goreleaser/blob/v2.18.3/www/static/schema.json).

## Gate and limits

Merged `origin/main` at `282fba3b6e9265f02ae92f734ad7b463ed547257`
before the gate, retaining #242's Onboarding, goldens and Recipe alias.
On existing Go 1.26.0 darwin/arm64 with `GOFLAGS=-buildvcs=false`:

- `gofmt -l .`: empty; `go build ./...`: passed.
- `go vet ./...` and `go vet -tags e2e ./e2e/`: passed.
- `go test ./...`: passed, including all unchanged Dashboard goldens.
- `go test -race ./internal/tui/ ./internal/activity/ ./internal/telemetry/`: passed.
- `bash -n install.sh`, `git diff --check`, `go mod verify`,
  `go mod tidy -diff`: passed; tidy produced no diff.
- Offline validation parsed all five YAML files, checked 16 action uses against
  upstream tagged inputs and Node runtimes, and syntax-checked 13 shell blocks.
  GoReleaser field types/enums/required keys match its v2.18.3 JSON schema.

Actionlint and GoReleaser executables were unavailable; no host tools were
installed. The offline checks are not full actionlint or GoReleaser runtime
validation. Go 1.27.2 workflow execution, release packaging, Docker e2e runtime,
browser and installer runtime were not run. CI is blocked by account billing.

After independent review and replacement PR merge, close #214, #215, #216,
#217 and #218 as superseded: all their action upgrades are included at verified
stable patch releases. None was merged or closed by this dependency lane.
