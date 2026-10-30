# Releasing the self-host CLI

A CLI release is a GitHub release tagged **`vX.Y.Z`** that carries these assets:

```
checksums.txt
self-host_X.Y.Z_linux_amd64.tar.gz    self-host_X.Y.Z_linux_arm64.tar.gz
self-host_X.Y.Z_darwin_amd64.tar.gz   self-host_X.Y.Z_darwin_arm64.tar.gz
self-host_X.Y.Z_linux_amd64.deb       self-host_X.Y.Z_linux_arm64.deb
self-host_X.Y.Z_linux_amd64.rpm       self-host_X.Y.Z_linux_arm64.rpm
self-host_X.Y.Z_linux_amd64.apk       self-host_X.Y.Z_linux_arm64.apk
self-host_X.Y.Z_linux_amd64.pkg.tar.zst  self-host_X.Y.Z_linux_arm64.pkg.tar.zst
PKGBUILD
```

The installer and `self-host self-update` pick the highest semver among
non-draft, non-prerelease releases that carry `checksums.txt` and a
`self-host_<version>_*.tar.gz`; releases without them are never chosen. The
legacy skill-pack releases `v1.0.0`, `v1.1.1` and `v1.1.2` and their tags were
deleted on October 24, 2026. The CLI does not read GitHub's "Latest" badge;
publish every `vX.Y.Z` release with `--latest` anyway.

Releases up to 0.2.0 were tagged `new-cli-vX.Y.Z`, from when the Go CLI lived
in a `new-cli/` folder next to the TypeScript product, and CLI 0.2.x and older
only look for that prefix. Until 0.5.10 every release had a byte-identical
`new-cli-v` twin for them. No twins are made after 0.5.10: an old binary
self-updates to `new-cli-v0.5.10`, which reads `vX.Y.Z` tags and updates again.
The installer, `self-update` and the site still read the old tags, so pinned
old versions keep installing.

## Prepare

1. Work from a clean `main` that passes the gate in CLAUDE.md ("Local gate"):
   `gofmt -l .` prints nothing, `go build ./... && go vet ./... && go vet -tags e2e ./e2e/`,
   `go test ./...`, `go test -race ./internal/tui/ ./internal/activity/`, `bash -n install.sh`.
2. Pick the next version. Tags are plain `vX.Y.Z` with no leading zeros.

The Telemetry project key (public; ADR 0006) is set at build time from
`POSTHOG_PROJECT_KEY`, and `.goreleaser.yaml` falls back to the project's key
when it is unset. Leave it unset, locally and in `release.yml`: an empty value
replaces the key, and the binary sends nothing. Check with `grep -c phc_ dist/self-host_*/self-host`.

## Release from CI

Releases are cut locally (next section), because every channel publishes from
the `dist/` that built the release, and a CI build would not match it byte for
byte. When the tag of a release published that way arrives, `release.yml` does
not rebuild: it downloads the published assets, checks them against
`checksums.txt`, checks that every binary embeds the Telemetry key, and smoke-tests
the Linux binary. To check a release again, run the workflow from the Actions
tab with its tag.

The rest of this section describes a tag pushed with no release yet, which the
workflow publishes itself; the channels then still need a `dist/` that matches it.

For release-note images, follow
[the release-visual skill](../.claude/skills/release-visual/SKILL.md).
It compares the previous CLI tag with the release ref and renders the Logo hub
only when Apps were added. Upload the PNG and animated SVG as release assets;
embed the PNG in the notes and link the animation separately.

Push the tag. `.github/workflows/release.yml` validates the tag against
`^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`, packages with
goreleaser in snapshot mode (`SELF_HOST_RELEASE_VERSION` supplies `X.Y.Z`),
smoke-tests the Linux binary, creates a **draft** release, downloads it, compares
every asset with `cmp`, checks the checksums, and only then publishes it, as
Latest for a `vX.Y.Z` tag.

```bash
git tag vX.Y.Z && git push origin vX.Y.Z
```

## Release locally

