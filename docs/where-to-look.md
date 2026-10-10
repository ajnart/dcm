# Where to look — a routing index for the legacy repo

> Historical: the legacy tree this index describes was removed in #192. Read its paths with `git show e979269a:<path>`.

Purpose: **stop exploring.** Every fact the rewrite needs already exists in this repo.
This file maps "I need X" → "read exactly this path". Sub-agents should use it instead of
crawling the tree; that is what inflated turns and context.

All paths below were verified on disk. Regenerate the evidence with the commands in §9.

Roots:

| Alias | Absolute path |
|---|---|
| `$CAT` | `.agents/skills/self-host/workflows/selfhost/references/catalog` |
| `$DOCS` | `docs` |
| `$CLI` | `packages/cli/src` |
| `$WF` | `.agents/skills/self-host/workflows` |

> Do not edit `packages/cli/dist/...` (generated copy) or
> `.agents/skills/self-host/workflows/selfhost-media/assets/harness/` (generated bundle).

---

## 1. Porting one App — the only read set you need

For App `<id>`, read these in order. **That is the whole context; do not crawl.**

| # | Path | Gives you | Available for |
|---|---|---|---|
| 1 | `$CAT/apps/<id>/manifest.json` | identity, `image.reference`, categories, `support` (tier/automation), `security[]`, `pitfalls[]`, sources | **94/94** |
| 2 | `$CAT/apps/<id>/recipe.json` | `services[]` (image, command, env, mounts, restart, ports), `privateFiles`, `onboarding`, `defaults`, `storage`, `acceptance[]` | **81/94** |
| 3 | `$CAT/apps/<id>/setup.ts` | the idempotent Setup steps to reimplement in Go | **94/94** |
| 4 | `$CAT/apps/<id>/homarr.json` | Homarr integration + widgets | **94/94** |
| 5 | `$CAT/apps/<id>/links.ts` | App→App wiring (source, target, targetPort) | 5 Apps |
| 5 | `$CAT/apps/<id>/composition.json` | dependency on another App (e.g. postgresql `db`) | 7 Apps |
| 6 | `$DOCS/<id>.md` | TLDR + fresh-run path + Proof + **Traps** | 7 Apps only |

Verified sample:

| id | manifest | recipe | setup | homarr | doc | links |
|---|---|---|---|---|---|---|
| jellyfin | Y | Y | Y | Y | Y | – |
| sonarr | Y | Y | Y | Y | Y | Y |
| radarr | Y | Y | Y | Y | Y | Y |
| prowlarr | Y | Y | Y | Y | Y | Y |
| qbittorrent | Y | Y | Y | Y | Y | Y |
| seerr | Y | Y | Y | Y | Y | Y |
| homarr | Y | Y | Y | Y | Y | – |
| ntfy | Y | Y | Y | Y | – | – |
| vaultwarden | Y | Y | Y | Y | – | – |
| immich | Y | Y | Y | Y | – | – |

The 13 Apps with **no `recipe.json`** use `derived-recipe.ts` + `derived-recipe-adapter.json`
instead: `archive-team-warrior`, `authelia`, `cloudflare-tunnel`, `dockge`, `gluetun`,
`haproxy`, `headscale`, `minio`, `netbird`, `pangolin`, `passbolt`, `stalwart-mail`, `wud`.

---

## 2. "I need to know X" → read Y

| I need | Read |
|---|---|
| An App's image, port, env, mounts | `$CAT/apps/<id>/recipe.json` (`services[0]`) |
| An App's verified image tag + upstream/docs URLs | `$CAT/apps/<id>/manifest.json` (`image`, `upstream`) |
| An App's headless Setup logic | `$CAT/apps/<id>/setup.ts` |
| An App's known traps | `$DOCS/<id>.md` § Traps, else `manifest.json` `pitfalls[]` + `security[]` |
| An App's acceptance criteria | `recipe.json` `acceptance[]`; deeper: `acceptance.ts` (11 Apps), `acceptance-contract.json` (6) |
| An App's Homarr integration/widgets | `$CAT/apps/<id>/homarr.json`; canonical id list in `$CAT/homarr-integrations.json` |
| How two Apps wire together | `$CAT/apps/<id>/links.ts`; media end-to-end in `$DOCS` + `FINDINGS.md` |
| Which App depends on another | `$CAT/apps/<id>/composition.json` |
| An App's category | `$CAT/apps/<id>/manifest.json` `categories[]`; canonical list in `$CAT/taxonomy.json` |
| Support level / automation tier | `manifest.json` `support` (`tier` T0/T1/T2, `automation` managed/guided/discovery/retired) |
| A Recipe (bundle) | `$CAT/stacks/goals.json` (roles → apps, defaults, gates, acceptance) |
| Onboarding patterns | `recipe.json` `onboarding.kind` → §3 below |
| Secret/file generation rules | `$CAT/types/private-file.ts`, `$CAT/types/private-daemon.ts` |
| The Setup helper contract | `$CAT/types/setup.ts` (14.5 KB: `SetupContext`, HTTP, checkpoints, container exec) |
| What a valid manifest/recipe is | `$CAT/schemas/app.schema.json`, `$CAT/schemas/compose-recipe.schema.json` |
| The old CLI's behaviour | `$CLI/` (95 files in `lib/`, incl. `catalog-project.ts`, `catalog-compatibility.ts`) and `$CLI/control-panel/` |
| The old dashboard/TUI | `$CLI/control-panel/` (`dashboard-recap.ts`, `flow.ts`, `catalog-picker.ts`, `setup-engine.ts`) |
| Workflow-skill boundaries | `$WF/selfhost-*/GUIDE.md`, registry `$CAT/skills.json` |
| Media harness (7 services) | `$WF/selfhost-media/` — canonical; generated bundle under `.../assets/harness/` |
| Media API facts (Jellyfin/Seerr/Homarr) | `docs/research/media-apis.md` (new repo, upstream-sourced) |
| Distribution/release facts | `$DOCS/release.md`, `$DOCS/plugin-audit.md`, `$DOCS/migration-v1.md` |

