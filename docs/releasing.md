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

The Telemetry project key (public; ADR 0006) is set at build time from
`POSTHOG_PROJECT_KEY`: the CI release reads it from the repository variable of
that name, and a local release needs it exported. Without it the binary is built
with the placeholder key and sends nothing.

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

The repository remains private at `ajnart/selfhost-skills`. The installer,
self-update, skill and site builder keep that current default. The proposed
`ajnart/selfhost` target did not resolve in the October 11, 2026 evidence below.
Merge the useful site source independently of the rename; change defaults only
after the maintainer confirms the new repository exists. A visibility change
remains the maintainer's separate decision, not a prerequisite for hosting this
site.

After the rename, check the old repository's API redirect with an old release
binary. Its fake 301 test is not a live redirect check. Issue #194 additionally
requires a successful token-free `scripts/verify-install.sh`; do not close it
on the strength of the site's HTTP status.

## Installer site

`site/wrangler.toml` binds only `selfhost.ajnart.dev`, with `workers.dev` and
preview URLs disabled. Cloudflare Workers serves static assets without a
GitHub connection, token, backend or source checkout. Deployment changes no
Project and publishes no release archives.

Use managed Wrangler authentication (`wrangler whoami`), never extract tokens.
Before attaching the custom domain, check the active `ajnart.dev` zone, the
exact hostname's DNS records and Worker domain bindings. Stop on a foreign
record or binding instead of overwriting it. Let the custom domain create its
own DNS record and certificate; do not create a second DNS record.

Build into a new directory outside the checkout. The builder copies only
`index.html`, `site.css`, `js/*.js`, `catalog.js`, `catalog.json`, `logo.svg`, `og.png`, `intro.json`, `reel.jpg`, the icons, `site.webmanifest`, `_headers`, the
showreel from `video/reel/out/selfhost-reel.mp4` as `reel.mp4`,
`install.sh` and `install.sh.sha256` into `public/`. `catalog.js` feeds the
landing page's browser playground; regenerate it with
`go run ./tools/sitecatalog` after catalog changes, and `intro.json`, the
onboarding Intro recorded from `internal/intro`, with `go run ./tools/introframes`. It refuses an existing destination and never copies the repository,
hidden files, service configurations or binaries. The default build uses
`ajnart/selfhost-skills` without GitHub authentication:

```bash
stage="$(mktemp -d)"
bash scripts/build-installer-site.sh "$stage/deploy"
wrangler deploy --cwd "$stage/deploy" --dry-run
wrangler deploy --cwd "$stage/deploy"
```

After a confirmed rename, `SITE_RELEASE_REPO=ajnart/selfhost` explicitly selects
the new repository; that option requires `gh` to confirm the name exists.
Deploying the prepared installer does not make private GitHub releases public.
The landing page deliberately says public downloads are unavailable; keep it
that way until anonymous install and self-update pass.

Download `/install.sh` and `/install.sh.sha256` anonymously into a throwaway
directory and run `shasum -a 256 -c install.sh.sha256`. This validates the
served script, not the release archives. Then run the existing verifier with
no token and the current release repository. It isolates `HOME`, the install
directory and GitHub login state; it never installs Apps. A private release
API or checksum returning 404 is a blocker, not a passing install.

Public artifact distribution, if later authorized, needs reproducible builds,
verified archives and checksums, and a release lookup usable by both the
installer and `self-update`. A mirror cannot fix existing release binaries'
GitHub defaults merely by serving the installer. Publish neither authenticated
GitHub responses nor credentials to work around that boundary.

Source merge does not close the remaining release acceptance in
[#193](https://github.com/ajnart/selfhost-skills/issues/193),
[#194](https://github.com/ajnart/selfhost-skills/issues/194) or
[#295](https://github.com/ajnart/selfhost-skills/issues/295). Anonymous archive
installation, self-update and any required live rename redirect remain external
verification gates. The evidence below describes the earlier deployed version;
this source update does not redeploy it or publish a new CLI release.

References: [static assets](https://developers.cloudflare.com/workers/static-assets/get-started/)
and [custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

### Deployment evidence, October 11, 2026

- Worker `selfhost-installer`, version `5fd5421a-313a-4c5b-9b1d-145791dd4920`,
  serves only the allowlisted assets at `https://selfhost.ajnart.dev`.
- The active zone and exact hostname had no record or Worker binding before
  deployment. The custom domain created one owned proxied record. No other
  hostname, repository visibility or Project changed.
- Public Cloudflare and Google DNS resolved the hostname. This machine's
  normal HTTPS resolver retained a negative lookup; anonymous HTTPS checks used
  `curl --resolve` with the returned public address and normal TLS verification.
- Landing, installer and installer checksum returned 200. The downloaded script
  matched the staged script byte-for-byte; `shasum -a 256 -c` and `bash -n` passed.
  `/AGENTS.md`, `/go.mod` and an unpublished release checksum path returned 404.
- Token-free `scripts/verify-install.sh` against the live installer failed at
  private GitHub release lookup. For this check a temporary curl wrapper used
  the public DNS address; `VERIFY_EXPECTED_VERSION=0.2.0` skipped only discovery
  of the expected version. Latest and pinned installation failed and no binary
  was installed. A locally built versioned binary's isolated `self-update` also
  returned the private release API's 404; this is not a published-artifact test.
- [Artifact distribution blocker #295](https://github.com/ajnart/selfhost-skills/issues/295)
  tracks that failure separately. No archives or release metadata were published.
  Issue #194's token-free acceptance and live old-name redirect remain unmet.

### Normal-client follow-up, October 11, 2026

The parent session independently repeated the anonymous reads with normal-host
`curl --disable`, no authorization and valid TLS, without `--resolve`:

| Address                                         | HTTP status | Body bytes |
| ----------------------------------------------- | ----------- | ---------- |
| `https://selfhost.ajnart.dev/`                  | 200         | 1604       |
| `https://selfhost.ajnart.dev/install.sh`        | 200         | 15983      |
| `https://selfhost.ajnart.dev/install.sh.sha256` | 200         | 77         |
| `https://selfhost.ajnart.dev/AGENTS.md`         | 404         | 0          |
| `https://selfhost.ajnart.dev/go.mod`            | 404         | 0          |

The served installer SHA256 matched the served checksum:
`d4e064cbc5d1df531697a03bf303d8bf241f3c8246e1f6382f1aa5c9214398fe`.
This resolves only the initial normal-client DNS observation; the earlier
negative lookup and `--resolve` evidence above remain historical facts.

Both `https://api.github.com/repos/ajnart/selfhost-skills/releases/latest` and
`https://api.github.com/repos/ajnart/selfhost/releases/latest` returned anonymous 404. Authenticated metadata still identified `ajnart/selfhost-skills` as private
with default branch `main`; the intended `ajnart/selfhost` returned 404. The
parent recorded this follow-up on #295.

These were transport and script-checksum reads, not installer execution or
anonymous release-archive acceptance. Artifact distribution, rename, token-free
install, self-update and publication holds remain. No deployment, installer,
binary, build, runtime or source changes accompany this documentation refresh.
The reviewed production commit remains
`d3d3e78c48c7b5004372c396f5483faaf40c2bed`.