Build the same archives with the same pinned goreleaser (v2.18.3 needs Go 1.27.1 or newer; Go downloads that toolchain on first use):

```bash
SELF_HOST_RELEASE_VERSION=X.Y.Z go run github.com/goreleaser/goreleaser/v2@v2.18.3 release --snapshot --clean
```

Then follow what the workflow does: draft, download, compare, publish.

```bash
cp dist/aur/self-host-bin.pkgbuild dist/PKGBUILD
cd dist
assets=(self-host_X.Y.Z_linux_amd64.tar.gz self-host_X.Y.Z_linux_arm64.tar.gz self-host_X.Y.Z_darwin_amd64.tar.gz self-host_X.Y.Z_darwin_arm64.tar.gz self-host_X.Y.Z_linux_{amd64,arm64}.{deb,rpm,apk,pkg.tar.zst} PKGBUILD checksums.txt)
shasum -a 256 -c checksums.txt
gh release create vX.Y.Z "${assets[@]}" --target "$(git rev-parse HEAD)" --draft --title "self-host X.Y.Z" \
  --notes "Linux and macOS amd64/arm64 CLI. WSL2 uses Linux binaries. Native Windows is unsupported."
mkdir -p /tmp/self-host-release-check && gh release download vX.Y.Z --dir /tmp/self-host-release-check --clobber
for a in "${assets[@]}"; do cmp "$a" "/tmp/self-host-release-check/$a"; done
gh release edit vX.Y.Z --draft=false --latest
```

`gh release create` of a draft with `--target` makes the tag when the release is
published; no separate `git tag` is needed. The target is the full commit sha
the `dist/` was built from, never `main`, which may have moved on.

## Publish the channels

Every channel repackages the release archives from the same `dist/` (never a
rebuild), so each installs the release binary byte for byte. Once the `vX.Y.Z`
release is published, from the checkout that built it:

```bash
scripts/publish-channels.sh X.Y.Z
```

It runs, in order, `publish-docker.sh`,
`publish-homebrew.sh` and `publish-site.sh`, stops at the first failure, and each script refuses a
draft release or a `dist/checksums.txt` that differs from the published one, so
a rerun is safe. Each
script also runs alone, with `--dry-run` for Docker.

