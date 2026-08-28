# Browser/research harness evaluation

Date: 2026-08-28  
Repository: `auto-stack` at `main` (`513845e`)  
Scope: read-only evaluation of the repository runbook, installed
`browser-harness`, and isolated `agent-browser` against representative
self-hosting research tasks. No Docker workload was started, no tests/builds
were run, and no `.sessions`, secret, or other repository file was modified.

## Executive result

The repository has a good *deployment* harness, not a general research
harness. `PROMPT.md`, the ordered `prompts/` modules, the service notes under
`docs/`, `scripts/session.sh`, and `docker-compose.yml` form a coherent
run-scoped media-stack workflow. The browser portion is still prose plus
remembered selectors; there is no repository-local command that discovers
official sources, extracts a Compose contract, checks links/status, or tracks
software lifecycle.

The installed `browser-harness` is not usable in this environment without a
user-started Chrome/CDP endpoint. The isolated `agent-browser` path is more
appropriate for concurrent research: named sessions, accessibility refs,
Markdown-aware reads, status-aware JSON output, waits, and domain allowlists.
It still needs a thin, secret-aware research adapter.

## Harness inventory

### Repository harness

- [`PROMPT.md`](../PROMPT.md) defines unique run IDs, the seven-service target,
  browser-only stages, no-media-mutation proof, and secret-free evidence.
- [`docs/README.md`](../docs/README.md) requires the live browser skill, a
  run-scoped browser session, fresh URL resolution, and re-snapshotting. It
  explicitly warns that root-level guides are historical and may contain stale
  ports/UI refs.
- [`scripts/session.sh`](../scripts/session.sh) owns the useful deployment
  primitives: managed ports, per-run project/network names, private state,
  lock files, mode/owner/realpath validation, atomic staging, and sanitized
  environment projection.
- [`docker-compose.yml`](../docker-compose.yml) keeps host bindings on
  loopback, uses service-name DNS and a private project network, and defines
  health checks. Host ports and the qBittorrent WebUI port are variables, not
  fixed defaults.
- `scripts/render-prompt.sh` compiles ordered modules, but does not validate
  external links, source freshness, image tags/digests, or stale selectors.
- There is no checked-in `selfhost-research` capability, URL/source registry,
  Compose parser, lifecycle checker, or status-aware link checker at the time
  of this evaluation. The existing scripts target this media deployment and
  intentionally require its run ID and Docker state.

### Installed tools

Read-only commands and outcomes:

```text
browser-harness --version
0.1.9

browser-harness --doctor
[FAIL] chrome running — start chrome/edge
[FAIL] daemon alive — see install.md
[FAIL] active browser connections — 0
[FAIL] Browser Use cloud auth — optional: browser-harness auth login

browser-harness <<'PY'
print(page_info())
PY
browser-harness: chrome-not-running: no supported browser is running and none could be launched

browser-harness recordings
auto-recording: off (default); active: none; latest: none

browser-harness telemetry status
enabled: true
```

The basic `browser-harness` path was therefore blocked before navigation. It
also announced `0.1.9 -> 0.1.10`; no update was installed. Its own skill
describes a default shared local Chrome/CDP connection (`new_tab`, no local
browser ID) and recommends a named Browser Use cloud daemon for isolation.
That contract differs from the repository's `AGENT_BROWSER_SESSION` contract
and is a poor default for parallel candidates unless the caller supplies an
isolated remote browser.

`agent-browser` version check:

```text
mise exec node@24 -- npx --no-install agent-browser --version
agent-browser 0.34.0
```

The required live skill was loaded in full with:

```text
mise exec node@24 -- npx agent-browser skills get core --full
```

The first isolated launch failed because Chromium had no usable sandbox. The
documented retry worked with `--args '--no-sandbox'`. The browser daemon also
needed elevated host execution because `/run/user/1000/agent-browser` is not
writable inside the default sandbox; this is an environment prerequisite, not
a stack failure.

## Exercised tasks and evidence

The session name was generated as follows and was not restored or persisted:

```text
mise exec node@24 -- npx --no-install agent-browser session id \
  --scope worktree --prefix browser-harness-evaluation
=> browser-harness-evaluation-339c1029f093
```

The effective prefix for the following commands was:

```text
mise exec node@24 -- npx --no-install agent-browser \
  --session browser-harness-evaluation-339c1029f093 \
  --allowed-domains 'homarr.dev,*.homarr.dev,docs.docker.com,*.docker.com,jellyfin.org,*.jellyfin.org,hotio.dev,*.hotio.dev,docs.seerr.dev,*.seerr.dev,wiki.servarr.com,*.servarr.com,github.com,*.github.com' \
  --args '--no-sandbox'
```

