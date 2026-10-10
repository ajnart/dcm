# Releasing the self-host CLI

A CLI release is a GitHub release tagged **`vX.Y.Z`** (the earlier channel used
`new-cli-vX.Y.Z`; both are accepted) that carries these assets:

```
checksums.txt
self-host_X.Y.Z_linux_amd64.tar.gz    self-host_X.Y.Z_linux_arm64.tar.gz
self-host_X.Y.Z_darwin_amd64.tar.gz   self-host_X.Y.Z_darwin_arm64.tar.gz
```

The installer and `self-host self-update` pick the highest semver among
non-draft, non-prerelease releases that carry `checksums.txt` and a
`self-host_<version>_*.tar.gz`. Releases without them (the legacy skill-pack
releases `v1.0.0`, `v1.1.1`, `v1.1.2`) are never chosen. Create the release
`--latest=false`: the CLI does not depend on GitHub's "Latest" badge.

## Prepare

1. Work from a clean `main` that passes the gate:
   `gofmt -l .`, `go vet ./... && go vet -tags e2e ./e2e/`, `go test ./...`,
   `go test -race ./internal/release ./internal/cli ./internal/tui`, `bash -n install.sh`.
2. Pick the next version. Tags are plain `vX.Y.Z` with no leading zeros.

## Release from CI

Push the tag. `.github/workflows/release.yml` validates the tag against
`^(new-cli-)?v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`, packages with
goreleaser in snapshot mode (`SELF_HOST_RELEASE_VERSION` supplies `X.Y.Z`),
smoke-tests the Linux binary, creates a **draft** release, downloads it, compares
every asset with `cmp`, checks the checksums, and only then publishes with
`--latest=false`.

```bash
git tag vX.Y.Z && git push origin vX.Y.Z
```

## Release locally (when CI is unavailable)

Build the same archives with the same pinned goreleaser:

```bash
SELF_HOST_RELEASE_VERSION=X.Y.Z go run github.com/goreleaser/goreleaser/v2@v2.12.7 release --snapshot --clean
```

Then follow what the workflow does: draft, download, compare, publish.

```bash
cd dist
assets=(self-host_X.Y.Z_linux_amd64.tar.gz self-host_X.Y.Z_linux_arm64.tar.gz self-host_X.Y.Z_darwin_amd64.tar.gz self-host_X.Y.Z_darwin_arm64.tar.gz checksums.txt)
shasum -a 256 -c checksums.txt
gh release create vX.Y.Z "${assets[@]}" --target main --draft --title "self-host X.Y.Z" \
  --notes "Linux and macOS amd64/arm64 CLI. WSL2 uses Linux binaries. Native Windows is unsupported."
mkdir -p /tmp/self-host-release-check && gh release download vX.Y.Z --dir /tmp/self-host-release-check --clobber
for a in "${assets[@]}"; do cmp "$a" "/tmp/self-host-release-check/$a"; done
gh release edit vX.Y.Z --draft=false --latest=false
```

`gh release create` of a draft with `--target main` makes the tag when the
release is published; no separate `git tag` is needed.

## Verify

```bash
SELF_HOST_GITHUB_TOKEN="$(gh auth token)" scripts/verify-install.sh   # private repository
scripts/verify-install.sh                                              # public repository
```

It runs the documented `curl | bash` install in a throwaway `HOME` and checks
`--version`, `self-host skill` and a pinned-old-version `self-update`.

## Tag triggers

Two workflows react to release tags: `release.yml` (the release) and `e2e.yml`
(the end-to-end suite); both fire on `v*` and `new-cli-v*`. `ci.yml` has no tag
trigger. The legacy skill pack no longer exists, so a plain `vX.Y.Z` tag is
always a CLI release at that version from the tagged commit.

## Repository rename

The repository will move from `ajnart/selfhost-skills` to `ajnart/selfhost`.
After the GitHub rename, the old URLs redirect and nothing breaks. Then change
`release.Repo` in `internal/release/release.go` and `DEFAULT_REPO` in
`install.sh` (the only two places), and the owner/name literals in the docs.