| Channel  | Needs once                                                                                                | Works while the repo is private                                                                |
| -------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Docker   | `docker login ghcr.io -u ajnart` with `write:packages`; make the GHCR package public after the first push | yes                                                                                            |
| Homebrew | the public `ajnart/homebrew-tap` repo                                                                     | no, the cask downloads release assets ([#295](https://github.com/ajnart/self-host/issues/295)) |
| AUR      | an AUR account (registration is closed for now)                                                           | no                                                                                             |

### npm

Not published. npm only allows unattended publishing through trusted
publishing (OIDC) from GitHub Actions or GitLab; 2FA-bypass tokens last at most
90 days and lose direct publishing in January 2027. Now that the repository is
public, a trusted-publishing job in `release.yml` could publish from the release
archives.

### Docker image

`scripts/publish-docker.sh X.Y.Z [--dry-run]` builds `ghcr.io/ajnart/self-host`
for linux/amd64 and linux/arm64 from the archives (alpine + Docker CLI + Compose
plugin, about 130 MB) and pushes `:X.Y.Z` and `:latest`. `--dry-run` builds the
host architecture locally and pushes nothing.

### AUR package

AUR account registration is closed for now, so `self-host-bin` is not on the
AUR. Every goreleaser run still writes its `PKGBUILD` and `.SRCINFO`, pinned to
that run's archive hashes, into `dist/aur/`; the `PKGBUILD` ships as a release
asset so Arch users can `makepkg -si` it, and the `.pkg.tar.zst` covers `pacman -U`.
When registration reopens:

1. Create the `ajnart` account at <https://aur.archlinux.org/register> with the
   public key `~/.ssh/aur.pub` (`~/.ssh/config` already points
   `aur.archlinux.org` at it).
2. Run `scripts/publish-aur.sh X.Y.Z`; the first run claims the empty
   `self-host-bin` repo. Same guards as the other channels.
3. Add `publish-aur.sh` back to `publish-channels.sh` and the AUR line to the
   README and the site's install methods.

## Linux packages

Every goreleaser run also builds `.deb`, `.rpm`, `.apk` and Arch `.pkg.tar.zst` packages (nfpm) that
install `/usr/bin/self-host`. The `.deb` and `.apk` recommend `docker`, the `.rpm` suggests it, and the
Arch package depends on `docker` and `docker-compose` (nfpm cannot write optdepends). They are
release assets listed in `checksums.txt`; the installer and `self-update` only read
the `.tar.gz` lines and ignore them.

```bash
sudo apt install ./self-host_X.Y.Z_linux_amd64.deb
sudo dnf install ./self-host_X.Y.Z_linux_amd64.rpm
sudo apk add --allow-untrusted ./self-host_X.Y.Z_linux_amd64.apk
sudo pacman -U ./self-host_X.Y.Z_linux_amd64.pkg.tar.zst
```

They are unsigned and not in an apt/dnf repository; users download them from the
release page.

## Homebrew tap

`brew install ajnart/tap/self-host` installs the cask goreleaser writes to
`dist/homebrew/Casks/self-host.rb` (pinned to that run's archive hashes). It is a
cask rather than a formula because goreleaser deprecates `brews` in favour of
`homebrew_casks`; the generated cask covers macOS (amd64/arm64; Homebrew casks do not support Linux) with the
same archives. The binary is unsigned, so the cask's post-install hook strips
`com.apple.quarantine` on macOS (without it Gatekeeper reports the binary as
damaged). Once the `vX.Y.Z` release is published:

```bash
scripts/publish-homebrew.sh X.Y.Z
```

Same guards as the other channels (not a draft, `dist/checksums.txt` matches the
published one); it commits `Casks/self-host.rb` to `ajnart/homebrew-tap` and pushes.
The cask needs anonymously downloadable release assets
([#295](https://github.com/ajnart/self-host/issues/295)).

The tap repo [ajnart/homebrew-tap](https://github.com/ajnart/homebrew-tap) exists.

## Verify

```bash
SELF_HOST_GITHUB_TOKEN="$(gh auth token)" scripts/verify-install.sh   # private repository
scripts/verify-install.sh                                              # public repository
```

It runs the documented `curl | bash` install in a throwaway `HOME` and checks
`--version`, `self-host skill` and a pinned-old-version `self-update`.

`scripts/publish-channels.sh` already ends with `publish-site.sh`, so self-host.fyi
shows the new version once it succeeds; redeploy by hand only if you skipped it.

## Tag triggers

Two workflows react to release tags: `release.yml` (the release) and `e2e.yml`
(the end-to-end suite); both fire on `v*`. `ci.yml` has no tag
trigger. The legacy skill pack no longer exists, so a plain `vX.Y.Z` tag is
always a CLI release at that version from the tagged commit.

## Repository rename

The repository is `ajnart/self-host`; it was `ajnart/selfhost-skills` until
October 13, 2026. GitHub redirects the old name, so binaries and installers
built before the rename still find releases. The installer, self-update, the
agent guide and the site builder all default to `ajnart/self-host`.

## Installer site

Cloudflare Pages serves the site at `https://self-host.fyi` from the Git-connected
project `self-host-fyi` (apex and `www` are proxied CNAMEs in the `self-host.fyi`
zone). Deploying changes no Project and publishes no release archives. Use managed
Wrangler authentication (`wrangler whoami`), never extract tokens.

### Automatic deploys (Git integration)

The Pages project `self-host-fyi`, connected to `ajnart/self-host` with
Cloudflare's GitHub app, rebuilds the site when a push to `main` changes one of
its watch paths, and makes a preview for other branches. GitHub Actions is
not involved. Its build settings:

| Setting                | Value                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production branch      | `main`                                                                                                                                            |
| Build command          | `bash scripts/build-site-pages.sh`                                                                                                                |
| Build output directory | `site/dist-pages`                                                                                                                                 |
| Root directory         | (repository root)                                                                                                                                 |
| Build watch paths      | include `site/*`, `dcm/*`, `tools/sitegen/*`, `install.sh`, `scripts/build-*`, `docs/telemetry.md`, `video/reel/assets/agents/*`, `package.json`, `bun.lock`, `turbo.json` |
| `BUN_VERSION`          | `1.4.3`                                                                                                                                           |
| `GITHUB_TOKEN` secret  | optional; without it the build reads the newest `vX.Y.Z` tag of the Go CLI from the checkout, since the releases API is private while the repo is |

A release does not push to `main`, so the site would keep showing the old
version: `scripts/publish-channels.sh` ends with `scripts/publish-site.sh X.Y.Z`,
which builds the site, checks it shows the new version and deploys it to the
same project with Wrangler. The apex is the project's only custom domain;
`www` is a zone redirect rule to the apex.

### Manual deploy (Direct Upload)

```bash
stage="$(mktemp -d)"
bash scripts/build-installer-site.sh "$stage/deploy"
wrangler pages deploy "$stage/deploy/public" --project-name self-host-fyi --branch main
```

The repository is a bun workspace (`site`, `dcm`) with turbo at the root:
`bun install --frozen-lockfile` runs once at the root (`bun.lock` there only),
and `bunx turbo run build test test:compose lint check` runs the web checks that
`ci.yml`'s `web` job also runs. The `test` job checks that the generated
`site/src/data`, `dcm/src/data` and `site/src/styles` are committed.
`site/` is a static Astro project (`bun run dev`, `bun run check` inside
it) that also renders Docker Compose Maker at `/compose`. Its definitions come from the Go code:
`go run ./tools/sitegen` writes `site/src/data/catalog.json` from the
Catalog and `site/src/styles/theme.css` from the Dashboard's dark palette.
`src/lib/catalog.ts` is the one typed model of the catalog, shared by the
build and the browser playground; the `apps` content collection validates it
with a schema, so a generator change that breaks the shape fails the build.
From it Astro renders the landing page, one page per App under `/apps`,
`/catalog.json`, `/llms.txt`, the sitemap and `robots.txt`.
Starlight serves the docs at `/docs` from `src/content/docs/docs/`, plus one
page per Recipe under `/docs/recipes`; `src/lib/docs-route.ts` strips `.html`
from its links and adds share tags. `src/pages/og/` renders every page's
1200×630 share image with sharp at build time (App icons are fetched from the
icon CDN, with the App's initial as fallback); the landing keeps
`src/assets/og.png`.
`go run ./tools/introframes` writes `site/public/intro.json`, the onboarding
Intro recorded from `internal/intro`. The theme makes the site's
accent and state colours the CLI's. `GITHUB_TOKEN=$(gh auth token) bun run stars`
at the root writes `site/src/data/stars.json`, the GitHub stars that
order Apps by popularity, and `dcm/src/data/stars.json` for DCM's Containers;
give a new App its repository in `tools/sitegen/stars.go`, or it
sorts last.

The version the site shows is looked up at build time the way the installer
picks a release: the highest stable `vX.Y.Z` release on GitHub that carries
`checksums.txt` and the `self-host_*` archives. The build uses `GITHUB_TOKEN`
or `gh auth token` while the repository is private, and fails rather than show
a stale version; `SELF_HOST_SITE_VERSION` overrides it. **Redeploy the site
after every release** so the page and the playground show the new version.

Nothing reads a `wrangler.toml`: the Git integration takes its settings from the table above, and every Wrangler call here passes `--project-name self-host-fyi`. `public/_headers` sets `nosniff`,
`no-referrer`, `frame-ancestors`, plain-text types for the installer and CORS
for `catalog.json`; Astro adds the rest of the Content Security Policy as a
`<meta>` tag with hashes (`security.csp` in `astro.config.mjs`). Starlight's
inline scripts are hashed from its installed components, its inline `style`
attributes are allowed by hash through `'unsafe-hashes'`, and `img-src` allows
`data:` for its search icons; `src/lib/csp.mjs` fails the build when any inline
script, style or style attribute is not covered. Pages move
with native cross-document view transitions, which need no script and work
under that policy; Astro's `<ClientRouter />` does not support its CSP.
`404.astro` makes unknown paths such as `/go.mod` return 404.

### Docker Compose Maker at /compose

Docker Compose Maker (`dcm/`, merged from `ajnart/dcm`) is part of the one
site build and is served by the same Pages project at
`https://self-host.fyi/compose`: its pages are `site/src/pages/compose/` and
`dcm/` holds the components and libraries they use. The build lands as
`public/compose.html` plus `public/compose/` (`/compose/templates`,
`/compose/template/<id>`). The site is fully static: there are no Pages
Functions, so there is no `_routes.json` and no binding to configure. The
`_astro/*` immutable cache rule in the site's `_headers` covers DCM's assets too.

The site's Content Security Policy is the hashed one from `astro.config.mjs`.
`/compose` alone widens it for Monaco: scripts, styles and fonts from the
jsDelivr CDN, `data:` fonts, `blob:` workers and `'unsafe-inline'` for
`style-src-elem` and `style-src-attr`, because Monaco injects `<style>`
elements and `style` attributes at runtime. `/`, `/apps` and `/docs` keep the
strict policy; tighten `/compose` only together with self-hosting Monaco.

`scripts/publish-site.sh` refuses to deploy a build that has no `/compose` page.

GitHub star counts are committed, not fetched at build time:
`.github/workflows/stars.yml` runs `bun run stars` weekly (and on demand) and
opens a pull request with the refreshed `site/src/data/stars.json` and
`dcm/src/data/stars.json`. That needs the repository setting
Settings → Actions → General → "Allow GitHub Actions to create and approve
pull requests". Pull requests opened with `GITHUB_TOKEN` (the stars refresh and
`dcm-add-container.yml`) do not trigger `ci.yml`: close and reopen the pull
request, or push to its branch, to run CI before merging.

The standalone `dcm` Pages project is retired: its `wrangler.toml` and
`scripts/build-dcm-pages.sh` are gone. After the merge `compose.ajnart.dev`
(zone `ajnart.dev`) and `compose.homarr.dev` (zone `homarr.dev`) should not
serve their own copy. On each zone add two Single Redirects, 301, "Preserve
query string", for that host, in this order:

| Rule | When                                     | Redirect to                                                        |
| ---- | ---------------------------------------- | ------------------------------------------------------------------ |
| 1    | `http.request.uri.path eq "/"`           | static `https://self-host.fyi/compose`                             |
| 2    | any other path on the host               | dynamic `concat("https://self-host.fyi/compose", http.request.uri.path)` |

The site uses no trailing slash, so the root must not become `/compose/`. DCM's
own paths (`/template/<id>`) are the same under `/compose`. Check with
`curl -I "https://compose.ajnart.dev/?x=1"` and
`curl -I https://compose.homarr.dev/template/recipe-full`.

The image `ghcr.io/ajnart/dcm` is built by `.github/workflows/dcm-image.yml` on
pushes to `main` that touch `dcm/**`, `site/**`, `tools/sitegen/**`,
`docs/telemetry.md`, `video/reel/assets/agents/**`, `LICENSE`, `package.json`,
`turbo.json`, `bun.lock` or the workflow, on manual runs, and on `dcm-v*` tags
(`dcm-v1.2.3` pushes `1.2.3`, `1.2`, `1` and `latest` comes from `main`; path
filters do not apply to tag pushes). CLI `vX.Y.Z` tags never trigger it. The
workflow runs `bunx turbo run test test:compose build` and packs `site/dist`
(the named build context `site`, with the repository root as the main
context) into a busybox static server on port 7576. busybox is pinned by
digest in `dcm/Dockerfile`; `dcm/Dockerfile.dockerignore` limits the root
context to the licenses and `dcm/httpd.conf`. The three platforms need no
QEMU: the only stage that runs commands uses the build platform, and the final
stage has no `RUN`.

The image serves the same site as Pages with these differences:

- `X.html` is moved to `X/index.html`, so `/compose/templates` redirects to
  `/compose/templates/` (busybox cannot serve extensionless `.html`), and `/`
  is a small page that forwards to `/compose/` with the query and hash kept.
- `og/`, `reel.mp4`, `reel.jpg` and `_headers` are dropped. busybox cannot add
  headers, so the image sends no `nosniff` or other `_headers` rules; the
  Content Security Policy still applies through its `<meta>` tag.
- `dcm/httpd.conf` maps the extensions busybox does not know (`.js`, `.json`,
  `.svg`, `.webmanifest`, `.xml`, `.md`, `.txt`, `.pagefind`, `.pf_*`) and
  serves `404.html` for unknown paths.
- It runs as `USER 65534:65534` and carries `LICENSE-Apache-2.0.txt`,
  `LICENSE-AGPL-3.0.txt` and `SOURCE.txt` (repository URL and the commit,
  from the `REVISION` build argument) at `/`. The OCI labels name the licenses
  (`AGPL-3.0-only AND Apache-2.0`), the source and the revision.

To try it locally, after `bun run --cwd site build`:

```bash
docker buildx build --load --build-context site=site/dist \
  --build-arg REVISION="$(git rev-parse HEAD)" -t dcm-test -f dcm/Dockerfile .
docker run --rm -p 7576:7576 dcm-test
```

The `Latest CLI release` step in the workflow sets `SELF_HOST_SITE_VERSION` from
the newest release, because turbo cannot hash the GitHub lookup the site build
does and a cache hit would otherwise show a stale version.

Issue-driven container submissions are handled by `dcm-add-container.yml`,
which validates the form (Container ID, `https://` URLs), adds the container to
`dcm/src/tools/` and opens a pull request.

The old `selfhost.ajnart.dev` host keeps working for installs already in the
wild: a Cloudflare redirect rule on the `ajnart.dev` zone sends it, path and
query preserved, to `concat("https://self-host.fyi", http.request.uri.path)`
with a 301. A second rule on the `self-host.fyi` zone does the same for `www`.
Check with `curl -I https://selfhost.ajnart.dev/install.sh`.

The builder needs `bun`. It runs `bun install --frozen-lockfile` at the
repository root and `astro build` straight into `public/` (DCM included, under
`public/compose/`), adds `install`, `install.sh` and
`install.sh.sha256`. The showreel reaches
the build as the committed file `site/public/reel.mp4`, which Astro copies.
Renders in `video/reel/out/` are git-ignored; after a new render, copy the
mp4 over `site/public/reel.mp4` and commit that. It refuses a
destination inside the checkout or one that exists; only Astro's output and the
installer are published, never the repository. To preview the exact published
tree locally:

```bash
stage="$(mktemp -d)"
bash scripts/build-installer-site.sh "$stage/deploy"
python3 -m http.server 8000 --directory "$stage/deploy/public"
```

After a confirmed rename, `SITE_RELEASE_REPO=ajnart/self-host` explicitly selects
the new repository; that option requires `gh` to confirm the name exists.
The installer is served twice, as `/install` (the address the product prints)
and `/install.sh`, byte-identical, both covered by `install.sh.sha256`.

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
[#193](https://github.com/ajnart/self-host/issues/193),
[#194](https://github.com/ajnart/self-host/issues/194) or
[#295](https://github.com/ajnart/self-host/issues/295). Anonymous archive
installation, self-update and any required live rename redirect remain external
verification gates.

References: [Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/),
[headers](https://developers.cloudflare.com/pages/configuration/headers/) and
[custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/).

Earlier deployment evidence (October 11, 2026) lives in git history.