---

## 3. Onboarding kinds → the 18 Setup patterns

`recipe.json` `onboarding.kind` is a closed taxonomy. Build **one helper per kind**, not one
Setup per App. Field shape: `{kind, officialUrl, username, fileId, secretEnvironment}`.

| kind | Apps |
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

Shared fragments the old CLI already extracted live in `$CAT/shared/`:
`no-account-get.ts`, `setup-proof.ts`.

---

## 4. Schemas (parse before reading a file)

| File | Validates |
|---|---|
| `$CAT/schemas/app.schema.json` | `manifest.json` |
| `$CAT/schemas/compose-recipe.schema.json` | `recipe.json` (34 KB — the important one) |
| `$CAT/schemas/stack.schema.json` | `stacks/goals.json` |
| `$CAT/schemas/skills.schema.json` | `skills.json` |
| `$CAT/schemas/project-state.schema.json` | old project state |
| `$CAT/schemas/preferences.schema.json` | old preferences |
| `$CAT/schemas/homarr-integrations.schema.json` | `homarr-integrations.json` |
| `$CAT/schemas/affiliate.schema.json` | `affiliates.json` (empty) |

---

## 5. Types — the Setup runtime contract (24 files)

Read a type file only when the App uses that capability.

| Type file | Capability |
|---|---|
| `types/setup.ts` | **Start here.** `SetupContext` and everything it exposes |
| `types/acceptance.ts`, `types/acceptance-lifecycle.ts` | Acceptance proof contract |
| `types/private-file.ts`, `private-daemon.ts`, `private-config-environment.ts`, `private-identity.ts`, `private-openpgp.ts` | Secret/file generation |
| `types/mutable-admin.ts`, `mutable-config.ts`, `owner-directory.ts`, `runtime-resources.ts` | Owner state + config mutation |
| `types/http-basic.ts`, `domain-policy.ts`, `non-secret-policy.ts` | Request/auth + policy |
| `types/pre-start.ts`, `derived-recipe.ts`, `recipe-image-reference.ts`, `config-hash-reference.ts` | Pre-start + derived recipes |
| `types/docker-cli-tls.ts`, `manual-job.ts`, `connector.ts`, `canonical-origin.ts`, `app-frontend.ts` | One-off App capabilities |

---

## 6. Prose research (traps)

Only **7 Apps** have a dedicated `$DOCS/<id>.md`: `homarr`, `jellyfin`, `prowlarr`,
`qbittorrent`, `radarr`, `seerr`, `sonarr`. Each has: TLDR · minimum fresh-run path · Proof ·
**Traps** · sources.

For the other 87 Apps the trap list is `manifest.json` `pitfalls[]` + `security[]`.

Repo-wide prose (19 files in `$DOCS/` + `FINDINGS.md`):

| File | Contents |
|---|---|
| `FINDINGS.md` | The end-to-end media setup: service map, Homarr integrations, every connection |
| `$DOCS/headless-setup.md`, `headless-access.md`, `setup-routes.md` | How headless setup works |
| `$DOCS/app-credentials.md` | Credential handling |
| `$DOCS/cli.md`, `command-first-roadmap.md` | Old CLI surface + roadmap |
| `$DOCS/browser-benchmark.md`, `plugin-audit.md`, `release.md`, `migration-v1.md`, `opencode-install.md`, `README.md` | Distribution, packaging, benchmarks |

---

## 7. Old CLI + workflows (read only if you need behaviour, not facts)

| Path | What |
|---|---|
| `$CLI/lib/` | 95 modules: `catalog-project.ts`, `catalog-compatibility.ts`, `compatibility-receipts.ts`, `approved-dag.ts`, `homarr-*.ts` |
| `$CLI/control-panel/` | The old dashboard: `dashboard-recap.ts`, `flow.ts`, `catalog-picker.ts`, `project-selection.ts`, `setup-engine.ts`, `cli-update.ts` |
| `$WF/selfhost-*/GUIDE.md` | 14 workflow skills; boundaries + who owns what |
| `$CAT/skills.json` | The workflow registry (kind, risk, activation, delegatesTo) |

**Port facts, not code** (`docs/adr/0001-compiled-apps-compose-is-truth.md`).

---

## 8. New repo locations (for comparison, not copying)

| Need | Path |
|---|---|
| App contract | `internal/app/app.go` |
| Helpers (`h`) | `internal/helpers/helpers.go` |
| Catalog + recipes | `internal/catalog/catalog.go`, `default.go` (currently 2 Apps, 0 Recipes) |
| Existing Apps | `internal/apps/ntfy`, `.../vaultwarden` |
| Media Recipe (unmerged) | `new-cli-wt-24/internal/apps/{qbittorrent,prowlarr,sonarr,radarr}` |
| API research | `docs/research/media-apis.md` |
| This index's companion | `docs/legacy-catalog.md` (what each artifact is) |

---

## 9. Evidence — regenerate this map

```bash
CAT=.agents/skills/self-host/workflows/selfhost/references/catalog

ls "$CAT/apps" | wc -l                                # 94
find "$CAT/apps" -name recipe.json | wc -l            # 81
find "$CAT/apps" -name manifest.json | wc -l          # 94
find "$CAT/apps" -type f -exec basename {} \; | sort | uniq -c | sort -rn   # file kinds
ls docs/*.md | wc -l                                  # 19
ls packages/cli/src/lib | wc -l                       # 95
```

Counts above were produced by these commands on 2026-10-06.