The session was closed with the same `--session` plus `close`. Before closing,
`session info --json` reported `version: 0.34.0`, `restoreStatus:
not_configured`, `restoreKey: null`, and `saveStatus: not_configured`; the
session then returned `Browser closed`.

### 1. Official install-doc discovery — PASS

Exact commands:

```text
... open https://homarr.dev/docs/getting-started/installation/docker/
... read https://homarr.dev/docs/getting-started/installation/docker/ --outline
```

Outcome: page title `Docker | Homarr documentation`, HTTP-backed source was
`https://homarr.dev/docs/getting-started/installation/docker/`, and the
outline discovered both `Docker compose` and `Docker standalone`, each with
prerequisites, installation, updating, and uninstalling sections. This is a
useful two-stage pattern: outline first, then a filtered read of the relevant
section.

The filtered official standalone read returned a complete `docker run`
example, including `7575:7575`, `/appdata`, the optional Docker socket, and a
required encryption-key placeholder. It also states that Compose is easier and
recommended for beginners.

### 2. Compose ports/volumes/environment extraction — PASS with redaction gap

Official Docker source, exact filtered reads:

```text
... open https://docs.docker.com/compose/gettingstarted/
... read https://docs.docker.com/compose/gettingstarted/ --outline
... read https://docs.docker.com/compose/gettingstarted/ \
    --filter 'Step 2: Define and start your services'
... read https://docs.docker.com/compose/gettingstarted/ \
    --filter 'Step 5: Persist data with named volumes'
```

The official example was extracted correctly:

| Service | Ports | Environment | Volumes / related state |
| --- | --- | --- | --- |
| `web` | `${APP_PORT}:5000` (the text explains the example host value is 8000) | `REDIS_HOST=${REDIS_HOST}`, `REDIS_PORT=${REDIS_PORT}` | no volume in the first example |
| `redis` | none | none | `redis-data:/data`; top-level `volumes: redis-data:` in the persistence step |

The same persistence read exposed the important lifecycle semantics: named
volumes survive `compose down`/`up`, while `compose down -v` intentionally
deletes them. The example also adds a Redis health check and a
`depends_on`/`service_healthy` gate.

The official Homarr page was also inspected as the self-hosting-specific
Compose example. Its rendered block contains `homarr`, image
`ghcr.io/homarr-labs/homarr:latest`, optional
`/var/run/docker.sock:/var/run/docker.sock`, `./homarr/appdata:/appdata`,
`SECRET_ENCRYPTION_KEY`, and `7575:7575`. The exact DOM extraction command was:

```text
... eval "Array.from(document.querySelectorAll('pre code')).map((e,i)=>'BLOCK '+i+'\\n'+e.innerText).join('\\n---\\n')"
```

This uncovered a serious safety issue: the page dynamically inserted a
secret-like random value for `SECRET_ENCRYPTION_KEY`, and raw DOM extraction
returned it. The value is deliberately not reproduced here. A research
adapter must redact values for key-like names (and high-entropy token-shaped
strings) before printing, saving, or sending extraction output. For this
reason, `read --filter`/structured parsing is safer than blindly dumping raw
HTML or `eval` results, and the Homarr quick-start Docker socket should not be
copied into this isolated stack. The repository correctly omits that socket
from its Compose file and treats its absence as expected.

### 3. Alternatives with sources — PASS

#### Homarr Compose versus standalone

