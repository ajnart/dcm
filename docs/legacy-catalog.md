# The legacy catalog — what exists, where it is, and how to port it

Read this before writing any new App. The previous repo is **not dead code**. It is a
large, verified body of knowledge about ~94 self-hosted applications, and most of it is
machine-readable. The Go rewrite (`new-cli/`) has so far ignored it and hand-written two
Apps, re-deriving facts that already exist.

This document is the index to that knowledge and the porting map into the new format.

> **Companion: [`where-to-look.md`](where-to-look.md).** That file is the routing index —
> "I need X → read exactly this path". Use it instead of exploring the tree. Porting one App
> needs only its 4–6 `$CAT/apps/<id>/` files, listed there.

> **Proof it already bit us.** `docs/qbittorrent.md` (legacy) states login returns **HTTP
> 204** and the cookie is **`QBT_SID_<port>`**. The new `ticket-24` code expects **200** and
> reads `SID`. A reviewer had to rediscover this from upstream source. The answer was
> already in the repo. Do not repeat this class of miss.

---

## 1. Where the catalog lives

| Location | Role | Size |
|---|---|---|
| `.agents/skills/self-host/workflows/selfhost/references/catalog/` | **Canonical source** — edit here | 94 apps, 496 files, ~2.9 MB |
| `packages/cli/dist/workflows/selfhost/references/catalog/` | Built copy shipped inside the old CLI | same 94 apps (generated, do not edit) |
| `.agents/skills/self-host/workflows/selfhost-media/assets/harness/` | Generated portable media-harness bundle | generated, do not edit |

The old CLI that consumes it: `packages/cli/src/` (`control-panel/`, `lib/`), plus the
workflow skills in `.agents/skills/self-host/workflows/selfhost-*` (14 workflows).

---

## 2. Top-level catalog files

| File | What it is | New-format destination |
|---|---|---|
| `taxonomy.json` | 25 canonical **categories** (media, downloads, dns, ingress, identity…), ambiguous aliases, and the default control plane (Homarr). | `app.Info.Category` + recipe grouping |
| `stacks/goals.json` | The **Recipes**. Each goal = a named bundle with ordered **roles** (id, name, default, choices, reason, purpose, gates) and acceptance strings. ~20 goals incl. `full`, `personal-media`, `photos`, `owned-video-library`. | `catalog.Recipe` (currently `[]` in `default.go`) |
| `skills.json` | Registry of the 14 workflow skills (router/capability/workflow/adapter), risk level, activation, delegatesTo, install group. Schema v4. | Not ported; informational |
| `homarr-integrations.json` | Canonical Homarr integration **identifiers** (e.g. `qBittorrent`, `seerr`, `uptimeKuma`) with display names and official sources. | `Link()` targets + validation |
| `affiliates.json` | Empty (`entries: []`). | Ignore |

### `schemas/` (8 JSON Schemas)
`app.schema.json`, `compose-recipe.schema.json` (34 KB — the big one), `stack.schema.json`,
`skills.schema.json`, `project-state.schema.json`, `preferences.schema.json`,
`affiliate.schema.json`, `homarr-integrations.schema.json`.

These are the contract for every file below. **Read the schema before parsing a file.**

### `types/` (24 TS files)
The runtime type system for `setup.ts`. Despite the name, this is *contract documentation*,
not code to port. Key ones:

| Type file | Meaning |
|---|---|
| `setup.ts` (14.5 KB) | `SetupContext` and the whole helper surface: `SetupHttpRequest/Response`, `SetupCheckpoint`, `SetupContainerCommand`, manual jobs, WebSocket, JMAP, Passbolt registration… |
| `acceptance.ts`, `acceptance-lifecycle.ts` | What a proven Setup must show |
| `private-file.ts`, `private-daemon.ts`, `private-config-environment.ts`, `private-identity.ts`, `private-openpgp.ts` | How secrets/files are generated and kept |
| `mutable-admin.ts`, `mutable-config.ts`, `owner-directory.ts`, `runtime-resources.ts` | Owner state and config mutations |
| `http-basic.ts`, `domain-policy.ts`, `non-secret-policy.ts` | Request/auth and policy helpers |
| `pre-start.ts`, `derived-recipe.ts`, `recipe-image-reference.ts`, `docker-cli-tls.ts`, `manual-job.ts`, `connector.ts`, `canonical-origin.ts`, `config-hash-reference.ts`, `app-frontend.ts` | The rest of the per-app contract |

### `shared/` (2 files)
`no-account-get.ts`, `setup-proof.ts` — reusable Setup fragments the old CLI shared across Apps.
This is the same idea as the new `helpers.H`; compare before re-implementing.

---

## 3. Per-App files (`catalog/apps/<id>/`)

Every App has the same shape. File-kind counts across the 94 Apps:

| File | Count | What it is | Ports to |
|---|---|---|---|
| `manifest.json` | **94** | Identity + metadata: id, name, aliases, categories, roles, upstream urls, image reference, lifecycle status, **support** (automation/tier/adapterSkill), homarr support, dependencies, alternatives, **security** notes, **pitfalls**, sources | `app.Info` + catalog metadata |
| `recipe.json` | **81** | The deployable recipe: `services[]` (image, command, env, mounts, restart, ports), `privateFiles`, `onboarding`, `defaults`, `storage`, `acceptance[]` | `Compose()` + `Inputs()` + secrets + `Check()` |
| `setup.ts` | **94** | The headless Setup program (idempotent steps against the `types/setup.ts` contract) | `Setup()` |
| `homarr.json` | **94** | Homarr integration kind, required secrets, widgets, and widget verification shapes | `Link()` to Homarr |

### The `manifest.json` facts (all 94 Apps)

`security[]` and `pitfalls[]` are the most under-used fields — they encode the traps in
prose. `support.tier` (T0/T1/T2) and `support.automation` (managed/guided/discovery/retired)
say what level of automation was claimed. `image.reference` is the verified tag.

### The `recipe.json` facts (81 Apps)

Coverage of the fields that map directly onto `Compose()`:

| Field | Apps with it |
|---|---|
| `imageTag` | 81 |
| published port | 76 |
| environment | 62 |
| mounts | 74 |
| onboarding | 81 |
| multi-service | 15 |

`onboarding.kind` is a **taxonomy of 18**, not 81 bespoke logins:

| kind | apps |
|---|---|
| `manual-first-admin` | 27 |
| `no-account` | 13 |
| `initial-admin-from-secret-env` | 11 |
| `manual-first-email` | 6 |
| `initial-admin-from-file` | 5 |
| `job-credentials` | 3 |
| `initial-admin-email-from-secret-env` | 3 |
| `manual-first-password` | 2 |
| `generated-api-token` | 2 |
| `api-first-admin` | 1 |
| `initial-admin-from-auth-users` | 1 |
| `initial-password-from-file` | 1 |
| `external-secret` | 1 |
| `external-first-admin` | 1 |
| `connector-enrollment` | 1 |
| `initial-admin-password-file` | 1 |
| `seeded-admin-rotation` | 1 |
| `official-client-first-email` | 1 |

**18 shared Setup helpers cover all 81.** That is the single biggest lever: port the
onboarding kinds once, not the Apps.

### Advanced / variant files (the 13 Apps without `recipe.json`)

These are the complex ones. They use composition and derivation instead of a flat recipe:

| File | Count | What it is |
|---|---|---|
| `derived-recipe.ts` + `derived-recipe-adapter.json` | 13 | App whose compose is *derived* rather than declared |
| `composition.json` | 7 | Dependency on another App (e.g. umami → `postgresql` service `db`) |
| `links.ts` | 5 | **App→App wiring** (e.g. prowlarr → sonarr/radarr with `targetPort`) — the old form of the new `Links()` |
| `pre-start.ts`, `pre-start-adapter.json` | 4 | Hooks that run before the App starts |
| `docker-authority.json` | 4 | Docker-management/tls authority boundary (portainer etc.) |
| `docker-cli-tls.json` | 1 | Docker CLI TLS material |
| `canonical-origin.ts` | 3 | The one origin an App must be reached on |
| `bootstrap.ts`, `bootstrap-password.json`, `bootstrap-source.md` | 3 / 3 / 1 | Bootstrap seeding |
| `socketio-intents.json` | 2 | Socket.IO calls needed for headless setup |
| `runtime-resources.json` | 2 | Runtime requirements |
| `owner-directory.json` | 1 | Owned data directory |
| `acceptance.ts`, `acceptance-contract.json` | 11 / 6 | The acceptance proofs behind `Check()` |
| `configuration.ts` | 10 | Config-mutation steps |
| `setup-prerequisites.md`, `headless-prerequisites.md`, `setup-contract.md`, `first-run.md`, `BOOTSTRAP.md`, `PORTS.md`, `provider-read-contract.md`, `api-key-policy-research.md` | — | Per-App prose research (facts + traps) |
| `check-setup.ts`, `check-configuration.ts`, `check-deferred-setup.ts` | 2 / 1 / 1 | Extra Check steps |
| `login-contract.ts`, `closure-contract.ts` | 2 / 1 | Auth/closure contracts |
| `remote-watcher.ts`, `s3-auth.ts`, `inspection.ts`, `idle-readback.ts`, `idle-config.ts`, `control.ts`, `config.ts`, `authority.ts`, `headless.ts`, `connector.ts` | 1 each | One-off App behaviours |

**13 Apps have no `recipe.json`** (they use `derived-recipe`): `archive-team-warrior`,
`authelia`, `cloudflare-tunnel`, `dockge`, `gluetun`, `haproxy`, `headscale`, `minio`,
`netbird`, `pangolin`, `passbolt`, `stalwart-mail`, `wud`.

---

## 4. The prose research (facts and traps)

The catalog JSON holds structure; these hold the *gotchas*:

| Source | Contents |
|---|---|
| `FINDINGS.md` (2166 lines total across docs) | The original end-to-end media setup write-up: service map, Homarr integrations, and every connection (Prowlarr→Sonarr/Radarr, Sonarr/Radarr→qBittorrent) |
| `docs/jellyfin.md`, `docs/sonarr.md`, `docs/radarr.md`, `docs/prowlarr.md`, `docs/qbittorrent.md`, `docs/seerr.md`, `docs/homarr.md` | Per-App **TLDR + minimum fresh-run path + Proof + Traps + sources** |
| `docs/headless-setup.md`, `docs/headless-access.md`, `docs/setup-routes.md` | How headless setup works in general |
| `docs/app-credentials.md` | Credential handling |
| `docs/cli.md`, `docs/command-first-roadmap.md` | The old CLI surface and its roadmap |
| `docs/migration-v1.md`, `docs/release.md`, `docs/plugin-audit.md`, `docs/opencode-install.md`, `docs/browser-benchmark.md`, `docs/README.md` | Distribution, packaging, benchmarks |

**Rule for every App ticket: read its `docs/<id>.md` Traps section and its
`manifest.json` `pitfalls[]`/`security[]` before writing `Setup()`.** They are the exact
list of things that will otherwise be rediscovered the hard way.

---

## 5. Porting map (old → new)

| Legacy artifact | New Go equivalent | Notes |
|---|---|---|
| `manifest.json` → `image.reference`, `upstream`, categories, `support` | `app.Info` + catalog metadata | Fully mechanical |
| `recipe.json` → `services[].imageTag` | `Info.Image` | 81 available |
| `recipe.json` → `publishTargetPort`, `defaults.publishedPort` | `Info.Port`, `Info.ContainerPort` | 76 available |
| `recipe.json` → `services[].environment` / `hostEnvironment` / `secretEnvironment` | `Compose()` env block (`${TZ}`, `${PUID}`, `${PGID}`, `${UMASK}`) | 62 available |
| `recipe.json` → `mounts[]` | `Compose()` volumes (`./config:/config`) | 74 available |
| `recipe.json` → `onboarding` | `Setup()` onboarding step | Use the 18-kind taxonomy |
| `recipe.json` → `privateFiles[]` | `secrets.env` entries | |
| `recipe.json` → `acceptance[]` | `Check()` | |
| `setup.ts` | `Setup(ctx, h)` steps | Re-implement, do **not** transpile |
| `homarr.json` | Homarr `Link()` / integration | |
| `links.ts` | `Links()` | Direct match |
| `composition.json` | Recipe dependency order | |
| `stacks/goals.json` | `catalog.Recipe` | Currently empty |
| `taxonomy.json` categories | `Info.Category` | 25 canonical categories |
| `homarr-integrations.json` | Link target validation | |
| `docs/*.md` Traps, `FINDINGS.md` | Ticket briefs | Human-read input |

**What NOT to port:** the TS type system, `derived-recipe` machinery, checkpoints,
canonical-origin transitions, approval DAGs. Those were the diagnosed bottlenecks
(ADR `0001-compiled-apps-compose-is-truth.md`). Port **facts**, not code.

---

## 6. Recommended porting order

1. **Importer** — parse the 81 `recipe.json` + 94 `manifest.json` into one facts table
   (id, image, ports, env, mounts, onboarding kind, category, docs url, pitfalls, security).
2. **Onboarding helpers** — one tested Go helper per `onboarding.kind` (18), starting
   with `manual-first-admin` (27 apps) and `no-account` (13).
3. **Generator** — emit `apps/<id>/<id>.go` with `Info()` + `Compose()` filled from facts,
   leaving `Setup()`/`Check()` as the only hand-written part.
4. **Recipes** — turn `stacks/goals.json` into `catalog.Recipe` (start with `personal-media`).
5. **Traps digest** — a per-App notes file extracted from `docs/*.md` and
   `manifest.json` pitfalls/security, attached to each App ticket.
6. **Parity list** — mark all 94 Apps in-scope / deferred, so the roadmap is explicit.

Items 1 and 5 are read-only and safe to do first. Item 2 is the largest reduction in
repeated work.

---

## 7. Checklist for any new App

Before writing Go:

- [ ] `manifest.json` read — image, category, support tier, `security[]`, `pitfalls[]`
- [ ] `recipe.json` read — services, ports, env, mounts, onboarding, acceptance
- [ ] `docs/<id>.md` Traps section read
- [ ] `links.ts` / `composition.json` / `homarr.json` checked
- [ ] Facts match: image tag, container port, published port, config mount path
- [ ] Onboarding kind identified and matched to a shared helper

After writing Go:

- [ ] Every auxiliary Compose service has an App-owned `<app-id>-<role>` name; environment hosts, dependencies, generated configuration and Setup/Check/Exec targets use that same name. Database names, users and bind-mount paths do not change when services are renamed.
- [ ] The complete catalog renders together (`TestCatalogAppsRenderTogether`). For an existing Project, rerun `self-host install <affected-apps> --yes` to refresh definitions; `up --remove-orphans` retires only services absent from that Project's complete Compose configuration, without deleting volumes. Apps still included in the Project stay configured.
- [ ] `Check()` reproduces the `acceptance[]` intent
- [ ] Trap list is reflected (e.g. qBittorrent 204 + `QBT_SID_<port>`)