Official source: [Homarr Docker installation](https://homarr.dev/docs/getting-started/installation/docker/).

The filtered `Docker standalone` read explicitly recommends Compose for
beginners. Compose groups services and named state in a file and updates with
`docker compose down`, `docker compose pull`, and `docker compose up -d`.
Standalone is one `docker run` command with an absolute appdata bind mount but
updates require removing/recreating the container and rerunning the command.
Compose is the better default for a multi-service stack; standalone is a
reasonable simple one-container route when the operator owns path, backup, and
update decisions.

#### Official Jellyfin image versus hotio image

The [official Jellyfin container documentation](https://jellyfin.org/docs/general/installation/container/)
lists `jellyfin/jellyfin` and its GHCR equivalent as official images, and
identifies LinuxServer.io and hotio as unofficial third-party images. It
documents `latest`, major, minor, exact-release, and packaging-build tags, and
warns that container use on Windows/macOS is unsupported for notable features.

**Community evidence, not an upstream guarantee:**
[hotio/jellyfin documentation](https://hotio.dev/containers/jellyfin/) shows
`ghcr.io/hotio/jellyfin`, `8096:8096`, `PUID`, `PGID`, `UMASK`, `TZ`,
`WEBUI_PORTS`, `/config`, and `/data`. The hotio path is operationally
convenient for this repository's UID/GID and shared-data conventions, but its
image user, environment, paths, release cadence, and support boundary must be
recorded separately from Jellyfin's upstream project. The official source
should win for product behavior; the community source is a packaging choice.

### 4. Stale/deprecated software detection — PASS for evidence, GAP in automation

Official Docker Compose source:
[Version and name top-level elements](https://docs.docker.com/reference/compose-file/version-and-name/).
The filtered read says the top-level `version` property is obsolete,
informative only, and causes a warning; Compose validates against the current
schema regardless. A local read-only scan found no `version:` key in the
canonical `docker-compose.yml`, so this particular deprecated field is absent.

The repository does contain an observable stale-data trap:

```text
rg -n '8080|7578|latest' docker-compose.yml docs prompts FINDINGS.md generations
```

`FINDINGS.md` retains historical static Homarr port `7578` and qBittorrent
port `8088`, while the canonical Compose file uses `${HOMARR_PORT}` and
`${QBITTORRENT_PORT}` and the service notes instruct the agent to resolve fresh
ports. `docs/README.md` warns that those root-level guides may be stale, but no
validator enforces that warning. All seven service images in the canonical
Compose file are floating `:latest` tags (Homarr additionally has
`pull_policy: always`), which is acceptable for the disposable experiment but
not deterministic production input.

The [official Seerr release notice](https://docs.seerr.dev/blog/seerr-release/)
(2026-02-10) says the former Jellyseerr and Overseerr teams merged into Seerr
and share one codebase. The current Compose file is aligned with the new
`ghcr.io/seerr-team/seerr` name, but a general catalog needs explicit
`transitioning`/migration aliases so an old “Overseerr” or “Jellyseerr” request
does not create a new obsolete install.

The local stale scan, official Compose deprecation notice, and Seerr migration
notice are all source-backed, but they were assembled manually. The current
harness has no checked-in lifecycle metadata (`checked_at`, status,
replacement, image provenance, digest, or architecture) and no command that
fails on stale ports, deprecated fields, archived projects, or floating tags.

### 5. Link validation — PASS, but `open` alone is insufficient

The following repository-listed official links were checked in one
read-only batch with `batch --json` using `open` and title/url reads:

| URL | Result |
| --- | --- |
| `https://homarr.dev/docs/management/api/` | 2xx navigation; API docs title after wait |
| `https://homarr.dev/docs/management/mcp/` | 2xx; MCP docs |
| `https://docs.seerr.dev/getting-started/docker/` | 2xx; Seerr docs |
| `https://docs.seerr.dev/using-seerr/settings/mediaserver/` | 2xx; Mediaserver Settings |
| `https://wiki.servarr.com/prowlarr` | 2xx; Prowlarr Servarr Wiki |
| `https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0)` | 2xx; qBittorrent wiki |

The exact status-aware negative check was:

```text
... read https://homarr.dev/docs/getting-started/.md#hardware --json
=> {"success":false,"data":null,"error":"Read failed with HTTP 404"}
```

However, `open https://homarr.dev/docs/getting-started/.md#hardware` returned
`success: true` and left the 404 URL active. Therefore navigation success is
not link validity. The Markdown reader also rewrote a normal relative docs
link into a `.md` negotiation URL; preserve/normalize canonical links before
checking them.

One metadata timing issue was reproducible: immediately issuing `get title`
after a Docusaurus `open` sometimes returned the generic site title, while
`wait --load networkidle` followed by `get title` returned the page title.
Every research navigation should use an explicit load/content wait before
metadata extraction.

### 6. Web UI/docs interaction — PASS

On the public Homarr docs page:

```text
... snapshot -i
=> link "Docker standalone" [ref=e67]
... click @e67
... get url
=> https://homarr.dev/docs/getting-started/installation/docker/#docker-standalone
... snapshot -i -c
=> refreshed accessibility tree with the Docker standalone section
```

This exercised the required snapshot -> ref click -> URL verification -> fresh
snapshot loop. Static refs were not reused after the hash navigation.

## Reliability and security gaps

1. **No research adapter.** Deployment scripts are deliberately stack-specific;
   research needs a separate read-only capability for source discovery,
   Compose parsing, alternatives, lifecycle, and links.
2. **Browser contract split.** `browser-harness` expects a shared/default CDP
   Chrome and offers no local isolation; the repository prompts expect
   `agent-browser` named sessions. Pick one adapter or make the distinction
   explicit before parallel work.
3. **Load/status ambiguity.** `open` can report success for a 404, and title
   metadata can be stale until hydration/network idle. Require HTTP status,
   final URL, a content/soft-404 check, and a deterministic wait.
4. **Markdown negotiation can mutate links.** The reader's `.md` fallback is
   useful for docs but can produce non-canonical URLs. Store both source URL and
   final URL and validate canonical links separately.
5. **Extraction can leak generated credentials.** Raw HTML and DOM/eval can
   expose dynamic keys embedded by docs. Never emit raw Compose blocks without
   key-name and entropy redaction; never record HAR/auth state in research.
6. **Static docs drift.** Historical guides still contain fixed ports/UI refs;
   the warning in `docs/README.md` is not a consistency check. Compose image
   tags are floating and no digest/architecture is captured.
7. **No lifecycle/quality provenance.** Official versus community images,
   upstream project versus packager, support level, retirement, checked date,
   and migration replacement are not machine-readable in the runtime harness.
8. **Environment fragility.** Chromium required `--no-sandbox` and host-level
   daemon access in this environment. The research path needs a preflight that
   reports this as a browser prerequisite, not as a service failure.
9. **Privacy default.** `browser-harness telemetry status` reports telemetry
   enabled. Research mode should disclose or disable telemetry where policy
   requires it, without printing install IDs or other local identifiers.

## Reusable patterns

- Use a worktree-scoped session ID, no `--restore`, no profile, no auth state,
  an explicit `--allowed-domains` list, and a `close` trap. Treat the allowlist
  as browser containment only; host/container egress controls are still needed
  for a security boundary.
- Discover with `read --outline`, narrow with `read --filter`, and use
  `read --json` for HTTP status/final URL/content type. Use a fresh
  `snapshot -i` after every page-changing interaction.
- Parse Compose into a redacted normalized record: service, image, host versus
  container port/protocol, volume target/purpose, environment *names*, secret
  references, healthcheck, networks, and restart policy. Never copy secret
  values from a docs page or `.env` file.
- Keep official sources authoritative and label community packaging evidence;
  separate upstream product, image source, tag/digest, architecture, license,
  and support level.
- For lifecycle checks, record `checked_at`, source URL, status (`active`,
  `transitioning`, `verify`, `retired`), replacement/migration URL, and an
  explicit warning for `latest`, archived projects, and deprecated fields.
- For links, normalize Markdown-relative URLs, follow redirects, require 2xx,
  detect soft 404/title pages, and preserve the original source URL for audit.
- Keep the existing deployment boundaries: dynamic per-run ports, service-name
  DNS, loopback publication, no casual Docker socket mount, private secrets,
  and health/readiness checks distinct from process liveness.

## Concrete improvements

### P0 — add a read-only `selfhost-research` capability

Implement a thin capability rather than another deployment implementation. Its
contract should accept a task/source allowlist and emit a Markdown/JSON report
with exact command, source, timestamp, status, final URL, title, extracted
fields, confidence, and limitations. It should default to isolated
`agent-browser`; use `browser-harness` only when an explicit isolated CDP/cloud
endpoint is supplied.

### P0 — enforce safe extraction and status-aware links

Add one redaction layer before output (secret names such as key/password/token,
high-entropy token patterns, private URLs, cookies, and auth headers), plus a
structured Compose extractor that retains only secret references. Add a link
checker that uses `read --json`/HTTP status, canonicalizes `.md` fallbacks,
follows redirects, and rejects 404/soft-404 results. Make navigation waits
mandatory before title/text capture.

### P1 — add lifecycle/source metadata

Represent upstream URL, docs URL, image source, tag/digest policy,
architectures, `checked_at`, support level, retirement/migration state, and
replacement source separately. Flag mutable `latest` and deprecated Compose
fields during plan review. Preserve community evidence as labelled context,
never as an official support claim.

### P1 — add drift/preflight checks

Scan canonical and historical docs for fixed ports, remembered selectors,
obsolete names, and deprecated fields. Compare only against the generated
manifest (never assume a host port). Add a browser preflight for Chrome/CDP,
sandbox requirements, domain allowlist, no persistence/auth, and teardown.

### P2 — add safe UI research fixtures

Keep one public docs fixture for outline/filter and snapshot/click/resnapshot,
plus optional local-app fixtures behind explicit run URLs. Record browser
evidence separately from deployment acceptance; an HTTP 200 page or a live
container is not configuration proof.

## Validation boundary

This report intentionally did not run Docker, Compose, tests, builds, browser
auth, remote Browser Use cloud, recordings, HAR capture, package installation,
or image pulls. The isolated public browser session was closed successfully.
