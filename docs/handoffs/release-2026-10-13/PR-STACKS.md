# Every open PR: meaning, branch and actual stack

Snapshot: **43 pre-existing open PRs**. The handoff documentation PR is additional and recorded separately. This is a source/tracker reconciliation, not a new code-review or acceptance verdict. Every PR below has a named original branch, exact head, actual base relationship and remaining action. Full historical PR accounting is in [PR-HISTORY.md](PR-HISTORY.md).

**Latest precedence:** [LATEST-UPDATE.md](LATEST-UPDATE.md) and the [three additional dossiers](#concurrent-additions-at-final-publication) bring this complete account to 46 open PRs. The 43-prior-head audit below is historical; #357 now adds a real #259 child, and #356 reports newer candidate/runtime work.

## Why there are so many PRs

Each of the 38 remaining Homarr peers owns a separate App/leaf PR. Immich #309 and its common compatibility/ownership/freshness seam already merged. Thirty peers still name its branch as their base, often from an older reference commit; they are **siblings**, not a 30-PR chain. Thirteen existing PRs name main as base: eight peers, evaluation/site/video, one diagnostic and legacy #14.

```text
main at capture: ab4c92c428a2c2c9ab284a83f79f726418c1498b
  merged #309: Immich reference + common contract (frozen production 6b82c55f)
  merged #278/#314/#353: workflow / outside-Catalog plan / coverage docs
  main-based OPEN peers: #310 #311 #312 #315 #317 #320 #321 #336
  main-based OPEN other: #14 #259 #300 #313 #355
  new docs-only lane: docs/release-handoff

feat/homarr-immich-sol, already merged #309, remote tip 33e7fbcc
  30 OPEN sibling peer PRs (historical bases differ):
  #318 #319 #322 #323 #324 #325 #326 #327 #328 #329
  #330 #331 #333 #334 #335 #337 #338 #339 #340 #341
  #342 #343 #344 #345 #346 #347 #348 #349 #351 #352
```

Only seven peer heads include frozen 6b82c55f in ancestry; AdGuard/Paperless are the two main-based peers without it, while Linkwarden is a reference-based peer that does include it.

Actual Git audit: no existing open head contains another open head; only #328 contains the current reference branch tip; no existing open head contains current main. Eight open heads include frozen 6b82c55f: seven peers plus #355. These facts do not establish blob equality, current registration or native acceptance.

GitHub baseRefOid was stale/different from the live branch tip for most PRs. The per-PR merge base below is computed against the captured live remote base, not treated as equal to that metadata field. Exact results are in [github/pr-stack-audit.json](github/pr-stack-audit.json). Retargeting alone cannot remove historical common-code drift; use the custodian and approved forward reconciliation, no force push.

## Review/resume order

1. Reconcile stopped #259 with its owner; preserve valid conversations and failed judgments. No new model calls yet.
2. Obtain direction for cancelled AdGuard #311 / Paperless #312 verifiers, optional Home Assistant #333 diagnostics and the actual runner safety review.
3. Preserve reviewed post-run #310/#317/#335/#355 and normalized #315/#320/#321/#336 pins; assemble a NEW evaluation candidate only through the custodian.
4. Resolve privacy/authority holds #332/#350/#354 and runtime evidence gaps, or ask for a reduced release scope. Plan/review/approve new runtime before execution.
5. Finish each original peer registration, meaningful native/saved/rendered values, both installation orders and preservation/lifecycle proof. Independently review the complete exact accepted head before approved individual merges.
6. Separately settle #193/#194/#295, installer #313, final merged-main packaging and #268/#300 video publication. Legacy #14 is an explicit scope choice, not silently merged.

The source/evidence/approval gates are in [HANDOFF.md](HANDOFF.md). Four archival branches in [CHECKPOINTS.md](CHECKPOINTS.md) are not production PRs.

## Quick branch and gate index

| PR | Meaning | Original checkout branch | Base | Main remaining gate |
| --- | --- | --- | --- | --- |
| [#14](https://github.com/ajnart/selfhost-skills/pull/14) / [dossier](#pr-14) | Fix Pi /self-host command dispatch | `fix/pi-self-host-command` | `main` | Explicit legacy scope + current review |
| [#259](https://github.com/ajnart/selfhost-skills/pull/259) / [dossier](#pr-259) | test(skill): isolate and verify the skill evaluation harness | `test/skill-eval-harness` | `main` | Judgment-only recovery + full viewer/human gate |
| [#300](https://github.com/ajnart/selfhost-skills/pull/300) / [dossier](#pr-300) | feat(video): use canonical release domain in showreel | `feat/video-release-domain` | `main` | Anonymous distribution + publication approval |
| [#310](https://github.com/ajnart/selfhost-skills/pull/310) / [dossier](#pr-310) | feat(audiobookshelf): stage Homarr credentials and Audio Stats descriptor | `feat/homarr-audiobookshelf-sol` | `main` | Native/rendered/lifecycle acceptance; original-branch reconciliation |
| [#311](https://github.com/ajnart/selfhost-skills/pull/311) / [dossier](#pr-311) | fix(adguard): verify Setup credentials and prepare native Homarr data | `feat/homarr-adguard-sol` | `main` | Cancelled nil verifier completion + native/lifecycle acceptance |
| [#312](https://github.com/ajnart/selfhost-skills/pull/312) / [dossier](#pr-312) | feat(paperless-ngx): provision verified read-only Homarr credentials | `feat/homarr-paperless-sol` | `main` | Cancelled nil verifier completion + native/lifecycle acceptance |
| [#313](https://github.com/ajnart/selfhost-skills/pull/313) / [dossier](#pr-313) | feat(release): deploy gated installer site on selfhost.ajnart.dev | `feat/installer-site-domain` | `main` | Rename/defaults + anonymous install/update |
| [#315](https://github.com/ajnart/selfhost-skills/pull/315) / [dossier](#pr-315) | feat(homarr): add Caddy upstream statistics descriptor | `feat/homarr-caddy-sol` | `main` | Native/rendered/lifecycle acceptance; original-branch reconciliation |
| [#317](https://github.com/ajnart/selfhost-skills/pull/317) / [dossier](#pr-317) | feat(aria2): verify Homarr RPC prerequisites | `feat/homarr-aria2-sol` | `main` | Native/rendered/lifecycle acceptance; original-branch reconciliation |
| [#318](https://github.com/ajnart/selfhost-skills/pull/318) / [dossier](#pr-318) | feat(homarr): add Lidarr calendar and statistics descriptor | `feat/homarr-lidarr-sol` | `feat/homarr-immich-sol` | Native/rendered/lifecycle acceptance; original-branch reconciliation |
| [#319](https://github.com/ajnart/selfhost-skills/pull/319) / [dossier](#pr-319) | feat(homarr): add scoped Dashdot CPU and RAM Link | `feat/homarr-dashdot-sol` | `feat/homarr-immich-sol` | Native/rendered/lifecycle acceptance; original-branch reconciliation |
| [#320](https://github.com/ajnart/selfhost-skills/pull/320) / [dossier](#pr-320) | feat(bazarr): verify API credentials and native Homarr widgets | `feat/homarr-bazarr-sol` | `main` | Native/rendered/lifecycle acceptance; original-branch reconciliation |
| [#321](https://github.com/ajnart/selfhost-skills/pull/321) / [dossier](#pr-321) | feat(homarr): verify Gatus local readiness and native Stats | `feat/homarr-gatus-sol` | `main` | Native/rendered/lifecycle acceptance; original-branch reconciliation |
| [#322](https://github.com/ajnart/selfhost-skills/pull/322) / [dossier](#pr-322) | feat(emby): prepare Homarr credentials and native widgets | `feat/homarr-emby-sol` | `feat/homarr-immich-sol` | Native/rendered/lifecycle acceptance; original-branch reconciliation |
| [#323](https://github.com/ajnart/selfhost-skills/pull/323) / [dossier](#pr-323) | feat(homarr): verify Warrior workers and declare native widgets | `feat/homarr-warrior-sol` | `feat/homarr-immich-sol` | Native/rendered/lifecycle acceptance; original-branch reconciliation |
| [#324](https://github.com/ajnart/selfhost-skills/pull/324) / [dossier](#pr-324) | feat(deluge): verify Web credentials and native Homarr downloads | `feat/homarr-deluge-sol` | `feat/homarr-immich-sol` | Native/rendered/lifecycle acceptance; original-branch reconciliation |
| [#325](https://github.com/ajnart/selfhost-skills/pull/325) / [dossier](#pr-325) | feat(homarr): prepare scoped Gotify notifications Link | `feat/homarr-gotify-sol` | `feat/homarr-immich-sol` | Native/rendered/lifecycle acceptance; original-branch reconciliation |
| [#326](https://github.com/ajnart/selfhost-skills/pull/326) / [dossier](#pr-326) | feat(homarr): add verified Glances resources Link | `feat/homarr-glances-sol` | `feat/homarr-immich-sol` | Native/rendered/lifecycle acceptance; original-branch reconciliation |
| [#327](https://github.com/ajnart/selfhost-skills/pull/327) / [dossier](#pr-327) | feat(gluetun): stage guarded Homarr target and separate readiness | `feat/homarr-gluetun-sol` | `feat/homarr-immich-sol` | Native privacy #332 + excluded startup |
| [#328](https://github.com/ajnart/selfhost-skills/pull/328) / [dossier](#pr-328) | feat(linkwarden): prepare owned Homarr statistics access | `feat/homarr-linkwarden-sol` | `feat/homarr-immich-sol` | Native/rendered/lifecycle acceptance; original-branch reconciliation |
| [#329](https://github.com/ajnart/selfhost-skills/pull/329) / [dossier](#pr-329) | feat(homarr): add scoped Netdata statistics Link | `feat/homarr-netdata-sol` | `feat/homarr-immich-sol` | Native/rendered/lifecycle acceptance; original-branch reconciliation |
| [#330](https://github.com/ajnart/selfhost-skills/pull/330) / [dossier](#pr-330) | feat(navidrome): verify native Homarr music data | `feat/homarr-navidrome-sol` | `feat/homarr-immich-sol` | Native/rendered/lifecycle acceptance; original-branch reconciliation |
| [#331](https://github.com/ajnart/selfhost-skills/pull/331) / [dossier](#pr-331) | feat(homarr): prepare authenticated Frigate Stats Link | `feat/homarr-frigate-sol` | `feat/homarr-immich-sol` | Native/rendered/lifecycle acceptance; original-branch reconciliation |
| [#333](https://github.com/ajnart/selfhost-skills/pull/333) / [dossier](#pr-333) | feat(home-assistant): add read-only Homarr token and entity slice | `feat/homarr-home-assistant-sol` | `feat/homarr-immich-sol` | Native/rendered/lifecycle acceptance; original-branch reconciliation |
| [#334](https://github.com/ajnart/selfhost-skills/pull/334) / [dossier](#pr-334) | feat(homarr): verify SABnzbd credentials and native widgets | `feat/homarr-sabnzbd-sol` | `feat/homarr-immich-sol` | Native/rendered/lifecycle acceptance; original-branch reconciliation |
| [#335](https://github.com/ajnart/selfhost-skills/pull/335) / [dossier](#pr-335) | feat(nzbget): prepare restricted Homarr Downloads access | `feat/homarr-nzbget-sol` | `feat/homarr-immich-sol` | Persistence diagnosis + native privacy #354 |
| [#336](https://github.com/ajnart/selfhost-skills/pull/336) / [dossier](#pr-336) | feat(homarr): add verified Prometheus target statistics | `feat/homarr-prometheus-sol` | `main` | Native/rendered/lifecycle acceptance; original-branch reconciliation |
| [#337](https://github.com/ajnart/selfhost-skills/pull/337) / [dossier](#pr-337) | feat(homarr): verify Transmission RPC and native download widgets | `feat/homarr-transmission-sol` | `feat/homarr-immich-sol` | Native/rendered/lifecycle acceptance; original-branch reconciliation |
| [#338](https://github.com/ajnart/selfhost-skills/pull/338) / [dossier](#pr-338) | feat(homarr): prepare owned Technitium DNS statistics | `feat/homarr-technitium-sol` | `feat/homarr-immich-sol` | Native/rendered/lifecycle acceptance; original-branch reconciliation |
| [#339](https://github.com/ajnart/selfhost-skills/pull/339) / [dossier](#pr-339) | feat(pihole): prepare verified Homarr application-password statistics | `feat/homarr-pihole-sol` | `feat/homarr-immich-sol` | Native/rendered/lifecycle acceptance; original-branch reconciliation |
| [#340](https://github.com/ajnart/selfhost-skills/pull/340) / [dossier](#pr-340) | feat(nextcloud): prepare credentials and native Homarr widgets | `feat/homarr-nextcloud-sol` | `feat/homarr-immich-sol` | Native/rendered/lifecycle acceptance; original-branch reconciliation |
| [#341](https://github.com/ajnart/selfhost-skills/pull/341) / [dossier](#pr-341) | feat(homarr): add explicit Uptime Kuma status-page Link | `feat/homarr-uptime-kuma-sol` | `feat/homarr-immich-sol` | Native/rendered/lifecycle acceptance; original-branch reconciliation |
| [#342](https://github.com/ajnart/selfhost-skills/pull/342) / [dossier](#pr-342) | feat(homarr): prepare Slskd downloads and provider readiness | `feat/homarr-slskd-sol` | `feat/homarr-immich-sol` | Native/rendered/lifecycle acceptance; original-branch reconciliation |
| [#343](https://github.com/ajnart/selfhost-skills/pull/343) / [dossier](#pr-343) | feat(homarr): add authenticated WUD update widgets | `feat/homarr-wud-sol` | `feat/homarr-immich-sol` | Native/rendered/lifecycle acceptance; original-branch reconciliation |
| [#344](https://github.com/ajnart/selfhost-skills/pull/344) / [dossier](#pr-344) | feat(homarr): prepare owned Umami analytics connection | `feat/homarr-umami-sol` | `feat/homarr-immich-sol` | Native/rendered/lifecycle acceptance; original-branch reconciliation |
| [#345](https://github.com/ajnart/selfhost-skills/pull/345) / [dossier](#pr-345) | feat(homarr): prepare PatchMon Link with read-only credential hold | `feat/homarr-patchmon-sol` | `feat/homarr-immich-sol` | Readiness diagnosis + authority #350 |
| [#346](https://github.com/ajnart/selfhost-skills/pull/346) / [dossier](#pr-346) | feat(homarr): add owned Tracearr connection slice | `feat/homarr-tracearr-sol` | `feat/homarr-immich-sol` | Native/rendered/lifecycle acceptance; original-branch reconciliation |
| [#347](https://github.com/ajnart/selfhost-skills/pull/347) / [dossier](#pr-347) | feat(homarr): add guarded PeaNUT UPS and native Stats descriptor | `feat/homarr-peanut-sol` | `feat/homarr-immich-sol` | Native/rendered/lifecycle acceptance; original-branch reconciliation |
| [#348](https://github.com/ajnart/selfhost-skills/pull/348) / [dossier](#pr-348) | feat(homarr): verified Plex credential and native widget slice | `feat/homarr-plex-sol` | `feat/homarr-immich-sol` | Native/rendered/lifecycle acceptance; original-branch reconciliation |
| [#349](https://github.com/ajnart/selfhost-skills/pull/349) / [dossier](#pr-349) | feat(tdarr): prepare authenticated native Homarr monitoring | `feat/homarr-tdarr-sol` | `feat/homarr-immich-sol` | Native/rendered/lifecycle acceptance; original-branch reconciliation |
| [#351](https://github.com/ajnart/selfhost-skills/pull/351) / [dossier](#pr-351) | feat(speedtest-tracker): prepare scoped Homarr results link | `feat/homarr-speedtest-sol` | `feat/homarr-immich-sol` | Native/rendered/lifecycle acceptance; original-branch reconciliation |
| [#352](https://github.com/ajnart/selfhost-skills/pull/352) / [dossier](#pr-352) | feat(homarr): add protected Traefik native Link descriptor | `feat/homarr-traefik-sol` | `feat/homarr-immich-sol` | Native/rendered/lifecycle acceptance; original-branch reconciliation |
| [#355](https://github.com/ajnart/selfhost-skills/pull/355) / [dossier](#pr-355) | fix(homarr): preserve Frigate TLS recovery hint | `fix/homarr-frigate-recovery-hint` | `main` | Custodian common-code reconciliation + merge direction |

## Per-PR dossiers

Checkout instructions assume a **new machine or inactive original owner**. On the old machine use the existing worktree; do not steal an occupied branch. In a clean new clone, `gh pr checkout <number>` selects the named original PR branch. Read its full SHA first and reconcile differences; never use `--force`. Runtime/model/publication approval is not implied by checkout.

### PR 14

**[Fix Pi /self-host command dispatch](https://github.com/ajnart/selfhost-skills/pull/14)**

- **State:** OPEN; draft=no. GitHub mergeability `CONFLICTING`, merge state `DIRTY`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `fix/pi-self-host-command` (`gh pr checkout 14` in a clean new clone). **Exact head:** `6c65f96881378bc4b25292c3202f20d5c89b97cc`.
- **Base:** `main`; live captured tip `ab4c92c428a2c2c9ab284a83f79f726418c1498b`. Computed merge base `ebc7fb727dfb601c3ca3802591762c23901bf43e`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **no**.
- **GitHub-reported base OID:** `ebc7fb727dfb601c3ca3802591762c23901bf43e`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Pi package command dispatch only: register /self-host through the native /skill:self-host resolver, remove the duplicate prompt template and check the package contract. This predates the Go release work.
- **Source/evidence state:** Not reviewed in this release effort; OPEN, non-draft is not a merge verdict.
- **Dependencies / stack meaning:** Independent main-based legacy lane; no Homarr/runtime/distribution dependency is asserted.
- **Remaining / next:** Preserve the original PR. Ask whether this legacy package change belongs in the chosen release scope, then review against current product packaging if requested.
- **Captured diff:** GitHub reports 4 changed files, +57/−11; Git diff against the computed live-base merge base lists 4 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
package.json
packaging/pi/extensions/self-host.ts
packaging/pi/prompts/self-host.md
scripts/validate-repo.ts
```

</details>

### PR 259

**[test(skill): isolate and verify the skill evaluation harness](https://github.com/ajnart/selfhost-skills/pull/259)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `test/skill-eval-harness` (`gh pr checkout 259` in a clean new clone). **Exact head:** `3558e581856ae12bf803c6052384ee23ac2f93a2`.
- **Base:** `main`; live captured tip `ab4c92c428a2c2c9ab284a83f79f726418c1498b`. Computed merge base `3800111d292005af38221da47845956694956185`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **no**.
- **GitHub-reported base OID:** `3800111d292005af38221da47845956694956185`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Fail-closed macOS fixture evaluation harness: actual router/CLI conversations, frozen inputs, execution validity, blind/scripted/Recap judgments and the supplied viewer. It does not prove real App installation.
- **Source/evidence state:** Head 3558e581 reports 54/54 valid iteration-25 conversations, followed by judging quota failure. Forty-eight raw judge responses are diagnostic only; zero usable grades, benchmark or viewer. Ruff/Pyright and independent source passes are reported; reconcile their exact full-diff coverage.
- **Dependencies / stack meaning:** #257 guide work is already merged, not a pending stack parent. Human viewer feedback remains a gate; later guide revisions belong in a separate follow-up. macOS guard only; other OS scenarios are simulations.
- **Remaining / next:** Coordinate with the existing owner. After separately confirmed access and bounded authorization, run judgment-only recovery on copies of valid frozen conversations, finish complete judging/aggregation/viewer and obtain human feedback. No new conversation batch, automatic retry or paid fallback.
- **Captured diff:** GitHub reports 205 changed files, +15231/−0; Git diff against the computed live-base merge base lists 205 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
.gitignore
evals/self-host/PROGRESS.md
evals/self-host/README.md
evals/self-host/bin/ask_user_mcp.py
evals/self-host/bin/docker
evals/self-host/bin/dockerstate.py
evals/self-host/bin/guard.py
evals/self-host/bin/hosttool
evals/self-host/bin/isolation.py
evals/self-host/bin/self-host
evals/self-host/checks.py
evals/self-host/evals/evals.json
evals/self-host/evals/trigger-queries.json
evals/self-host/judge.py
evals/self-host/processes.py
evals/self-host/run.py
evals/self-host/scenarios/cant-reach-tv/apps-info/jellyfin.json
evals/self-host/scenarios/cant-reach-tv/apps-info/paperless-ngx.json
evals/self-host/scenarios/cant-reach-tv/apps-info/sonarr.json
evals/self-host/scenarios/cant-reach-tv/apps-list.json
evals/self-host/scenarios/cant-reach-tv/config-review.json
evals/self-host/scenarios/cant-reach-tv/config-set.jsonl
evals/self-host/scenarios/cant-reach-tv/doctor.jsonl
evals/self-host/scenarios/cant-reach-tv/profile.json
evals/self-host/scenarios/cant-reach-tv/status-fixed.json
evals/self-host/scenarios/cant-reach-tv/status.json
evals/self-host/scenarios/failed-setup/apps-info/jellyfin.json
evals/self-host/scenarios/failed-setup/apps-info/paperless-ngx.json
evals/self-host/scenarios/failed-setup/apps-info/sonarr.json
evals/self-host/scenarios/failed-setup/apps-list.json
evals/self-host/scenarios/failed-setup/credentials.json
evals/self-host/scenarios/failed-setup/debug/sonarr.json
evals/self-host/scenarios/failed-setup/profile.json
evals/self-host/scenarios/failed-setup/setup.jsonl
evals/self-host/scenarios/failed-setup/status-installed.json
evals/self-host/scenarios/failed-setup/status.json
evals/self-host/scenarios/newbie-debian/apps-info
evals/self-host/scenarios/newbie-debian/apps-list.json
evals/self-host/scenarios/newbie-debian/config-set.jsonl
evals/self-host/scenarios/newbie-debian/credentials.json
evals/self-host/scenarios/newbie-debian/doctor-docker-missing.jsonl
evals/self-host/scenarios/newbie-debian/doctor.jsonl
evals/self-host/scenarios/newbie-debian/install.jsonl
evals/self-host/scenarios/newbie-debian/os-release
evals/self-host/scenarios/newbie-debian/platform.json
evals/self-host/scenarios/newbie-debian/profile-set.json
evals/self-host/scenarios/newbie-debian/profile.json
evals/self-host/scenarios/newbie-debian/status-installed.json
evals/self-host/scenarios/newbie-debian/status.exit
evals/self-host/scenarios/newbie-install/apps-info/actual-budget.json
evals/self-host/scenarios/newbie-install/apps-info/adguard-home.json
evals/self-host/scenarios/newbie-install/apps-info/archive-team-warrior.json
evals/self-host/scenarios/newbie-install/apps-info/aria2.json
evals/self-host/scenarios/newbie-install/apps-info/audiobookshelf.json
evals/self-host/scenarios/newbie-install/apps-info/authelia.json
evals/self-host/scenarios/newbie-install/apps-info/authentik.json
evals/self-host/scenarios/newbie-install/apps-info/bazarr.json
evals/self-host/scenarios/newbie-install/apps-info/beszel.json
evals/self-host/scenarios/newbie-install/apps-info/bookstack.json
evals/self-host/scenarios/newbie-install/apps-info/borgmatic.json
evals/self-host/scenarios/newbie-install/apps-info/caddy.json
evals/self-host/scenarios/newbie-install/apps-info/cloudflare-tunnel.json
evals/self-host/scenarios/newbie-install/apps-info/dashdot.json
evals/self-host/scenarios/newbie-install/apps-info/deluge.json
evals/self-host/scenarios/newbie-install/apps-info/dockge.json
evals/self-host/scenarios/newbie-install/apps-info/docmost.json
evals/self-host/scenarios/newbie-install/apps-info/emby.json
evals/self-host/scenarios/newbie-install/apps-info/firefly-iii.json
evals/self-host/scenarios/newbie-install/apps-info/forgejo.json
evals/self-host/scenarios/newbie-install/apps-info/freshrss.json
evals/self-host/scenarios/newbie-install/apps-info/frigate.json
evals/self-host/scenarios/newbie-install/apps-info/gatus.json
evals/self-host/scenarios/newbie-install/apps-info/glances.json
evals/self-host/scenarios/newbie-install/apps-info/gluetun.json
evals/self-host/scenarios/newbie-install/apps-info/gotify.json
evals/self-host/scenarios/newbie-install/apps-info/grafana.json
evals/self-host/scenarios/newbie-install/apps-info/haproxy.json
evals/self-host/scenarios/newbie-install/apps-info/headscale.json
evals/self-host/scenarios/newbie-install/apps-info/homarr.json
evals/self-host/scenarios/newbie-install/apps-info/home-assistant.json
evals/self-host/scenarios/newbie-install/apps-info/homebridge.json
evals/self-host/scenarios/newbie-install/apps-info/immich.json
evals/self-host/scenarios/newbie-install/apps-info/jellyfin.json
evals/self-host/scenarios/newbie-install/apps-info/keycloak.json
evals/self-host/scenarios/newbie-install/apps-info/kopia.json
evals/self-host/scenarios/newbie-install/apps-info/lidarr.json
evals/self-host/scenarios/newbie-install/apps-info/linkwarden.json
evals/self-host/scenarios/newbie-install/apps-info/lldap.json
evals/self-host/scenarios/newbie-install/apps-info/loki.json
evals/self-host/scenarios/newbie-install/apps-info/mayan-edms.json
evals/self-host/scenarios/newbie-install/apps-info/minio.json
evals/self-host/scenarios/newbie-install/apps-info/navidrome.json
evals/self-host/scenarios/newbie-install/apps-info/netbird.json
evals/self-host/scenarios/newbie-install/apps-info/netdata.json
evals/self-host/scenarios/newbie-install/apps-info/nextcloud.json
evals/self-host/scenarios/newbie-install/apps-info/nginx-proxy-manager.json
evals/self-host/scenarios/newbie-install/apps-info/node-red.json
evals/self-host/scenarios/newbie-install/apps-info/ntfy.json
evals/self-host/scenarios/newbie-install/apps-info/nzbget.json
evals/self-host/scenarios/newbie-install/apps-info/ollama.json
evals/self-host/scenarios/newbie-install/apps-info/open-webui.json
evals/self-host/scenarios/newbie-install/apps-info/pangolin.json
evals/self-host/scenarios/newbie-install/apps-info/paperless-ngx.json
evals/self-host/scenarios/newbie-install/apps-info/passbolt.json
evals/self-host/scenarios/newbie-install/apps-info/patchmon.json
evals/self-host/scenarios/newbie-install/apps-info/peanut.json
evals/self-host/scenarios/newbie-install/apps-info/photoprism.json
evals/self-host/scenarios/newbie-install/apps-info/pihole.json
evals/self-host/scenarios/newbie-install/apps-info/plex.json
evals/self-host/scenarios/newbie-install/apps-info/portainer.json
evals/self-host/scenarios/newbie-install/apps-info/postgresql.json
evals/self-host/scenarios/newbie-install/apps-info/prometheus.json
evals/self-host/scenarios/newbie-install/apps-info/prowlarr.json
evals/self-host/scenarios/newbie-install/apps-info/qbittorrent.json
evals/self-host/scenarios/newbie-install/apps-info/radarr.json
evals/self-host/scenarios/newbie-install/apps-info/renovate.json
evals/self-host/scenarios/newbie-install/apps-info/restic.json
evals/self-host/scenarios/newbie-install/apps-info/sabnzbd.json
evals/self-host/scenarios/newbie-install/apps-info/scrypted.json
evals/self-host/scenarios/newbie-install/apps-info/seafile.json
evals/self-host/scenarios/newbie-install/apps-info/seerr.json
evals/self-host/scenarios/newbie-install/apps-info/slskd.json
evals/self-host/scenarios/newbie-install/apps-info/sonarr.json
evals/self-host/scenarios/newbie-install/apps-info/speedtest-tracker.json
evals/self-host/scenarios/newbie-install/apps-info/stalwart-mail.json
evals/self-host/scenarios/newbie-install/apps-info/stirling-pdf.json
evals/self-host/scenarios/newbie-install/apps-info/syncthing.json
evals/self-host/scenarios/newbie-install/apps-info/tailscale.json
evals/self-host/scenarios/newbie-install/apps-info/tdarr.json
evals/self-host/scenarios/newbie-install/apps-info/technitium-dns.json
evals/self-host/scenarios/newbie-install/apps-info/tracearr.json
evals/self-host/scenarios/newbie-install/apps-info/traefik.json
evals/self-host/scenarios/newbie-install/apps-info/transmission.json
evals/self-host/scenarios/newbie-install/apps-info/umami.json
evals/self-host/scenarios/newbie-install/apps-info/unbound.json
evals/self-host/scenarios/newbie-install/apps-info/uptime-kuma.json
evals/self-host/scenarios/newbie-install/apps-info/valkey.json
evals/self-host/scenarios/newbie-install/apps-info/vaultwarden.json
evals/self-host/scenarios/newbie-install/apps-info/vector.json
evals/self-host/scenarios/newbie-install/apps-info/victoria-metrics.json
evals/self-host/scenarios/newbie-install/apps-info/wud.json
evals/self-host/scenarios/newbie-install/apps-info/zerotier.json
evals/self-host/scenarios/newbie-install/apps-list.json
evals/self-host/scenarios/newbie-install/config-set.jsonl
evals/self-host/scenarios/newbie-install/credentials.json
evals/self-host/scenarios/newbie-install/doctor.jsonl
evals/self-host/scenarios/newbie-install/install.jsonl
evals/self-host/scenarios/newbie-install/profile-set.json
evals/self-host/scenarios/newbie-install/profile.json
evals/self-host/scenarios/newbie-install/status-installed.json
evals/self-host/scenarios/newbie-install/status.exit
evals/self-host/scenarios/newbie-macbook/apps-info
evals/self-host/scenarios/newbie-macbook/apps-list.json
evals/self-host/scenarios/newbie-macbook/config-set.jsonl
evals/self-host/scenarios/newbie-macbook/credentials.json
evals/self-host/scenarios/newbie-macbook/doctor-docker-missing.jsonl
evals/self-host/scenarios/newbie-macbook/doctor.jsonl
evals/self-host/scenarios/newbie-macbook/install.jsonl
evals/self-host/scenarios/newbie-macbook/platform.json
evals/self-host/scenarios/newbie-macbook/profile-set.json
evals/self-host/scenarios/newbie-macbook/profile.json
evals/self-host/scenarios/newbie-macbook/status-installed.json
evals/self-host/scenarios/newbie-macbook/status.exit
evals/self-host/scenarios/newbie-mint/apps-info
evals/self-host/scenarios/newbie-mint/apps-list.json
evals/self-host/scenarios/newbie-mint/config-set.jsonl
evals/self-host/scenarios/newbie-mint/credentials.json
evals/self-host/scenarios/newbie-mint/doctor-docker-permission.jsonl
evals/self-host/scenarios/newbie-mint/doctor.jsonl
evals/self-host/scenarios/newbie-mint/install.jsonl
evals/self-host/scenarios/newbie-mint/os-release
evals/self-host/scenarios/newbie-mint/platform.json
evals/self-host/scenarios/newbie-mint/profile-set.json
evals/self-host/scenarios/newbie-mint/profile.json
evals/self-host/scenarios/newbie-mint/status-installed.json
evals/self-host/scenarios/newbie-mint/status.exit
evals/self-host/scenarios/newbie-wsl/apps-info
evals/self-host/scenarios/newbie-wsl/apps-list.json
evals/self-host/scenarios/newbie-wsl/config-set.jsonl
evals/self-host/scenarios/newbie-wsl/credentials.json
evals/self-host/scenarios/newbie-wsl/doctor-docker-missing.jsonl
evals/self-host/scenarios/newbie-wsl/doctor.jsonl
evals/self-host/scenarios/newbie-wsl/install.jsonl
evals/self-host/scenarios/newbie-wsl/os-release
evals/self-host/scenarios/newbie-wsl/platform.json
evals/self-host/scenarios/newbie-wsl/profile-set.json
evals/self-host/scenarios/newbie-wsl/profile.json
evals/self-host/scenarios/newbie-wsl/status-installed.json
evals/self-host/scenarios/newbie-wsl/status.exit
evals/self-host/scenarios/public-access/apps-info/jellyfin.json
evals/self-host/scenarios/public-access/apps-info/paperless-ngx.json
evals/self-host/scenarios/public-access/apps-info/sonarr.json
evals/self-host/scenarios/public-access/apps-list.json
evals/self-host/scenarios/public-access/cloudflare-plan.json
evals/self-host/scenarios/public-access/cloudflare-publish-ok.jsonl
evals/self-host/scenarios/public-access/cloudflare-publish.exit
evals/self-host/scenarios/public-access/cloudflare-publish.jsonl
evals/self-host/scenarios/public-access/profile.json
evals/self-host/scenarios/public-access/status-installed.json
evals/self-host/scenarios/public-access/status.json
evals/self-host/tests/fake_claude.py
evals/self-host/tests/test_execution.py
evals/self-host/tests/test_grading.py
evals/self-host/tests/test_runner.py
evals/self-host/validity.py
```

</details>

### PR 300

**[feat(video): use canonical release domain in showreel](https://github.com/ajnart/selfhost-skills/pull/300)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/video-release-domain` (`gh pr checkout 300` in a clean new clone). **Exact head:** `1a82599509947e0c6a6c300654a9bed1d6f7ab88`.
- **Base:** `main`; live captured tip `ab4c92c428a2c2c9ab284a83f79f726418c1498b`. Computed merge base `5aafb4c1833fd4cd9caf0f7beaac31e625aafe22`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **no**.
- **GitHub-reported base OID:** `5aafb4c1833fd4cd9caf0f7beaac31e625aafe22`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Change the approved showreel end card to the canonical installer command and intended repository; committed video/contact sheet/cues preserve approved v5 creative direction.
- **Source/evidence state:** Video-only source pair PASS0 is recorded; candidate is 34.000 seconds, 2040 frames, 1080p60, -13.8 LUFS / -2.0 dBTP. Visual/render measurements do not prove anonymous public installation.
- **Dependencies / stack meaning:** Semantic dependencies on #268, #193/#194/#295 and working #313 distribution, not a Git child of #313. Public publication remains held.
- **Remaining / next:** Reuse the committed render unless claims change. Resolve distribution/repository/install gates, independently verify truth of the end card and obtain explicit publication approval. Keep #268 open until its actual gates pass.
- **Captured diff:** GitHub reports 7 changed files, +272/−37; Git diff against the computed live-base merge base lists 7 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
video/reel/HANDOFF.md
video/reel/STORYBOARD.md
video/reel/audio/cues.json
video/reel/end.js
video/reel/out/contact.png
video/reel/out/selfhost-reel.mp4
video/reel/styles.css
```

</details>

### PR 310

**[feat(audiobookshelf): stage Homarr credentials and Audio Stats descriptor](https://github.com/ajnart/selfhost-skills/pull/310)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-audiobookshelf-sol` (`gh pr checkout 310` in a clean new clone). **Exact head:** `895fb166f652181745d188934bf70d8d9479bea6`.
- **Base:** `main`; live captured tip `ab4c92c428a2c2c9ab284a83f79f726418c1498b`. Computed merge base `6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **yes**.
- **GitHub-reported base OID:** `6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Prepare Audiobookshelf credentials and a native Audio Stats target; later complete saved-native semantic verification with the normalized target filename. Its credential still has administrator/all-library authority.
- **App / issue:** `audiobookshelf` / [#270](https://github.com/ajnart/selfhost-skills/issues/270). Independent main-based peer, not a child of another open PR.
- **Source state:** Complete corrected verifier source pair PASS; individually unregistered and live proof held. Later verifier completion has full source pair PASS but is individually unregistered; not imported into the tested union or runtime-accepted.
- **Actually tested source:** `5b9e0c09abc9ce2e440a90767753f5ee8e8e0b6f`, historical import base `5aafb4c1833fd4cd9caf0f7beaac31e625aafe22`. Tested leaf `internal/apps/homarr/integration_audiobookshelf.go`; next candidate leaf `internal/apps/homarr/target_audiobookshelf.go`. Tested semantic verifier present: **no**.
- **Aggregate observation:** own Setup `ok`; Homarr Link `ok`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed). Token is not fully read-only; owned audio/native rendering and lifecycle held.
- **Remaining / next:** Import reviewed 895fb166 and target_audiobookshelf.go into a NEW candidate; coordinate individual registration; exercise saved identity, Audio Stats/listening units and genuine refresh; disclose administrator/all-library authority.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Recorded source/status receipt:** https://github.com/ajnart/selfhost-skills/pull/310#issuecomment-6131643138. Confirm its actual reviewed head and scope; older reviews do not cover later commits automatically.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → Audiobookshelf (`audiobookshelf`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 6 changed files, +707/−6; Git diff against the computed live-base merge base lists 6 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
docs/catalog/traps/audiobookshelf.md
docs/homarr-audiobookshelf-stage1.md
internal/apps/audiobookshelf/audiobookshelf.go
internal/apps/audiobookshelf/audiobookshelf_test.go
internal/apps/audiobookshelf/homarr_credentials.go
internal/apps/homarr/target_audiobookshelf.go
```

</details>

### PR 311

**[fix(adguard): verify Setup credentials and prepare native Homarr data](https://github.com/ajnart/selfhost-skills/pull/311)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-adguard-sol` (`gh pr checkout 311` in a clean new clone). **Exact head:** `6731356c57d130e503ab24f28aa5cb7825355b2f`.
- **Base:** `main`; live captured tip `ab4c92c428a2c2c9ab284a83f79f726418c1498b`. Computed merge base `5aafb4c1833fd4cd9caf0f7beaac31e625aafe22`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **no**.
- **GitHub-reported base OID:** `5aafb4c1833fd4cd9caf0f7beaac31e625aafe22`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Verify AdGuard Home Setup credentials and stage its native Homarr statistics target. App prerequisite checks exist, but the tested leaf verifier is nil and its completion was cancelled.
- **App / issue:** `adguard-home` / [#266](https://github.com/ajnart/selfhost-skills/issues/266). Independent main-based peer, not a child of another open PR.
- **Source state:** Stage-1 nil verifier; cancelled completion. Individual production registration is not accepted by this handoff; reconcile the actual original branch. Aggregate union registration is not production registration.
- **Actually tested source:** `6731356c57d130e503ab24f28aa5cb7825355b2f`, historical import base `5aafb4c1833fd4cd9caf0f7beaac31e625aafe22`. Tested leaf `internal/apps/homarr/integration_adguard.go`; next candidate leaf `internal/apps/homarr/integration_adguard.go`. Tested semantic verifier present: **no**.
- **Aggregate observation:** own Setup `ok`; Homarr Link `ok`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed). App-only prerequisite proof; native percentage correctness and full Homarr lifecycle held.
- **Remaining / next:** Resume the cancelled original owner only by explicit direction; forward-merge the exact frozen contract if still needed; complete a real semantic native verifier, retain null/empty/missing distinctions and do not invent a blocked-percentage inversion.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Recorded source/status receipt:** https://github.com/ajnart/selfhost-skills/pull/311#issuecomment-6124784889. Confirm its actual reviewed head and scope; older reviews do not cover later commits automatically.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → AdGuard Home (`adguard-home`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 5 changed files, +406/−12; Git diff against the computed live-base merge base lists 5 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
docs/adguard-homarr-prerequisites.md
docs/catalog/traps/adguard-home.md
internal/apps/adguard/adguard.go
internal/apps/adguard/adguard_test.go
internal/apps/homarr/integration_adguard.go
```

</details>

### PR 312

**[feat(paperless-ngx): provision verified read-only Homarr credentials](https://github.com/ajnart/selfhost-skills/pull/312)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-paperless-sol` (`gh pr checkout 312` in a clean new clone). **Exact head:** `df16f7231e9299e9fb6c5975da6669f398f6ce30`.
- **Base:** `main`; live captured tip `ab4c92c428a2c2c9ab284a83f79f726418c1498b`. Computed merge base `5aafb4c1833fd4cd9caf0f7beaac31e625aafe22`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **no**.
- **GitHub-reported base OID:** `2bd01088e33d19f81dd85e41ec74c47a13177d45`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Provision verified read-only Paperless-ngx credentials and stage native document/widget access. The App credential slice exists; its semantic saved-native leaf verifier is still nil.
- **App / issue:** `paperless-ngx` / [#289](https://github.com/ajnart/selfhost-skills/issues/289). Independent main-based peer, not a child of another open PR.
- **Source state:** Stage-1 nil verifier; cancelled completion. Individual production registration is not accepted by this handoff; reconcile the actual original branch. Aggregate union registration is not production registration.
- **Actually tested source:** `df16f7231e9299e9fb6c5975da6669f398f6ce30`, historical import base `5aafb4c1833fd4cd9caf0f7beaac31e625aafe22`. Tested leaf `internal/apps/homarr/integration_paperless.go`; next candidate leaf `internal/apps/homarr/integration_paperless.go`. Tested semantic verifier present: **no**.
- **Aggregate observation:** own Setup `ok`; Homarr Link `ok`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed). App credential prerequisite proof only; native widget, ingestion/OCR and lifecycle not accepted.
- **Remaining / next:** Resume the cancelled original owner only by explicit direction; complete semantic saved-native document/count/widget verification through the existing seam, preserving canonical owned identity and private recovery; no OCR/ingestion run implied.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Recorded source/status receipt:** https://github.com/ajnart/selfhost-skills/pull/312#issuecomment-6124860310. Confirm its actual reviewed head and scope; older reviews do not cover later commits automatically.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → Paperless-ngx (`paperless-ngx`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 6 changed files, +628/−3; Git diff against the computed live-base merge base lists 6 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
docs/catalog/traps/paperless-ngx.md
docs/homarr-paperless-proof.md
internal/apps/homarr/integration_paperless.go
internal/apps/paperlessngx/paperlessngx.go
internal/apps/paperlessngx/paperlessngx_test.go
internal/apps/paperlessngx/token.go
```

</details>

### PR 313

**[feat(release): deploy gated installer site on selfhost.ajnart.dev](https://github.com/ajnart/selfhost-skills/pull/313)**

- **State:** OPEN; draft=yes. GitHub mergeability `CONFLICTING`, merge state `DIRTY`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/installer-site-domain` (`gh pr checkout 313` in a clean new clone). **Exact head:** `599bdafc8749ad69d1ffc1518f0239cf73e62aca`.
- **Base:** `main`; live captured tip `ab4c92c428a2c2c9ab284a83f79f726418c1498b`. Computed merge base `5aafb4c1833fd4cd9caf0f7beaac31e625aafe22`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **no**.
- **GitHub-reported base OID:** `2bd01088e33d19f81dd85e41ec74c47a13177d45`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Gated canonical installer landing/script/checksum site, strict five-file publishing allowlist and rename-gated defaults to the intended repository. Source and public artifact availability are separate.
- **Source/evidence state:** Source pair PASS0; reviewed production d3d3e78c, later head 599bdafc is documentation. Historical anonymous normal-client script/checksum HTTPS passed, but release APIs/archives and install/update were not accepted.
- **Dependencies / stack meaning:** #194 is blocked by #193; #295 tracks anonymous artifacts. #300 depends semantically on a working truthful distribution path, not on this PR ancestry. No deployment/rename/visibility operation authorized by the handoff.
- **Remaining / next:** Settle maintainer visibility/rename versus artifact-only distribution. Preserve private-source boundaries and keep new defaults held until the target resolves. Then independently prove anonymous install/self-update/old-name compatibility under separate approval.
- **Captured diff:** GitHub reports 30 changed files, +389/−62; Git diff against the computed live-base merge base lists 30 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
.github/ISSUE_TEMPLATE/config.yml
AGENTS.md
README.md
docs/adr/0006-telemetry-on-by-default.md
docs/agents/implementing.md
docs/agents/issue-tracker.md
docs/releasing.md
install.sh
internal/cli/feedback.go
internal/cli/feedback_test.go
internal/cli/telemetry_test.go
internal/release/installsh_skill_test.go
internal/release/release.go
internal/release/release_test.go
internal/skill/guide.md
internal/telemetry/telemetry.go
internal/telemetry/telemetry_test.go
internal/tui/onboarding_telemetry_test.go
internal/tui/testdata/onboarding-welcome-telemetry-narrow.golden
internal/tui/testdata/onboarding-welcome-telemetry.golden
scripts/build-installer-site.sh
scripts/publish-wiki.sh
scripts/verify-install.sh
site/_headers
site/index.html
site/site.css
site/wrangler.toml
skills/self-host/SKILL.md
wiki/Home.md
wiki/Telemetry.md
```

</details>

### PR 315

**[feat(homarr): add Caddy upstream statistics descriptor](https://github.com/ajnart/selfhost-skills/pull/315)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-caddy-sol` (`gh pr checkout 315` in a clean new clone). **Exact head:** `259033989ef44589658a3adbc3c4505175d41ae0`.
- **Base:** `main`; live captured tip `ab4c92c428a2c2c9ab284a83f79f726418c1498b`. Computed merge base `6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **yes**.
- **GitHub-reported base OID:** `6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Expose supported Caddy upstream statistics through an individually registered native Homarr target; preserve owned upstream and useful native Stats semantics.
- **App / issue:** `caddy` / [#273](https://github.com/ajnart/selfhost-skills/issues/273). Independent main-based peer, not a child of another open PR.
- **Source state:** Individually registered + complete normalized source pair PASS; native/lifecycle held. Individually registered with a normalized source pair PASS; native acceptance still held.
- **Actually tested source:** `259033989ef44589658a3adbc3c4505175d41ae0`, historical import base `6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c`. Tested leaf `internal/apps/homarr/target_caddy.go`; next candidate leaf `internal/apps/homarr/target_caddy.go`. Tested semantic verifier present: **yes**.
- **Aggregate observation:** own Setup `ok`; Homarr Link `ok`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed). Registered/source-only; real production-Link/rendered/both-order/cross-kind lifecycle held.
- **Remaining / next:** Preserve the already normalized/registered source and its complete source pass. Reconcile cumulative registration with current main, then obtain independent native/rendered/lifecycle evidence and final exact accepted-head review; do not redo unchanged source work merely to fill review slots.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Recorded source/status receipt:** https://github.com/ajnart/selfhost-skills/pull/315#issuecomment-6115733170. Confirm its actual reviewed head and scope; older reviews do not cover later commits automatically.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → Caddy (`caddy`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 5 changed files, +101/−4; Git diff against the computed live-base merge base lists 5 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
docs/catalog/traps/caddy.md
internal/apps/caddy/caddy.go
internal/apps/caddy/caddy_test.go
internal/apps/homarr/target_caddy.go
internal/apps/homarr/targets.go
```

</details>

### PR 317

**[feat(aria2): verify Homarr RPC prerequisites](https://github.com/ajnart/selfhost-skills/pull/317)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-aria2-sol` (`gh pr checkout 317` in a clean new clone). **Exact head:** `71e5c0fc1afd1732a38b299137f0001ed99a19d3`.
- **Base:** `main`; live captured tip `ab4c92c428a2c2c9ab284a83f79f726418c1498b`. Computed merge base `6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **yes**.
- **GitHub-reported base OID:** `6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Verify Aria2 RPC prerequisites and provide native Downloads/Stats verification. Later verification treats independent samples honestly instead of demanding equality between volatile samples.
- **App / issue:** `aria2` / [#269](https://github.com/ajnart/selfhost-skills/issues/269). Independent main-based peer, not a child of another open PR.
- **Source state:** Complete corrected verifier source pair PASS; individually unregistered and live proof held. Later verifier completion has full source pair PASS but is individually unregistered; not imported into the tested union or runtime-accepted.
- **Actually tested source:** `114477a54418376a9c8e3c9182446a8bcffb4d36`, historical import base `5aafb4c1833fd4cd9caf0f7beaac31e625aafe22`. Tested leaf `internal/apps/homarr/integration_aria2.go`; next candidate leaf `internal/apps/homarr/target_aria2.go`. Tested semantic verifier present: **no**.
- **Aggregate observation:** own Setup `ok`; Homarr Link `ok`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed). RPC/download prerequisite proof only; native/rendered/full lifecycle held.
- **Remaining / next:** Import reviewed 71e5c0fc and target_aria2.go into a NEW evaluation candidate; coordinate individual registration; live-check independently sampled RPC/Downloads/one-item Stats without volatile cross-sample equality.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Recorded source/status receipt:** https://github.com/ajnart/selfhost-skills/pull/317#issuecomment-6131718826. Confirm its actual reviewed head and scope; older reviews do not cover later commits automatically.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → Aria2 (`aria2`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 5 changed files, +536/−42; Git diff against the computed live-base merge base lists 5 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
docs/aria2-homarr-prerequisite-proof.md
docs/catalog/traps/aria2.md
internal/apps/aria2/aria2.go
internal/apps/aria2/aria2_test.go
internal/apps/homarr/target_aria2.go
```

</details>

### PR 318

**[feat(homarr): add Lidarr calendar and statistics descriptor](https://github.com/ajnart/selfhost-skills/pull/318)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-lidarr-sol` (`gh pr checkout 318` in a clean new clone). **Exact head:** `e8ea969a9d3a2f07ca9ba626996a6207d0cd087d`.
- **Base:** `feat/homarr-immich-sol`; live captured tip `33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`. Computed merge base `573a206e2b4a76574fd7e8cbd1f21c5a4c2fd37d`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **no**.
- **GitHub-reported base OID:** `573a206e2b4a76574fd7e8cbd1f21c5a4c2fd37d`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Provide Lidarr native music/calendar/statistics data using its supported API credentials, without authorizing external music downloads.
- **App / issue:** `lidarr` / [#283](https://github.com/ajnart/selfhost-skills/issues/283). Sibling based on the already-merged #309 reference branch, not on any other open peer. Reconcile historical common source/current main through the custodian before approved retarget/merge.
- **Source state:** Not final runtime-accepted. Individual production registration is not accepted by this handoff; reconcile the actual original branch. Aggregate union registration is not production registration.
- **Actually tested source:** `e8ea969a9d3a2f07ca9ba626996a6207d0cd087d`, historical import base `573a206e2b4a76574fd7e8cbd1f21c5a4c2fd37d`. Tested leaf `internal/apps/homarr/target_lidarr.go`; next candidate leaf `internal/apps/homarr/target_lidarr.go`. Tested semantic verifier present: **yes**.
- **Aggregate observation:** own Setup `ok`; Homarr Link `ok`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed). Calendar/music data and native lifecycle held; no external download approval.
- **Remaining / next:** No demonstrated aggregate production defect. Reuse the observed source checks, normalize/register the individual branch, complete exact-head review and obtain independent native/rendered/lifecycle evidence; preserve the App-specific scope below.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Recorded source/status receipt:** https://github.com/ajnart/selfhost-skills/pull/318#issuecomment-6124102113. Confirm its actual reviewed head and scope; older reviews do not cover later commits automatically.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → Lidarr (`lidarr`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 3 changed files, +310/−36; Git diff against the computed live-base merge base lists 3 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
internal/apps/homarr/target_lidarr.go
internal/apps/lidarr/lidarr.go
internal/apps/lidarr/lidarr_test.go
```

</details>

### PR 319

**[feat(homarr): add scoped Dashdot CPU and RAM Link](https://github.com/ajnart/selfhost-skills/pull/319)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-dashdot-sol` (`gh pr checkout 319` in a clean new clone). **Exact head:** `e0577f082b8b5d36bfa65a4dc76827e7ebb97c98`.
- **Base:** `feat/homarr-immich-sol`; live captured tip `33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`. Computed merge base `573a206e2b4a76574fd7e8cbd1f21c5a4c2fd37d`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **no**.
- **GitHub-reported base OID:** `573a206e2b4a76574fd7e8cbd1f21c5a4c2fd37d`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Provide Dashdot CPU/RAM native statistics with a narrow slice; missing hardware or privileged collectors must not be represented as zero.
- **App / issue:** `dashdot` / [#274](https://github.com/ajnart/selfhost-skills/issues/274). Sibling based on the already-merged #309 reference branch, not on any other open peer. Reconcile historical common source/current main through the custodian before approved retarget/merge.
- **Source state:** Not final runtime-accepted. Individual production registration is not accepted by this handoff; reconcile the actual original branch. Aggregate union registration is not production registration.
- **Actually tested source:** `e0577f082b8b5d36bfa65a4dc76827e7ebb97c98`, historical import base `573a206e2b4a76574fd7e8cbd1f21c5a4c2fd37d`. Tested leaf `internal/apps/homarr/target_dashdot.go`; next candidate leaf `internal/apps/homarr/target_dashdot.go`. Tested semantic verifier present: **yes**.
- **Aggregate observation:** own Setup `ok`; Homarr Link `ok`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed). CPU/RAM slice only; unavailable hardware is not zero or permission for new privileges.
- **Remaining / next:** No demonstrated aggregate production defect. Reuse the observed source checks, normalize/register the individual branch, complete exact-head review and obtain independent native/rendered/lifecycle evidence; preserve the App-specific scope below.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → Dash. (`dashdot`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 8 changed files, +535/−7; Git diff against the computed live-base merge base lists 8 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
docs/catalog/traps/dashdot.md
docs/homarr-dashdot-contract.md
internal/apps/dashdot/dashdot.go
internal/apps/dashdot/metrics.go
internal/apps/dashdot/metrics_test.go
internal/apps/homarr/target_dashdot.go
internal/apps/homarr/target_dashdot_test.go
internal/catalog/generated_test.go
```

</details>

### PR 320

**[feat(bazarr): verify API credentials and native Homarr widgets](https://github.com/ajnart/selfhost-skills/pull/320)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-bazarr-sol` (`gh pr checkout 320` in a clean new clone). **Exact head:** `ed73c7651ca5372f5ec9a880e9d66ddf1fca9093`.
- **Base:** `main`; live captured tip `ab4c92c428a2c2c9ab284a83f79f726418c1498b`. Computed merge base `6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **yes**.
- **GitHub-reported base OID:** `ab4c92c428a2c2c9ab284a83f79f726418c1498b`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Verify Bazarr API credentials and register useful native Homarr widgets; media/subtitle providers and final native lifecycle remain separate.
- **App / issue:** `bazarr` / [#272](https://github.com/ajnart/selfhost-skills/issues/272). Independent main-based peer, not a child of another open PR.
- **Source state:** Individually registered + complete normalized source pair PASS; native/lifecycle held. Individually registered with a normalized source pair PASS; native acceptance still held.
- **Actually tested source:** `ed73c7651ca5372f5ec9a880e9d66ddf1fca9093`, historical import base `6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c`. Tested leaf `internal/apps/homarr/target_bazarr.go`; next candidate leaf `internal/apps/homarr/target_bazarr.go`. Tested semantic verifier present: **yes**.
- **Aggregate observation:** own Setup `ok`; Homarr Link `ok`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed). Media/subtitle prerequisites and native lifecycle held; no provider success inferred.
- **Remaining / next:** Preserve the already normalized/registered source and its complete source pass. Reconcile cumulative registration with current main, then obtain independent native/rendered/lifecycle evidence and final exact accepted-head review; do not redo unchanged source work merely to fill review slots.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Recorded source/status receipt:** https://github.com/ajnart/selfhost-skills/pull/320#issuecomment-6127740675. Confirm its actual reviewed head and scope; older reviews do not cover later commits automatically.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → Bazarr (`bazarr`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 6 changed files, +407/−8; Git diff against the computed live-base merge base lists 6 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
docs/homarr-bazarr-source-check.md
internal/apps/bazarr/api.go
internal/apps/bazarr/bazarr.go
internal/apps/bazarr/bazarr_test.go
internal/apps/homarr/target_bazarr.go
internal/apps/homarr/targets.go
```

</details>

### PR 321

**[feat(homarr): verify Gatus local readiness and native Stats](https://github.com/ajnart/selfhost-skills/pull/321)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-gatus-sol` (`gh pr checkout 321` in a clean new clone). **Exact head:** `b8ab54070762845e7720e7c16322a6611dc82eaa`.
- **Base:** `main`; live captured tip `ab4c92c428a2c2c9ab284a83f79f726418c1498b`. Computed merge base `6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **yes**.
- **GitHub-reported base OID:** `6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Verify local Gatus readiness and register its native Stats target; actual local provenance, rendering and cross-kind preservation remain unaccepted.
- **App / issue:** `gatus` / [#280](https://github.com/ajnart/selfhost-skills/issues/280). Independent main-based peer, not a child of another open PR.
- **Source state:** Individually registered + complete normalized source pair PASS; native/lifecycle held. Individually registered with a normalized source pair PASS; native acceptance still held.
- **Actually tested source:** `b8ab54070762845e7720e7c16322a6611dc82eaa`, historical import base `6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c`. Tested leaf `internal/apps/homarr/target_gatus.go`; next candidate leaf `internal/apps/homarr/target_gatus.go`. Tested semantic verifier present: **yes**.
- **Aggregate observation:** own Setup `ok`; Homarr Link `ok`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed). Registered/source-only; real native/rendered/local provenance/both-order/cross-kind lifecycle held.
- **Remaining / next:** Preserve the already normalized/registered source and its complete source pass. Reconcile cumulative registration with current main, then obtain independent native/rendered/lifecycle evidence and final exact accepted-head review; do not redo unchanged source work merely to fill review slots.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Recorded source/status receipt:** https://github.com/ajnart/selfhost-skills/pull/321#issuecomment-6115733184. Confirm its actual reviewed head and scope; older reviews do not cover later commits automatically.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → Gatus (`gatus`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 5 changed files, +353/−15; Git diff against the computed live-base merge base lists 5 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
docs/homarr-gatus-implementation.md
internal/apps/gatus/gatus.go
internal/apps/gatus/gatus_test.go
internal/apps/homarr/target_gatus.go
internal/apps/homarr/targets.go
```

</details>

### PR 322

**[feat(emby): prepare Homarr credentials and native widgets](https://github.com/ajnart/selfhost-skills/pull/322)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-emby-sol` (`gh pr checkout 322` in a clean new clone). **Exact head:** `eed53d89603f1d89aaa4dff2ff9c5f1a94d86497`.
- **Base:** `feat/homarr-immich-sol`; live captured tip `33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`. Computed merge base `cf8f04c07da6a0394c30c5000906ac441ca4601c`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **no**.
- **GitHub-reported base OID:** `cf8f04c07da6a0394c30c5000906ac441ca4601c`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Prepare Emby credentials and native media widgets while preserving first-owner Setup as a Manual boundary.
- **App / issue:** `emby` / [#276](https://github.com/ajnart/selfhost-skills/issues/276). Sibling based on the already-merged #309 reference branch, not on any other open peer. Reconcile historical common source/current main through the custodian before approved retarget/merge.
- **Source state:** Not final runtime-accepted. Individual production registration is not accepted by this handoff; reconcile the actual original branch. Aggregate union registration is not production registration.
- **Actually tested source:** `eed53d89603f1d89aaa4dff2ff9c5f1a94d86497`, historical import base `cf8f04c07da6a0394c30c5000906ac441ca4601c`. Tested leaf `internal/apps/homarr/target_emby.go`; next candidate leaf `internal/apps/homarr/target_emby.go`. Tested semantic verifier present: **yes**.
- **Aggregate observation:** own Setup `manual`; Homarr Link `skip`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed). First-owner wizard Manual; real key inventory, media/playback and native lifecycle held.
- **Remaining / next:** First-owner wizard remains an expected Manual step. After explicit completion, verify actual owned key inventory and native data; no playback/library scans are approved.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → Emby (`emby`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 5 changed files, +523/−17; Git diff against the computed live-base merge base lists 5 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
docs/homarr-emby-implementation.md
internal/apps/emby/emby.go
internal/apps/emby/emby_test.go
internal/apps/emby/homarr.go
internal/apps/homarr/target_emby.go
```

</details>

### PR 323

**[feat(homarr): verify Warrior workers and declare native widgets](https://github.com/ajnart/selfhost-skills/pull/323)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-warrior-sol` (`gh pr checkout 323` in a clean new clone). **Exact head:** `35979a24463fc97e0e4ccd1bb45ce7eb870dca29`.
- **Base:** `feat/homarr-immich-sol`; live captured tip `33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`. Computed merge base `573a206e2b4a76574fd7e8cbd1f21c5a4c2fd37d`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **no**.
- **GitHub-reported base OID:** `cf8f04c07da6a0394c30c5000906ac441ca4601c`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Verify Warrior worker prerequisites and declare native widgets without silently authorizing HQ contact or archival downloads.
- **App / issue:** `archive-team-warrior` / [#267](https://github.com/ajnart/selfhost-skills/issues/267). Sibling based on the already-merged #309 reference branch, not on any other open peer. Reconcile historical common source/current main through the custodian before approved retarget/merge.
- **Source state:** Not final runtime-accepted. Individual production registration is not accepted by this handoff; reconcile the actual original branch. Aggregate union registration is not production registration.
- **Actually tested source:** `35979a24463fc97e0e4ccd1bb45ce7eb870dca29`, historical import base `573a206e2b4a76574fd7e8cbd1f21c5a4c2fd37d`. Tested leaf `internal/apps/homarr/target_archive_team_warrior.go`; next candidate leaf `internal/apps/homarr/target_archive_team_warrior.go`. Tested semantic verifier present: **yes**.
- **Aggregate observation:** own Setup `not-selected`; Homarr Link `not selected`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed). Idle startup can contact HQ; approved outbound scope or verified inert fail-closed bootstrap required.
- **Remaining / next:** Keep excluded until a verified inert bootstrap or explicit bounded HQ/outbound archival approval. An idle startup still contacts HQ; do not download archival data.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → ArchiveTeam Warrior (`archive-team-warrior`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 5 changed files, +327/−23; Git diff against the computed live-base merge base lists 5 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
docs/homarr-warrior-proof.md
internal/apps/archiveteamwarrior/archiveteamwarrior.go
internal/apps/archiveteamwarrior/archiveteamwarrior_test.go
internal/apps/archiveteamwarrior/status.go
internal/apps/homarr/target_archive_team_warrior.go
```

</details>

### PR 324

**[feat(deluge): verify Web credentials and native Homarr downloads](https://github.com/ajnart/selfhost-skills/pull/324)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-deluge-sol` (`gh pr checkout 324` in a clean new clone). **Exact head:** `0b3155367e6423acb3450ccc19021bace705e7a0`.
- **Base:** `feat/homarr-immich-sol`; live captured tip `33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`. Computed merge base `cf8f04c07da6a0394c30c5000906ac441ca4601c`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **no**.
- **GitHub-reported base OID:** `cf8f04c07da6a0394c30c5000906ac441ca4601c`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Verify Deluge Web credentials and a native Downloads target while keeping ambiguous daemon selection Manual.
- **App / issue:** `deluge` / [#275](https://github.com/ajnart/selfhost-skills/issues/275). Sibling based on the already-merged #309 reference branch, not on any other open peer. Reconcile historical common source/current main through the custodian before approved retarget/merge.
- **Source state:** Not final runtime-accepted. Individual production registration is not accepted by this handoff; reconcile the actual original branch. Aggregate union registration is not production registration.
- **Actually tested source:** `0b3155367e6423acb3450ccc19021bace705e7a0`, historical import base `cf8f04c07da6a0394c30c5000906ac441ca4601c`. Tested leaf `internal/apps/homarr/target_deluge.go`; next candidate leaf `internal/apps/homarr/target_deluge.go`. Tested semantic verifier present: **yes**.
- **Aggregate observation:** own Setup `ok`; Homarr Link `ok`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed). Ambiguous daemon connection remains Manual; owned download/native lifecycle held.
- **Remaining / next:** No demonstrated aggregate production defect. Reuse the observed source checks, normalize/register the individual branch, complete exact-head review and obtain independent native/rendered/lifecycle evidence; preserve the App-specific scope below.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Recorded source/status receipt:** https://github.com/ajnart/selfhost-skills/pull/324#issuecomment-6122229430. Confirm its actual reviewed head and scope; older reviews do not cover later commits automatically.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → Deluge (`deluge`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 6 changed files, +701/−49; Git diff against the computed live-base merge base lists 6 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
docs/homarr-deluge-proof.md
internal/apps/deluge/deluge.go
internal/apps/deluge/deluge_test.go
internal/apps/homarr/target_deluge.go
internal/tui/copy.go
internal/tui/copy_modal_test.go
```

</details>

### PR 325

**[feat(homarr): prepare scoped Gotify notifications Link](https://github.com/ajnart/selfhost-skills/pull/325)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-gotify-sol` (`gh pr checkout 325` in a clean new clone). **Exact head:** `384111f936710bf75cb18707b8d64274772903d7`.
- **Base:** `feat/homarr-immich-sol`; live captured tip `33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`. Computed merge base `b8f5ea0b27c1641079b834b280cc28b067119b1d`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **no**.
- **GitHub-reported base OID:** `b8f5ea0b27c1641079b834b280cc28b067119b1d`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Prepare scoped Gotify account/message access and a native notifications Link; supported authority and owned-message rendering need proof.
- **App / issue:** `gotify` / [#282](https://github.com/ajnart/selfhost-skills/issues/282). Sibling based on the already-merged #309 reference branch, not on any other open peer. Reconcile historical common source/current main through the custodian before approved retarget/merge.
- **Source state:** Not final runtime-accepted. Individual production registration is not accepted by this handoff; reconcile the actual original branch. Aggregate union registration is not production registration.
- **Actually tested source:** `384111f936710bf75cb18707b8d64274772903d7`, historical import base `b8f5ea0b27c1641079b834b280cc28b067119b1d`. Tested leaf `internal/apps/homarr/target_gotify.go`; next candidate leaf `internal/apps/homarr/target_gotify.go`. Tested semantic verifier present: **yes**.
- **Aggregate observation:** own Setup `ok`; Homarr Link `ok`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed). Normalization/registration held; actual scoped account/message/native/rendered/lifecycle proof pending.
- **Remaining / next:** No demonstrated aggregate production defect. Reuse the observed source checks, normalize/register the individual branch, complete exact-head review and obtain independent native/rendered/lifecycle evidence; preserve the App-specific scope below.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Recorded source/status receipt:** https://github.com/ajnart/selfhost-skills/pull/325#issuecomment-6115787860. Confirm its actual reviewed head and scope; older reviews do not cover later commits automatically.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → Gotify (`gotify`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 6 changed files, +496/−6; Git diff against the computed live-base merge base lists 6 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
docs/catalog/traps/gotify.md
docs/homarr-gotify-boundary.md
internal/apps/gotify/gotify.go
internal/apps/gotify/gotify_test.go
internal/apps/gotify/homarr.go
internal/apps/homarr/target_gotify.go
```

</details>

### PR 326

**[feat(homarr): add verified Glances resources Link](https://github.com/ajnart/selfhost-skills/pull/326)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-glances-sol` (`gh pr checkout 326` in a clean new clone). **Exact head:** `e68ea343cca6fdb8097d47f0f981df11d38f48dd`.
- **Base:** `feat/homarr-immich-sol`; live captured tip `33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`. Computed merge base `dce263ef822dc056558a648f8f59ea795a3e56d9`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **no**.
- **GitHub-reported base OID:** `dce263ef822dc056558a648f8f59ea795a3e56d9`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Verify Glances resource access and native statistics without weakening existing authentication to satisfy an empty-credential adapter contract.
- **App / issue:** `glances` / [#281](https://github.com/ajnart/selfhost-skills/issues/281). Sibling based on the already-merged #309 reference branch, not on any other open peer. Reconcile historical common source/current main through the custodian before approved retarget/merge.
- **Source state:** Not final runtime-accepted. Individual production registration is not accepted by this handoff; reconcile the actual original branch. Aggregate union registration is not production registration.
- **Actually tested source:** `e68ea343cca6fdb8097d47f0f981df11d38f48dd`, historical import base `dce263ef822dc056558a648f8f59ea795a3e56d9`. Tested leaf `internal/apps/homarr/target_glances.go`; next candidate leaf `internal/apps/homarr/target_glances.go`. Tested semantic verifier present: **yes**.
- **Aggregate observation:** own Setup `ok`; Homarr Link `ok`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed). Native empty-credential contract cannot justify disabling existing authentication; Manual boundary.
- **Remaining / next:** No demonstrated aggregate production defect. Reuse the observed source checks, normalize/register the individual branch, complete exact-head review and obtain independent native/rendered/lifecycle evidence; preserve the App-specific scope below.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Recorded source/status receipt:** https://github.com/ajnart/selfhost-skills/pull/326#issuecomment-6118356387. Confirm its actual reviewed head and scope; older reviews do not cover later commits automatically.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → Glances (`glances`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 6 changed files, +327/−7; Git diff against the computed live-base merge base lists 6 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
docs/catalog/traps/glances.md
docs/homarr-glances-proof.md
internal/apps/glances/glances.go
internal/apps/glances/homarr.go
internal/apps/homarr/target_glances.go
internal/catalog/generated_test.go
```

</details>

### PR 327

**[feat(gluetun): stage guarded Homarr target and separate readiness](https://github.com/ajnart/selfhost-skills/pull/327)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-gluetun-sol` (`gh pr checkout 327` in a clean new clone). **Exact head:** `7d70c832c426eb1485ef8f072d461a621cfcabb1`.
- **Base:** `feat/homarr-immich-sol`; live captured tip `33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`. Computed merge base `cf8f04c07da6a0394c30c5000906ac441ca4601c`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **no**.
- **GitHub-reported base OID:** `dce263ef822dc056558a648f8f59ea795a3e56d9`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Separate Gluetun readiness from guarded native activation. Secret-bearing native settings reads remain blocked by #332; provider/tunnel activity is excluded.
- **App / issue:** `gluetun` / [#279](https://github.com/ajnart/selfhost-skills/issues/279). Sibling based on the already-merged #309 reference branch, not on any other open peer. Reconcile historical common source/current main through the custodian before approved retarget/merge.
- **Source state:** Not final runtime-accepted. Individual production registration is not accepted by this handoff; reconcile the actual original branch. Aggregate union registration is not production registration.
- **Actually tested source:** `7d70c832c426eb1485ef8f072d461a621cfcabb1`, historical import base `cf8f04c07da6a0394c30c5000906ac441ca4601c`. Tested leaf `internal/apps/homarr/target_gluetun.go`; next candidate leaf `internal/apps/homarr/target_gluetun.go`. Tested semantic verifier present: **yes**.
- **Aggregate observation:** own Setup `not-selected`; Homarr Link `not selected`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed), #332 (open). Native blocker [#332](https://github.com/ajnart/selfhost-skills/issues/332) open; secret-bearing settings read denied; provider/tunnel scope held.
- **Remaining / next:** Resolve #332 via supported non-secret summary semantics before activation/registration; missing pre-mutation preflight is not waived by a later verifier rejection. Keep excluded.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → Gluetun (`gluetun`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 6 changed files, +214/−26; Git diff against the computed live-base merge base lists 6 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
README.md
docs/homarr-gluetun-contract.md
internal/apps/gluetun/gluetun.go
internal/apps/gluetun/gluetun_test.go
internal/apps/homarr/target_gluetun.go
internal/skill/guide.md
```

</details>

### PR 328

**[feat(linkwarden): prepare owned Homarr statistics access](https://github.com/ajnart/selfhost-skills/pull/328)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-linkwarden-sol` (`gh pr checkout 328` in a clean new clone). **Exact head:** `76ff8634ddaa70ce2f5bb757bc0427f3dcf8e72c`.
- **Base:** `feat/homarr-immich-sol`; live captured tip `33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`. Computed merge base `33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`. Live base tip in head ancestry: **yes**. Frozen production contract in ancestry: **yes**.
- **GitHub-reported base OID:** `33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Prepare owned Linkwarden statistics access and a native target, honestly retaining administrator write authority rather than describing its token as read-only.
- **App / issue:** `linkwarden` / [#286](https://github.com/ajnart/selfhost-skills/issues/286). Sibling based on the already-merged #309 reference branch, not on any other open peer. Reconcile historical common source/current main through the custodian before approved retarget/merge.
- **Source state:** Not final runtime-accepted. Individual production registration is not accepted by this handoff; reconcile the actual original branch. Aggregate union registration is not production registration.
- **Actually tested source:** `76ff8634ddaa70ce2f5bb757bc0427f3dcf8e72c`, historical import base `6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c`. Tested leaf `internal/apps/homarr/target_linkwarden.go`; next candidate leaf `internal/apps/homarr/target_linkwarden.go`. Tested semantic verifier present: **yes**.
- **Aggregate observation:** own Setup `ok`; Homarr Link `ok`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed). Token retains administrator write authority; private bookmark/native lifecycle proof held.
- **Remaining / next:** No demonstrated aggregate production defect. Reuse the observed source checks, normalize/register the individual branch, complete exact-head review and obtain independent native/rendered/lifecycle evidence; preserve the App-specific scope below.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Recorded source/status receipt:** https://github.com/ajnart/selfhost-skills/pull/328#issuecomment-6122072416. Confirm its actual reviewed head and scope; older reviews do not cover later commits automatically.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → Linkwarden (`linkwarden`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 5 changed files, +555/−16; Git diff against the computed live-base merge base lists 5 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
docs/catalog/traps/linkwarden.md
internal/apps/homarr/target_linkwarden.go
internal/apps/linkwarden/homarr.go
internal/apps/linkwarden/linkwarden.go
internal/apps/linkwarden/linkwarden_test.go
```

</details>

### PR 329

**[feat(homarr): add scoped Netdata statistics Link](https://github.com/ajnart/selfhost-skills/pull/329)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-netdata-sol` (`gh pr checkout 329` in a clean new clone). **Exact head:** `87a69b36ab077b5683b47932935f49a5fa41280b`.
- **Base:** `feat/homarr-immich-sol`; live captured tip `33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`. Computed merge base `dce263ef822dc056558a648f8f59ea795a3e56d9`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **no**.
- **GitHub-reported base OID:** `dce263ef822dc056558a648f8f59ea795a3e56d9`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Provide scoped Netdata native statistics from collectors actually available in the approved environment, not inferred Cloud or physical-hardware success.
- **App / issue:** `netdata` / [#287](https://github.com/ajnart/selfhost-skills/issues/287). Sibling based on the already-merged #309 reference branch, not on any other open peer. Reconcile historical common source/current main through the custodian before approved retarget/merge.
- **Source state:** Not final runtime-accepted. Individual production registration is not accepted by this handoff; reconcile the actual original branch. Aggregate union registration is not production registration.
- **Actually tested source:** `87a69b36ab077b5683b47932935f49a5fa41280b`, historical import base `dce263ef822dc056558a648f8f59ea795a3e56d9`. Tested leaf `internal/apps/homarr/target_netdata.go`; next candidate leaf `internal/apps/homarr/target_netdata.go`. Tested semantic verifier present: **yes**.
- **Aggregate observation:** own Setup `ok`; Homarr Link `ok`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed). Real available collector/native data and lifecycle held; no Cloud/hardware success inferred.
- **Remaining / next:** No demonstrated aggregate production defect. Reuse the observed source checks, normalize/register the individual branch, complete exact-head review and obtain independent native/rendered/lifecycle evidence; preserve the App-specific scope below.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Recorded source/status receipt:** https://github.com/ajnart/selfhost-skills/pull/329#issuecomment-6121022426. Confirm its actual reviewed head and scope; older reviews do not cover later commits automatically.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → Netdata (`netdata`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 6 changed files, +402/−8; Git diff against the computed live-base merge base lists 6 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
docs/catalog/traps/netdata.md
docs/homarr-netdata-proof.md
internal/apps/homarr/target_netdata.go
internal/apps/netdata/metrics.go
internal/apps/netdata/netdata.go
internal/catalog/generated_test.go
```

</details>

### PR 330

**[feat(navidrome): verify native Homarr music data](https://github.com/ajnart/selfhost-skills/pull/330)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-navidrome-sol` (`gh pr checkout 330` in a clean new clone). **Exact head:** `f343928008783ce6cc9b2e58f82ed6e378382631`.
- **Base:** `feat/homarr-immich-sol`; live captured tip `33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`. Computed merge base `dce263ef822dc056558a648f8f59ea795a3e56d9`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **no**.
- **GitHub-reported base OID:** `dce263ef822dc056558a648f8f59ea795a3e56d9`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Verify native Navidrome music data with supported authentication and units; shared Admin/query-secret limits and real audio/listening proof remain.
- **App / issue:** `navidrome` / [#284](https://github.com/ajnart/selfhost-skills/issues/284). Sibling based on the already-merged #309 reference branch, not on any other open peer. Reconcile historical common source/current main through the custodian before approved retarget/merge.
- **Source state:** Not final runtime-accepted. Individual production registration is not accepted by this handoff; reconcile the actual original branch. Aggregate union registration is not production registration.
- **Actually tested source:** `f343928008783ce6cc9b2e58f82ed6e378382631`, historical import base `dce263ef822dc056558a648f8f59ea795a3e56d9`. Tested leaf `internal/apps/homarr/target_navidrome.go`; next candidate leaf `internal/apps/homarr/target_navidrome.go`. Tested semantic verifier present: **yes**.
- **Aggregate observation:** own Setup `ok`; Homarr Link `ok`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed). Shared Admin scope/query-secret transport limits; owned audio/listening/native lifecycle held.
- **Remaining / next:** No demonstrated aggregate production defect. Reuse the observed source checks, normalize/register the individual branch, complete exact-head review and obtain independent native/rendered/lifecycle evidence; preserve the App-specific scope below.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Recorded source/status receipt:** https://github.com/ajnart/selfhost-skills/pull/330#issuecomment-6122653186. Confirm its actual reviewed head and scope; older reviews do not cover later commits automatically.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → Navidrome (`navidrome`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 5 changed files, +732/−5; Git diff against the computed live-base merge base lists 5 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
docs/homarr-navidrome-contract.md
internal/apps/homarr/target_navidrome.go
internal/apps/navidrome/homarr.go
internal/apps/navidrome/navidrome.go
internal/apps/navidrome/navidrome_test.go
```

</details>

### PR 331

**[feat(homarr): prepare authenticated Frigate Stats Link](https://github.com/ajnart/selfhost-skills/pull/331)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-frigate-sol` (`gh pr checkout 331` in a clean new clone). **Exact head:** `0d06cdf5133459657af2f6a126d8bb12fa3235c2`.
- **Base:** `feat/homarr-immich-sol`; live captured tip `33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`. Computed merge base `dce263ef822dc056558a648f8f59ea795a3e56d9`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **no**.
- **GitHub-reported base OID:** `dce263ef822dc056558a648f8f59ea795a3e56d9`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Prepare authenticated native Frigate Stats while preserving trusted HTTPS before mutation; no footage, hardware activation or certificate bypass is authorized.
- **App / issue:** `frigate` / [#277](https://github.com/ajnart/selfhost-skills/issues/277). Sibling based on the already-merged #309 reference branch, not on any other open peer. Reconcile historical common source/current main through the custodian before approved retarget/merge.
- **Source state:** Not final runtime-accepted. Individual production registration is not accepted by this handoff; reconcile the actual original branch. Aggregate union registration is not production registration.
- **Actually tested source:** `0d06cdf5133459657af2f6a126d8bb12fa3235c2`, historical import base `dce263ef822dc056558a648f8f59ea795a3e56d9`. Tested leaf `internal/apps/homarr/target_frigate.go`; next candidate leaf `internal/apps/homarr/target_frigate.go`. Tested semantic verifier present: **yes**.
- **Aggregate observation:** own Setup `ok`; Homarr Link `manual`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed). Trusted HTTPS prerequisite; authenticated HTTP starter remains Manual before mutation; no footage/hardware proof.
- **Remaining / next:** Carry separately reviewed #355 only through custodian reconciliation. Trusted HTTPS and both CLI/Homarr trust need explicit approval; no port 5000, disabled auth or certificate bypass.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → Frigate (`frigate`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 5 changed files, +352/−20; Git diff against the computed live-base merge base lists 5 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
docs/catalog/traps/frigate.md
docs/homarr-frigate-contract.md
internal/apps/frigate/frigate.go
internal/apps/frigate/frigate_test.go
internal/apps/homarr/target_frigate.go
```

</details>

### PR 333

**[feat(home-assistant): add read-only Homarr token and entity slice](https://github.com/ajnart/selfhost-skills/pull/333)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-home-assistant-sol` (`gh pr checkout 333` in a clean new clone). **Exact head:** `2ea747b1ee94f8a50c8741230b245aedb9cd12b4`.
- **Base:** `feat/homarr-immich-sol`; live captured tip `33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`. Computed merge base `dce263ef822dc056558a648f8f59ea795a3e56d9`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **no**.
- **GitHub-reported base OID:** `795c6d082c8affd213447e0629328fb7ba9d2fe4`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Prepare a read-only Home Assistant token/entity slice with owner/MFA/entity prerequisites. The aggregate Setup failed without its underlying helper diagnostic; the optional diagnostic repair was cancelled.
- **App / issue:** `home-assistant` / [#285](https://github.com/ajnart/selfhost-skills/issues/285). Sibling based on the already-merged #309 reference branch, not on any other open peer. Reconcile historical common source/current main through the custodian before approved retarget/merge.
- **Source state:** Not final runtime-accepted. Individual production registration is not accepted by this handoff; reconcile the actual original branch. Aggregate union registration is not production registration.
- **Actually tested source:** `2ea747b1ee94f8a50c8741230b245aedb9cd12b4`, historical import base `dce263ef822dc056558a648f8f59ea795a3e56d9`. Tested leaf `internal/apps/homarr/target_home_assistant.go`; next candidate leaf `internal/apps/homarr/target_home_assistant.go`. Tested semantic verifier present: **yes**.
- **Aggregate observation:** own Setup `incomplete`; Homarr Link `skip`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed). Owner/MFA/token/entity Manual gates; no real-device automation or guessed entity acceptance.
- **Remaining / next:** Optionally resume safe diagnostic forwarding after redaction review. Capture stage/category plus redacted exec/log evidence before claiming an authentication or token fix; preserve owner/MFA/entity Manual boundaries.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → Home Assistant (`home-assistant`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 7 changed files, +729/−8; Git diff against the computed live-base merge base lists 7 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
docs/catalog/traps/home-assistant.md
docs/home-assistant-homarr-contract.md
internal/apps/homarr/target_home_assistant.go
internal/apps/homeassistant/homarr.go
internal/apps/homeassistant/homarr_auth.go
internal/apps/homeassistant/homeassistant.go
internal/apps/homeassistant/homeassistant_test.go
```

</details>

### PR 334

**[feat(homarr): verify SABnzbd credentials and native widgets](https://github.com/ajnart/selfhost-skills/pull/334)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-sabnzbd-sol` (`gh pr checkout 334` in a clean new clone). **Exact head:** `908931b24cf9c013768fce1a94c64e96aa37f109`.
- **Base:** `feat/homarr-immich-sol`; live captured tip `33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`. Computed merge base `dce263ef822dc056558a648f8f59ea795a3e56d9`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **no**.
- **GitHub-reported base OID:** `795c6d082c8affd213447e0629328fb7ba9d2fe4`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Verify SABnzbd credentials and native queue/download widgets without treating missing external-provider configuration as a completed Setup.
- **App / issue:** `sabnzbd` / [#298](https://github.com/ajnart/selfhost-skills/issues/298). Sibling based on the already-merged #309 reference branch, not on any other open peer. Reconcile historical common source/current main through the custodian before approved retarget/merge.
- **Source state:** Not final runtime-accepted. Individual production registration is not accepted by this handoff; reconcile the actual original branch. Aggregate union registration is not production registration.
- **Actually tested source:** `908931b24cf9c013768fce1a94c64e96aa37f109`, historical import base `dce263ef822dc056558a648f8f59ea795a3e56d9`. Tested leaf `internal/apps/homarr/target_sabnzbd.go`; next candidate leaf `internal/apps/homarr/target_sabnzbd.go`. Tested semantic verifier present: **yes**.
- **Aggregate observation:** own Setup `manual`; Homarr Link `skip`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed). Full API key/provider Manual gate; no Usenet transfer or native lifecycle acceptance.
- **Remaining / next:** Enabled consecutive provider configuration remains Manual; authenticated empty config is not failed authentication. Do not create fake provider success or transfer Usenet data.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Recorded source/status receipt:** https://github.com/ajnart/selfhost-skills/pull/334#issuecomment-6123210143. Confirm its actual reviewed head and scope; older reviews do not cover later commits automatically.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → SABnzbd (`sabnzbd`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 6 changed files, +622/−14; Git diff against the computed live-base merge base lists 6 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
docs/catalog/traps/sabnzbd.md
docs/homarr-sabnzbd-contract.md
internal/apps/homarr/target_sabnzbd.go
internal/apps/sabnzbd/api.go
internal/apps/sabnzbd/sabnzbd.go
internal/apps/sabnzbd/sabnzbd_test.go
```

</details>

### PR 335

**[feat(nzbget): prepare restricted Homarr Downloads access](https://github.com/ajnart/selfhost-skills/pull/335)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-nzbget-sol` (`gh pr checkout 335` in a clean new clone). **Exact head:** `d03616aac0a2aa902097cbd7062d99abf514f891`.
- **Base:** `feat/homarr-immich-sol`; live captured tip `33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`. Computed merge base `795c6d082c8affd213447e0629328fb7ba9d2fe4`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **no**.
- **GitHub-reported base OID:** `795c6d082c8affd213447e0629328fb7ba9d2fe4`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Prepare restricted NZBGet Downloads access. Later diagnostic forwarding exposes only already-redacted persistence errors; it does not repair persistence or resolve downstream credential-path risk #354.
- **App / issue:** `nzbget` / [#290](https://github.com/ajnart/selfhost-skills/issues/290). Sibling based on the already-merged #309 reference branch, not on any other open peer. Reconcile historical common source/current main through the custodian before approved retarget/merge.
- **Source state:** Complete source pair PASS on diagnostic pin; activation privacy-held by #354. Individual production registration is not accepted by this handoff; reconcile the actual original branch. Aggregate union registration is not production registration.
- **Actually tested source:** `52eab49981b87fed11ba6a9e152ebf1eab2a07ab`, historical import base `795c6d082c8affd213447e0629328fb7ba9d2fe4`. Tested leaf `internal/apps/homarr/target_nzbget.go`; next candidate leaf `internal/apps/homarr/target_nzbget.go`. Tested semantic verifier present: **yes**.
- **Aggregate observation:** own Setup `incomplete`; Homarr Link `skip`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed), #354 (open). Restricted login is not read-only; provider/native/credential-path redaction/lifecycle held.
- **Remaining / next:** Use diagnostic-reviewed d03616aa; independently review prepared argv guard and any exact one-use owned-service restart policy. Capture the real save/permission/subprocess result. Native activation stays blocked by #354.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Recorded source/status receipt:** https://github.com/ajnart/selfhost-skills/pull/335#issuecomment-6131251720. Confirm its actual reviewed head and scope; older reviews do not cover later commits automatically.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → NZBGet (`nzbget`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 6 changed files, +959/−14; Git diff against the computed live-base merge base lists 6 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
docs/homarr-nzbget-proof.md
internal/apps/homarr/links.go
internal/apps/homarr/target_nzbget.go
internal/apps/nzbget/homarr.go
internal/apps/nzbget/nzbget.go
internal/apps/nzbget/nzbget_test.go
```

</details>

### PR 336

**[feat(homarr): add verified Prometheus target statistics](https://github.com/ajnart/selfhost-skills/pull/336)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-prometheus-sol` (`gh pr checkout 336` in a clean new clone). **Exact head:** `2231ee7542a1fe6082ec8f0a568ebb2ffa2dd17b`.
- **Base:** `main`; live captured tip `ab4c92c428a2c2c9ab284a83f79f726418c1498b`. Computed merge base `6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **yes**.
- **GitHub-reported base OID:** `6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Register verified Prometheus target statistics using supported native values and useful local target provenance.
- **App / issue:** `prometheus` / [#299](https://github.com/ajnart/selfhost-skills/issues/299). Independent main-based peer, not a child of another open PR.
- **Source state:** Individually registered + complete normalized source pair PASS; native/lifecycle held. Individually registered with a normalized source pair PASS; native acceptance still held.
- **Actually tested source:** `2231ee7542a1fe6082ec8f0a568ebb2ffa2dd17b`, historical import base `6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c`. Tested leaf `internal/apps/homarr/target_prometheus.go`; next candidate leaf `internal/apps/homarr/target_prometheus.go`. Tested semantic verifier present: **yes**.
- **Aggregate observation:** own Setup `ok`; Homarr Link `ok`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed). Registered/source-only; native/rendered/Basic-mode/both-order/cross-kind lifecycle held.
- **Remaining / next:** Preserve the already normalized/registered source and its complete source pass. Reconcile cumulative registration with current main, then obtain independent native/rendered/lifecycle evidence and final exact accepted-head review; do not redo unchanged source work merely to fill review slots.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Recorded source/status receipt:** https://github.com/ajnart/selfhost-skills/pull/336#issuecomment-6115733177. Confirm its actual reviewed head and scope; older reviews do not cover later commits automatically.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → Prometheus (`prometheus`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 7 changed files, +452/−12; Git diff against the computed live-base merge base lists 7 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
docs/homarr-prometheus-contract.md
internal/apps/homarr/target_prometheus.go
internal/apps/homarr/targets.go
internal/apps/prometheus/prometheus.go
internal/apps/prometheus/prometheus_test.go
internal/apps/prometheus/readiness.go
internal/catalog/generated_test.go
```

</details>

### PR 337

**[feat(homarr): verify Transmission RPC and native download widgets](https://github.com/ajnart/selfhost-skills/pull/337)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-transmission-sol` (`gh pr checkout 337` in a clean new clone). **Exact head:** `dc9c2ea0166ed139fc4f799333272bc13ac7f442`.
- **Base:** `feat/homarr-immich-sol`; live captured tip `33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`. Computed merge base `795c6d082c8affd213447e0629328fb7ba9d2fe4`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **no**.
- **GitHub-reported base OID:** `795c6d082c8affd213447e0629328fb7ba9d2fe4`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Verify Transmission RPC authentication and supported native download widgets; provider/download work remains separately scoped.
- **App / issue:** `transmission` / [#305](https://github.com/ajnart/selfhost-skills/issues/305). Sibling based on the already-merged #309 reference branch, not on any other open peer. Reconcile historical common source/current main through the custodian before approved retarget/merge.
- **Source state:** Not final runtime-accepted. Individual production registration is not accepted by this handoff; reconcile the actual original branch. Aggregate union registration is not production registration.
- **Actually tested source:** `dc9c2ea0166ed139fc4f799333272bc13ac7f442`, historical import base `795c6d082c8affd213447e0629328fb7ba9d2fe4`. Tested leaf `internal/apps/homarr/target_transmission.go`; next candidate leaf `internal/apps/homarr/target_transmission.go`. Tested semantic verifier present: **yes**.
- **Aggregate observation:** own Setup `ok`; Homarr Link `ok`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed). Full-control RPC login; harmless owned fixture/native lifecycle held; no whitelist/auth weakening.
- **Remaining / next:** No demonstrated aggregate production defect. Reuse the observed source checks, normalize/register the individual branch, complete exact-head review and obtain independent native/rendered/lifecycle evidence; preserve the App-specific scope below.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Recorded source/status receipt:** https://github.com/ajnart/selfhost-skills/pull/337#issuecomment-6122229434. Confirm its actual reviewed head and scope; older reviews do not cover later commits automatically.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → Transmission (`transmission`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 4 changed files, +242/−33; Git diff against the computed live-base merge base lists 4 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
docs/catalog/traps/transmission.md
internal/apps/homarr/target_transmission.go
internal/apps/transmission/transmission.go
internal/apps/transmission/transmission_test.go
```

</details>

### PR 338

**[feat(homarr): prepare owned Technitium DNS statistics](https://github.com/ajnart/selfhost-skills/pull/338)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-technitium-sol` (`gh pr checkout 338` in a clean new clone). **Exact head:** `aafb8c4e71cc8d6dabb27ee4e3a8d2a34c9cd631`.
- **Base:** `feat/homarr-immich-sol`; live captured tip `33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`. Computed merge base `795c6d082c8affd213447e0629328fb7ba9d2fe4`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **no**.
- **GitHub-reported base OID:** `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Prepare owned Technitium DNS statistics with supported credentials; avoid host-resolver changes and preserve real native counts/units.
- **App / issue:** `technitium-dns` / [#303](https://github.com/ajnart/selfhost-skills/issues/303). Sibling based on the already-merged #309 reference branch, not on any other open peer. Reconcile historical common source/current main through the custodian before approved retarget/merge.
- **Source state:** Not final runtime-accepted. Individual production registration is not accepted by this handoff; reconcile the actual original branch. Aggregate union registration is not production registration.
- **Actually tested source:** `aafb8c4e71cc8d6dabb27ee4e3a8d2a34c9cd631`, historical import base `795c6d082c8affd213447e0629328fb7ba9d2fe4`. Tested leaf `internal/apps/homarr/target_technitium_dns.go`; next candidate leaf `internal/apps/homarr/target_technitium_dns.go`. Tested semantic verifier present: **yes**.
- **Aggregate observation:** own Setup `ok`; Homarr Link `ok`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed). Effective account permissions/LastHour semantics and native lifecycle held; no resolver/zone/control actions.
- **Remaining / next:** No demonstrated aggregate production defect. Reuse the observed source checks, normalize/register the individual branch, complete exact-head review and obtain independent native/rendered/lifecycle evidence; preserve the App-specific scope below.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → Technitium DNS (`technitium-dns`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 4 changed files, +578/−30; Git diff against the computed live-base merge base lists 4 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
docs/catalog/traps/technitium-dns.md
internal/apps/homarr/target_technitium_dns.go
internal/apps/technitiumdns/technitiumdns.go
internal/apps/technitiumdns/technitiumdns_test.go
```

</details>

### PR 339

**[feat(pihole): prepare verified Homarr application-password statistics](https://github.com/ajnart/selfhost-skills/pull/339)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-pihole-sol` (`gh pr checkout 339` in a clean new clone). **Exact head:** `64be8d4ba38fb0e6f92e7f7d00d560603da37f87`.
- **Base:** `feat/homarr-immich-sol`; live captured tip `33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`. Computed merge base `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **no**.
- **GitHub-reported base OID:** `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Prepare Pi-hole v6 application-password statistics with explicit authentication/2FA scope; container-local DNS evidence is not permission to change host DNS.
- **App / issue:** `pihole` / [#292](https://github.com/ajnart/selfhost-skills/issues/292). Sibling based on the already-merged #309 reference branch, not on any other open peer. Reconcile historical common source/current main through the custodian before approved retarget/merge.
- **Source state:** Not final runtime-accepted. Individual production registration is not accepted by this handoff; reconcile the actual original branch. Aggregate union registration is not production registration.
- **Actually tested source:** `64be8d4ba38fb0e6f92e7f7d00d560603da37f87`, historical import base `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Tested leaf `internal/apps/homarr/target_pihole.go`; next candidate leaf `internal/apps/homarr/target_pihole.go`. Tested semantic verifier present: **yes**.
- **Aggregate observation:** own Setup `ok`; Homarr Link `ok`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed). v6 application-password/2FA scope gates; container-local DNS/native lifecycle held; no controls.
- **Remaining / next:** No demonstrated aggregate production defect. Reuse the observed source checks, normalize/register the individual branch, complete exact-head review and obtain independent native/rendered/lifecycle evidence; preserve the App-specific scope below.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → Pi-hole (`pihole`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 6 changed files, +616/−12; Git diff against the computed live-base merge base lists 6 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
docs/catalog/traps/pihole.md
internal/apps/homarr/target_pihole.go
internal/apps/pihole/homarr.go
internal/apps/pihole/install_test.go
internal/apps/pihole/pihole.go
internal/apps/pihole/pihole_test.go
```

</details>

### PR 340

**[feat(nextcloud): prepare credentials and native Homarr widgets](https://github.com/ajnart/selfhost-skills/pull/340)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-nextcloud-sol` (`gh pr checkout 340` in a clean new clone). **Exact head:** `21f74e29d9c7e75da04c0410a2fcad717cc2f75f`.
- **Base:** `feat/homarr-immich-sol`; live captured tip `33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`. Computed merge base `795c6d082c8affd213447e0629328fb7ba9d2fe4`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **no**.
- **GitHub-reported base OID:** `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Prepare native Nextcloud widgets/credentials while disclosing broad administrator app-password and 2FA tradeoffs; calendar/notifications need useful proof.
- **App / issue:** `nextcloud` / [#288](https://github.com/ajnart/selfhost-skills/issues/288). Sibling based on the already-merged #309 reference branch, not on any other open peer. Reconcile historical common source/current main through the custodian before approved retarget/merge.
- **Source state:** Not final runtime-accepted. Individual production registration is not accepted by this handoff; reconcile the actual original branch. Aggregate union registration is not production registration.
- **Actually tested source:** `21f74e29d9c7e75da04c0410a2fcad717cc2f75f`, historical import base `795c6d082c8affd213447e0629328fb7ba9d2fe4`. Tested leaf `internal/apps/homarr/target_nextcloud.go`; next candidate leaf `internal/apps/homarr/target_nextcloud.go`. Tested semantic verifier present: **yes**.
- **Aggregate observation:** own Setup `ok`; Homarr Link `ok`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed). Broad administrator app-password/2FA tradeoff; real calendar/notification/lifecycle held.
- **Remaining / next:** No demonstrated aggregate production defect. Reuse the observed source checks, normalize/register the individual branch, complete exact-head review and obtain independent native/rendered/lifecycle evidence; preserve the App-specific scope below.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Recorded source/status receipt:** https://github.com/ajnart/selfhost-skills/pull/340#issuecomment-6118250647. Confirm its actual reviewed head and scope; older reviews do not cover later commits automatically.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → Nextcloud (`nextcloud`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 3 changed files, +660/−68; Git diff against the computed live-base merge base lists 3 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
internal/apps/homarr/target_nextcloud.go
internal/apps/nextcloud/nextcloud.go
internal/apps/nextcloud/nextcloud_test.go
```

</details>

### PR 341

**[feat(homarr): add explicit Uptime Kuma status-page Link](https://github.com/ajnart/selfhost-skills/pull/341)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-uptime-kuma-sol` (`gh pr checkout 341` in a clean new clone). **Exact head:** `980e9c8730a1c9acec11a5250ba9e8a589ff9979`.
- **Base:** `feat/homarr-immich-sol`; live captured tip `33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`. Computed merge base `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **no**.
- **GitHub-reported base OID:** `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Provide an explicit Uptime Kuma status-page Link selected by its owner; do not adopt or invent an existing status page or finish administrator Setup automatically.
- **App / issue:** `uptime-kuma` / [#307](https://github.com/ajnart/selfhost-skills/issues/307). Sibling based on the already-merged #309 reference branch, not on any other open peer. Reconcile historical common source/current main through the custodian before approved retarget/merge.
- **Source state:** Not final runtime-accepted. Individual production registration is not accepted by this handoff; reconcile the actual original branch. Aggregate union registration is not production registration.
- **Actually tested source:** `980e9c8730a1c9acec11a5250ba9e8a589ff9979`, historical import base `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Tested leaf `internal/apps/homarr/target_uptime_kuma.go`; next candidate leaf `internal/apps/homarr/target_uptime_kuma.go`. Tested semantic verifier present: **yes**.
- **Aggregate observation:** own Setup `manual`; Homarr Link `skip`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed). Explicit existing status-page slug; admin/key modes Manual, no private-page/publication inference.
- **Remaining / next:** Preserve administrator and intentionally selected existing status-page slug prerequisites. Do not guess/adopt/publish a page or treat an API key as protecting public page JSON.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → Uptime Kuma (`uptime-kuma`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 4 changed files, +294/−12; Git diff against the computed live-base merge base lists 4 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
docs/catalog/traps/uptime-kuma.md
internal/apps/homarr/target_uptime_kuma.go
internal/apps/uptimekuma/uptimekuma.go
internal/catalog/testdata/legacy-facts.json
```

</details>

### PR 342

**[feat(homarr): prepare Slskd downloads and provider readiness](https://github.com/ajnart/selfhost-skills/pull/342)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-slskd-sol` (`gh pr checkout 342` in a clean new clone). **Exact head:** `2cf210a6700b6a6d2a39fb57bb511ff17d6cec96`.
- **Base:** `feat/homarr-immich-sol`; live captured tip `33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`. Computed merge base `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **no**.
- **GitHub-reported base OID:** `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Prepare native Slskd downloads/provider readiness without activating the external provider or authorizing downloads; startup remains excluded.
- **App / issue:** `slskd` / [#297](https://github.com/ajnart/selfhost-skills/issues/297). Sibling based on the already-merged #309 reference branch, not on any other open peer. Reconcile historical common source/current main through the custodian before approved retarget/merge.
- **Source state:** Not final runtime-accepted. Individual production registration is not accepted by this handoff; reconcile the actual original branch. Aggregate union registration is not production registration.
- **Actually tested source:** `2cf210a6700b6a6d2a39fb57bb511ff17d6cec96`, historical import base `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Tested leaf `internal/apps/homarr/target_slskd.go`; next candidate leaf `internal/apps/homarr/target_slskd.go`. Tested semantic verifier present: **yes**.
- **Aggregate observation:** own Setup `not-selected`; Homarr Link `not selected`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed). Soulseek login Manual; effective ReadOnly role/write denial and native lifecycle unproved.
- **Remaining / next:** Keep excluded until provider/network authorization; verify effective ReadOnly authority rather than assuming the configured role prevents writes.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → Slskd (`slskd`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 5 changed files, +339/−6; Git diff against the computed live-base merge base lists 5 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
docs/catalog/traps/slskd.md
internal/apps/homarr/target_slskd.go
internal/apps/slskd/homarr.go
internal/apps/slskd/slskd.go
internal/apps/slskd/slskd_test.go
```

</details>

### PR 343

**[feat(homarr): add authenticated WUD update widgets](https://github.com/ajnart/selfhost-skills/pull/343)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-wud-sol` (`gh pr checkout 343` in a clean new clone). **Exact head:** `00d57bf6610473938789c5b95189b18309cc1973`.
- **Base:** `feat/homarr-immich-sol`; live captured tip `33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`. Computed merge base `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **no**.
- **GitHub-reported base OID:** `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Provide authenticated WUD update widgets without arbitrary discovery, host socket mounting or externally scheduled update actions.
- **App / issue:** `wud` / [#306](https://github.com/ajnart/selfhost-skills/issues/306). Sibling based on the already-merged #309 reference branch, not on any other open peer. Reconcile historical common source/current main through the custodian before approved retarget/merge.
- **Source state:** Not final runtime-accepted. Individual production registration is not accepted by this handoff; reconcile the actual original branch. Aggregate union registration is not production registration.
- **Actually tested source:** `00d57bf6610473938789c5b95189b18309cc1973`, historical import base `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Tested leaf `internal/apps/homarr/target_wud.go`; next candidate leaf `internal/apps/homarr/target_wud.go`. Tested semantic verifier present: **yes**.
- **Aggregate observation:** own Setup `not-selected`; Homarr Link `not selected`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed). Scoped discovery endpoint and registry-outbound approval required; labels are not Project-only authority; inert inventory not real monitoring.
- **Remaining / next:** Keep excluded until Project-scoped discovery and registry outbound are explicitly scoped; no real Docker socket mounts, host watchers or unfiltered discovery.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → What's Up Docker (`wud`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 7 changed files, +371/−9; Git diff against the computed live-base merge base lists 7 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
docs/catalog/traps/wud.md
docs/homarr-wud-proof.md
internal/apps/homarr/target_wud.go
internal/apps/wud/discovery_test.go
internal/apps/wud/preflight_test.go
internal/apps/wud/wud.go
internal/apps/wud/wud_test.go
```

</details>

### PR 344

**[feat(homarr): prepare owned Umami analytics connection](https://github.com/ajnart/selfhost-skills/pull/344)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-umami-sol` (`gh pr checkout 344` in a clean new clone). **Exact head:** `b6fe06345f84005290cb12e187d1ad983a19b354`.
- **Base:** `feat/homarr-immich-sol`; live captured tip `33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`. Computed merge base `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **no**.
- **GitHub-reported base OID:** `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Prepare an owned native Umami analytics connection and supported widget data. Umami has no shared Stats provider; do not manufacture one for a cross-kind requirement.
- **App / issue:** `umami` / [#308](https://github.com/ajnart/selfhost-skills/issues/308). Sibling based on the already-merged #309 reference branch, not on any other open peer. Reconcile historical common source/current main through the custodian before approved retarget/merge.
- **Source state:** Not final runtime-accepted. Individual production registration is not accepted by this handoff; reconcile the actual original branch. Aggregate union registration is not production registration.
- **Actually tested source:** `b6fe06345f84005290cb12e187d1ad983a19b354`, historical import base `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Tested leaf `internal/apps/homarr/target_umami.go`; next candidate leaf `internal/apps/homarr/target_umami.go`. Tested semantic verifier present: **yes**.
- **Aggregate observation:** own Setup `ok`; Homarr Link `ok`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed). View-only role still owns website writes; real chart/controlled visits/lifecycle held; no shared Stats provider.
- **Remaining / next:** No demonstrated aggregate production defect. Reuse the observed source checks, normalize/register the individual branch, complete exact-head review and obtain independent native/rendered/lifecycle evidence; preserve the App-specific scope below.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → Umami (`umami`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 6 changed files, +686/−16; Git diff against the computed live-base merge base lists 6 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
docs/catalog/traps/umami.md
docs/homarr-umami-source-proof.md
internal/apps/homarr/target_umami.go
internal/apps/umami/homarr.go
internal/apps/umami/umami.go
internal/apps/umami/umami_test.go
```

</details>

### PR 345

**[feat(homarr): prepare PatchMon Link with read-only credential hold](https://github.com/ajnart/selfhost-skills/pull/345)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-patchmon-sol` (`gh pr checkout 345` in a clean new clone). **Exact head:** `05f68f3bd937bdec2bb0efd32c0e171c08a794c2`.
- **Base:** `feat/homarr-immich-sol`; live captured tip `33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`. Computed merge base `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **no**.
- **GitHub-reported base OID:** `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Stage PatchMon native statistics behind a credential-authority hold. Readiness refusal and statistics/enrollment authority #350 are two distinct unresolved boundaries.
- **App / issue:** `patchmon` / [#291](https://github.com/ajnart/selfhost-skills/issues/291). Sibling based on the already-merged #309 reference branch, not on any other open peer. Reconcile historical common source/current main through the custodian before approved retarget/merge.
- **Source state:** Not final runtime-accepted. Individual production registration is not accepted by this handoff; reconcile the actual original branch. Aggregate union registration is not production registration.
- **Actually tested source:** `05f68f3bd937bdec2bb0efd32c0e171c08a794c2`, historical import base `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Tested leaf `internal/apps/homarr/target_patchmon.go`; next candidate leaf `internal/apps/homarr/target_patchmon.go`. Tested semantic verifier present: **yes**.
- **Aggregate observation:** own Setup `incomplete`; Homarr Link `skip`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed), #350 (open). Native blocker [#350](https://github.com/ajnart/selfhost-skills/issues/350) open; statistics credentials also authorize enrollment; issuance/registration held.
- **Remaining / next:** Capture owned server/dependency startup logs and listener chronology for connection refusal. Separately resolve #350 statistics/enrollment authority before issuing or activating credentials.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Recorded source/status receipt:** https://github.com/ajnart/selfhost-skills/pull/345#issuecomment-6114026819. Confirm its actual reviewed head and scope; older reviews do not cover later commits automatically.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → PatchMon (`patchmon`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 5 changed files, +315/−9; Git diff against the computed live-base merge base lists 5 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
docs/catalog/traps/patchmon.md
docs/homarr-patchmon-contract.md
internal/apps/homarr/target_patchmon.go
internal/apps/patchmon/homarr.go
internal/apps/patchmon/patchmon.go
```

</details>

### PR 346

**[feat(homarr): add owned Tracearr connection slice](https://github.com/ajnart/selfhost-skills/pull/346)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-tracearr-sol` (`gh pr checkout 346` in a clean new clone). **Exact head:** `ab4ac17a94c0ee42807e8cf6bc16c5f5241e3c6f`.
- **Base:** `feat/homarr-immich-sol`; live captured tip `33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`. Computed merge base `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **no**.
- **GitHub-reported base OID:** `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Provide an owned Tracearr native connection with an authenticated exact-version gate; capture actual field/type/value before proposing a version correction.
- **App / issue:** `tracearr` / [#302](https://github.com/ajnart/selfhost-skills/issues/302). Sibling based on the already-merged #309 reference branch, not on any other open peer. Reconcile historical common source/current main through the custodian before approved retarget/merge.
- **Source state:** Not final runtime-accepted. Individual production registration is not accepted by this handoff; reconcile the actual original branch. Aggregate union registration is not production registration.
- **Actually tested source:** `ab4ac17a94c0ee42807e8cf6bc16c5f5241e3c6f`, historical import base `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Tested leaf `internal/apps/homarr/target_tracearr.go`; next candidate leaf `internal/apps/homarr/target_tracearr.go`. Tested semantic verifier present: **yes**.
- **Aggregate observation:** own Setup `incomplete`; Homarr Link `skip`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed). Owner key can terminate streams; owned online media-server prerequisite and native lifecycle held.
- **Remaining / next:** Capture actual authenticated API version field/type/value and matching image provenance with safe evidence capture. Keep the exact gate until a supported contract is demonstrated; no media-server/provider access implied.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → Tracearr (`tracearr`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 4 changed files, +456/−2; Git diff against the computed live-base merge base lists 4 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
docs/catalog/traps/tracearr.md
internal/apps/homarr/target_tracearr.go
internal/apps/tracearr/homarr.go
internal/apps/tracearr/tracearr.go
```

</details>

### PR 347

**[feat(homarr): add guarded PeaNUT UPS and native Stats descriptor](https://github.com/ajnart/selfhost-skills/pull/347)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-peanut-sol` (`gh pr checkout 347` in a clean new clone). **Exact head:** `fc5583b0f5b45e137464c06e67213e0f7ff6e75d`.
- **Base:** `feat/homarr-immich-sol`; live captured tip `33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`. Computed merge base `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **no**.
- **GitHub-reported base OID:** `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Prepare guarded PeaNUT native UPS statistics after owner-selected NUT/UPS prerequisites. A dummy API proves parsing, not physical UPS health.
- **App / issue:** `peanut` / [#293](https://github.com/ajnart/selfhost-skills/issues/293). Sibling based on the already-merged #309 reference branch, not on any other open peer. Reconcile historical common source/current main through the custodian before approved retarget/merge.
- **Source state:** Not final runtime-accepted. Individual production registration is not accepted by this handoff; reconcile the actual original branch. Aggregate union registration is not production registration.
- **Actually tested source:** `fc5583b0f5b45e137464c06e67213e0f7ff6e75d`, historical import base `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Tested leaf `internal/apps/homarr/target_peanut.go`; next candidate leaf `internal/apps/homarr/target_peanut.go`. Tested semantic verifier present: **yes**.
- **Aggregate observation:** own Setup `manual`; Homarr Link `skip`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed). NUT/UPS readings Manual; dummy API data is not physical hardware-health proof.
- **Remaining / next:** Owner-selected NUT/UPS is an expected Manual prerequisite. A dummy local API can prove parsing only, not physical UPS readings or health.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → PeaNUT (`peanut`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 4 changed files, +280/−19; Git diff against the computed live-base merge base lists 4 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
docs/catalog/traps/peanut.md
internal/apps/homarr/target_peanut.go
internal/apps/peanut/peanut.go
internal/apps/peanut/peanut_test.go
```

</details>

### PR 348

**[feat(homarr): verified Plex credential and native widget slice](https://github.com/ajnart/selfhost-skills/pull/348)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-plex-sol` (`gh pr checkout 348` in a clean new clone). **Exact head:** `8db89ddd50574153405c0d1a60dee18e0dfa16d0`.
- **Base:** `feat/homarr-immich-sol`; live captured tip `33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`. Computed merge base `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **no**.
- **GitHub-reported base OID:** `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Prepare verified Plex credentials/native media widgets without initiating external account/claim/provider actions; startup remains excluded.
- **App / issue:** `plex` / [#294](https://github.com/ajnart/selfhost-skills/issues/294). Sibling based on the already-merged #309 reference branch, not on any other open peer. Reconcile historical common source/current main through the custodian before approved retarget/merge.
- **Source state:** Not final runtime-accepted. Individual production registration is not accepted by this handoff; reconcile the actual original branch. Aggregate union registration is not production registration.
- **Actually tested source:** `8db89ddd50574153405c0d1a60dee18e0dfa16d0`, historical import base `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Tested leaf `internal/apps/homarr/target_plex.go`; next candidate leaf `internal/apps/homarr/target_plex.go`. Tested semantic verifier present: **yes**.
- **Aggregate observation:** own Setup `not-selected`; Homarr Link `not selected`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed). Account ownership/server-ID Manual gate; administrator token, media/playback/native lifecycle held.
- **Remaining / next:** Keep excluded until separately approved external account and attested server ownership. Do not use real user tokens, claim servers, playback media or infer entitlement.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → Plex (`plex`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 4 changed files, +422/−40; Git diff against the computed live-base merge base lists 4 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
docs/catalog/traps/plex.md
internal/apps/homarr/target_plex.go
internal/apps/plex/plex.go
internal/apps/plex/plex_test.go
```

</details>

### PR 349

**[feat(tdarr): prepare authenticated native Homarr monitoring](https://github.com/ajnart/selfhost-skills/pull/349)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-tdarr-sol` (`gh pr checkout 349` in a clean new clone). **Exact head:** `21d3624b86411b9011a4e9ad3cacc94b60174279`.
- **Base:** `feat/homarr-immich-sol`; live captured tip `33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`. Computed merge base `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **no**.
- **GitHub-reported base OID:** `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Prepare authenticated Tdarr native monitoring without authorizing real media scans or transcoding jobs.
- **App / issue:** `tdarr` / [#301](https://github.com/ajnart/selfhost-skills/issues/301). Sibling based on the already-merged #309 reference branch, not on any other open peer. Reconcile historical common source/current main through the custodian before approved retarget/merge.
- **Source state:** Not final runtime-accepted. Individual production registration is not accepted by this handoff; reconcile the actual original branch. Aggregate union registration is not production registration.
- **Actually tested source:** `21d3624b86411b9011a4e9ad3cacc94b60174279`, historical import base `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Tested leaf `internal/apps/homarr/target_tdarr.go`; next candidate leaf `internal/apps/homarr/target_tdarr.go`. Tested semantic verifier present: **yes**.
- **Aggregate observation:** own Setup `ok`; Homarr Link `ok`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed). Global key/node Manual gates; worker/media/license/GPU/transcoding and native lifecycle held.
- **Remaining / next:** No demonstrated aggregate production defect. Reuse the observed source checks, normalize/register the individual branch, complete exact-head review and obtain independent native/rendered/lifecycle evidence; preserve the App-specific scope below.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → Tdarr (`tdarr`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 4 changed files, +527/−10; Git diff against the computed live-base merge base lists 4 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
internal/apps/homarr/target_tdarr.go
internal/apps/tdarr/homarr.go
internal/apps/tdarr/tdarr.go
internal/apps/tdarr/tdarr_test.go
```

</details>

### PR 351

**[feat(speedtest-tracker): prepare scoped Homarr results link](https://github.com/ajnart/selfhost-skills/pull/351)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-speedtest-sol` (`gh pr checkout 351` in a clean new clone). **Exact head:** `29659099e33da9bead3aad2414f8f3965efafc27`.
- **Base:** `feat/homarr-immich-sol`; live captured tip `33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`. Computed merge base `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **no**.
- **GitHub-reported base OID:** `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Prepare scoped Speedtest Tracker result access; a usable real measurement is a Manual prerequisite and bandwidth tests are not approved.
- **App / issue:** `speedtest-tracker` / [#296](https://github.com/ajnart/selfhost-skills/issues/296). Sibling based on the already-merged #309 reference branch, not on any other open peer. Reconcile historical common source/current main through the custodian before approved retarget/merge.
- **Source state:** Not final runtime-accepted. Individual production registration is not accepted by this handoff; reconcile the actual original branch. Aggregate union registration is not production registration.
- **Actually tested source:** `29659099e33da9bead3aad2414f8f3965efafc27`, historical import base `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Tested leaf `internal/apps/homarr/target_speedtest_tracker.go`; next candidate leaf `internal/apps/homarr/target_speedtest_tracker.go`. Tested semantic verifier present: **yes**.
- **Aggregate observation:** own Setup `manual`; Homarr Link `skip`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed). Normalization/registration held; actual token/rootless/rendered proof and separate lawful measurement/bandwidth approval pending.
- **Remaining / next:** Keep missing usable measurement Manual. Token issuance/results:read authority and rootless startup need bounded proof; running a bandwidth measurement requires separate approval.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Recorded source/status receipt:** https://github.com/ajnart/selfhost-skills/pull/351#issuecomment-6114247126. Confirm its actual reviewed head and scope; older reviews do not cover later commits automatically.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → Speedtest Tracker (`speedtest-tracker`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 6 changed files, +694/−15; Git diff against the computed live-base merge base lists 6 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
docs/catalog/traps/speedtest-tracker.md
docs/homarr-speedtest-tracker-source.md
internal/apps/homarr/target_speedtest_tracker.go
internal/apps/speedtesttracker/homarr.go
internal/apps/speedtesttracker/speedtesttracker.go
internal/apps/speedtesttracker/speedtesttracker_test.go
```

</details>

### PR 352

**[feat(homarr): add protected Traefik native Link descriptor](https://github.com/ajnart/selfhost-skills/pull/352)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `feat/homarr-traefik-sol` (`gh pr checkout 352` in a clean new clone). **Exact head:** `3ecd50a434613b649e072cd33917d22e4d780e93`.
- **Base:** `feat/homarr-immich-sol`; live captured tip `33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`. Computed merge base `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **no**.
- **GitHub-reported base OID:** `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Provide a protected Traefik native Link/statistics descriptor; do not replace supported protection with insecure public API exposure.
- **App / issue:** `traefik` / [#304](https://github.com/ajnart/selfhost-skills/issues/304). Sibling based on the already-merged #309 reference branch, not on any other open peer. Reconcile historical common source/current main through the custodian before approved retarget/merge.
- **Source state:** Not final runtime-accepted. Individual production registration is not accepted by this handoff; reconcile the actual original branch. Aggregate union registration is not production registration.
- **Actually tested source:** `3ecd50a434613b649e072cd33917d22e4d780e93`, historical import base `d956824f3758e26bb9cdfc262e229eaf67ef187c`. Tested leaf `internal/apps/homarr/target_traefik.go`; next candidate leaf `internal/apps/homarr/target_traefik.go`. Tested semantic verifier present: **yes**.
- **Aggregate observation:** own Setup `ok`; Homarr Link `ok`. No independent aggregate native/saved/rendered receipt or full lifecycle acceptance. A successful Link with nil verifier is not a semantic pass.
- **Dependencies / hold:** #262 (closed). Existing protected BasicAuth/API only; pagination/central freshness and native lifecycle held.
- **Remaining / next:** No demonstrated aggregate production defect. Reuse the observed source checks, normalize/register the individual branch, complete exact-head review and obtain independent native/rendered/lifecycle evidence; preserve the App-specific scope below.
- **Merge gate:** original-branch normalization/cumulative registration, approved meaningful native/rendered/lifecycle evidence and complete exact-head Standards/Spec reviews. Keep draft; manual/privacy prerequisites stay held.
- **Full App record:** [APP-QUEUE.md](APP-QUEUE.md) → Traefik (`traefik`), including supported scope and historical import allowlist.
- **Captured diff:** GitHub reports 2 changed files, +358/−1; Git diff against the computed live-base merge base lists 2 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
docs/catalog/traps/traefik.md
internal/apps/homarr/target_traefik.go
```

</details>

### PR 355

**[fix(homarr): preserve Frigate TLS recovery hint](https://github.com/ajnart/selfhost-skills/pull/355)**

- **State:** OPEN; draft=yes. GitHub mergeability `MERGEABLE`, merge state `UNSTABLE`, review decision `not recorded`. These are tracker observations, not source or native acceptance.
- **Checkout:** `fix/homarr-frigate-recovery-hint` (`gh pr checkout 355` in a clean new clone). **Exact head:** `aaa37b83e99d116936a4353fedf0a8a61068205d`.
- **Base:** `main`; live captured tip `ab4c92c428a2c2c9ab284a83f79f726418c1498b`. Computed merge base `6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c`. Live base tip in head ancestry: **no**. Frozen production contract in ancestry: **yes**.
- **GitHub-reported base OID:** `ab4c92c428a2c2c9ab284a83f79f726418c1498b`. Keep it distinct from live base and historical import base. Other open PR heads in ancestry: **none**.
- **Meaning:** Persist the detailed Frigate trusted-HTTPS recovery message in the Manual Link hint instead of only logging it. Exactly three added lines in common internal/apps/homarr/links.go.
- **Source/evidence state:** Complete exact-head Standards/Spec PASS0 at aaa37b83; pure frozen parent. This is diagnostic-only, not Frigate native activation or #277 completion.
- **Dependencies / stack meaning:** Independent common-code corrective PR, semantically relevant to #331/#277. Neither code ancestry nor its source pass supplies TLS/runtime approval.
- **Remaining / next:** Custodian reconciles the three-line fix against current common code and obtains merge direction. Carry it into a NEW reviewed candidate if approved; retain trusted HTTPS/Manual holds.
- **Captured diff:** GitHub reports 1 changed files, +3/−0; Git diff against the computed live-base merge base lists 1 paths. Changes in large historical common files must not be treated as peer-owned deltas.

<details>
<summary>Exact changed paths against the captured live-base merge base</summary>

```text
internal/apps/homarr/links.go
```

</details>

## Concurrent additions at final publication

The initial 43-open-PR snapshot above remains immutable. Final readback adds **#356/#357/#358**, producing **46 open / 128 total PRs**. Read [LATEST-UPDATE.md](LATEST-UPDATE.md) for precedence over older source/runtime next actions. Original peer heads/bases remain unchanged. The current topology has 15 main-based PRs, 30 reference-based siblings and one evaluation child. [github/concurrent-additional-prs.json](github/concurrent-additional-prs.json) records complete new diffs and exact ancestry.

### PR 356

**[test(release): validate the current Homarr integration candidate](https://github.com/ajnart/selfhost-skills/pull/356)**

- **State:** OPEN, draft. No merge approval inferred.
- **Checkout:** `feat/current-release-completion` (`gh pr checkout 356` in a clean new clone). **Recorded head:** `f245f7872d891ef51d7990cbebe8a30692cdcd73`. Exact independently published candidate head.
- **Base / stack:** `main` at `ab4c92c428a2c2c9ab284a83f79f726418c1498b`; actual merge base `ab4c92c428a2c2c9ab284a83f79f726418c1498b`, current captured base in ancestry: **yes**.
- **Meaning:** Newer independently owned Homarr production-shaped candidate reconstructed from the preservation checkpoint; source repairs include semantic AdGuard/Paperless verifiers, observed pinned Slskd/Tracearr versions, referenced-App ownership preservation, bounded owned Stats and a confined helper.
- **Source/evidence state:** Owner reports Linux/amd64 55-service smoke, 25 saved integrations and 24 reviewed widgets, scoped cleanup and source reviews. Not independently reproduced/audited here, not all-39 lifecycle acceptance, not a merged replacement for individual PRs.
- **Remaining / next:** Coordinate with its owner. Review exact candidate source/evidence/authorization and decide combined-versus-original-individual production route with the maintainer before any merge or repeat runtime. Speedtest shared-host AppArmor choice, Manual/privacy prerequisites, complete peer lifecycle and distribution/evaluation remain held.
- **Original-PR overlap:** imports/repairs many peer slices but does not rewrite their PR heads. New semantic verifiers are on this candidate, not original #311/#312. Prior individual-PR integration decision and this combined draft require an explicit maintainer reconciliation.
- **Owner source record:** [pinned handoff](references/concurrent-release-handoff.pr-356.md); private runtime receipts intentionally not copied. Complete 152-file GitHub listing: [github/pr-356-files.complete.json](github/pr-356-files.complete.json).

<details>
<summary>Complete changed paths at the recorded head</summary>

```text
docs/release-handoff.md
internal/apps/adguard/adguard.go
internal/apps/adguard/adguard_test.go
internal/apps/archiveteamwarrior/archiveteamwarrior.go
internal/apps/archiveteamwarrior/archiveteamwarrior_test.go
internal/apps/archiveteamwarrior/status.go
internal/apps/aria2/aria2.go
internal/apps/aria2/aria2_test.go
internal/apps/audiobookshelf/audiobookshelf.go
internal/apps/audiobookshelf/audiobookshelf_test.go
internal/apps/audiobookshelf/homarr_credentials.go
internal/apps/bazarr/api.go
internal/apps/bazarr/bazarr.go
internal/apps/bazarr/bazarr_test.go
internal/apps/caddy/caddy.go
internal/apps/caddy/caddy_test.go
internal/apps/dashdot/dashdot.go
internal/apps/dashdot/metrics.go
internal/apps/deluge/deluge.go
internal/apps/deluge/deluge_test.go
internal/apps/emby/emby.go
internal/apps/emby/emby_test.go
internal/apps/emby/homarr.go
internal/apps/frigate/frigate.go
internal/apps/frigate/frigate_test.go
internal/apps/gatus/gatus.go
internal/apps/gatus/gatus_test.go
internal/apps/glances/glances.go
internal/apps/glances/homarr.go
internal/apps/gluetun/gluetun.go
internal/apps/gluetun/gluetun_test.go
internal/apps/gotify/gotify.go
internal/apps/gotify/gotify_test.go
internal/apps/gotify/homarr.go
internal/apps/homarr/homarr_test.go
internal/apps/homarr/installed.go
internal/apps/homarr/installed_test.go
internal/apps/homarr/links.go
internal/apps/homarr/shared_widgets.go
internal/apps/homarr/target_adguard.go
internal/apps/homarr/target_adguard_test.go
internal/apps/homarr/target_archive_team_warrior.go
internal/apps/homarr/target_aria2.go
internal/apps/homarr/target_audiobookshelf.go
internal/apps/homarr/target_bazarr.go
internal/apps/homarr/target_caddy.go
internal/apps/homarr/target_dashdot.go
internal/apps/homarr/target_deluge.go
internal/apps/homarr/target_emby.go
internal/apps/homarr/target_frigate.go
internal/apps/homarr/target_gatus.go
internal/apps/homarr/target_glances.go
internal/apps/homarr/target_gluetun.go
internal/apps/homarr/target_gluetun_test.go
internal/apps/homarr/target_gotify.go
internal/apps/homarr/target_home_assistant.go
internal/apps/homarr/target_lidarr.go
internal/apps/homarr/target_linkwarden.go
internal/apps/homarr/target_navidrome.go
internal/apps/homarr/target_netdata.go
internal/apps/homarr/target_nextcloud.go
internal/apps/homarr/target_nzbget.go
internal/apps/homarr/target_paperless.go
internal/apps/homarr/target_paperless_test.go
internal/apps/homarr/target_patchmon.go
internal/apps/homarr/target_peanut.go
internal/apps/homarr/target_pihole.go
internal/apps/homarr/target_plex.go
internal/apps/homarr/target_prometheus.go
internal/apps/homarr/target_sabnzbd.go
internal/apps/homarr/target_slskd.go
internal/apps/homarr/target_speedtest_tracker.go
internal/apps/homarr/target_tdarr.go
internal/apps/homarr/target_technitium_dns.go
internal/apps/homarr/target_tracearr.go
internal/apps/homarr/target_traefik.go
internal/apps/homarr/target_transmission.go
internal/apps/homarr/target_umami.go
internal/apps/homarr/target_uptime_kuma.go
internal/apps/homarr/target_wud.go
internal/apps/homarr/targets.go
internal/apps/homeassistant/homarr.go
internal/apps/homeassistant/homarr_auth.go
internal/apps/homeassistant/homeassistant.go
internal/apps/homeassistant/homeassistant_test.go
internal/apps/lidarr/lidarr.go
internal/apps/lidarr/lidarr_test.go
internal/apps/linkwarden/homarr.go
internal/apps/linkwarden/linkwarden.go
internal/apps/linkwarden/linkwarden_test.go
internal/apps/navidrome/homarr.go
internal/apps/navidrome/navidrome.go
internal/apps/navidrome/navidrome_test.go
internal/apps/netdata/metrics.go
internal/apps/netdata/netdata.go
internal/apps/nextcloud/nextcloud.go
internal/apps/nextcloud/nextcloud_test.go
internal/apps/nzbget/homarr.go
internal/apps/nzbget/nzbget.go
internal/apps/nzbget/nzbget_test.go
internal/apps/paperlessngx/paperlessngx.go
internal/apps/paperlessngx/paperlessngx_test.go
internal/apps/paperlessngx/token.go
internal/apps/patchmon/homarr.go
internal/apps/patchmon/patchmon.go
internal/apps/peanut/peanut.go
internal/apps/peanut/peanut_test.go
internal/apps/pihole/homarr.go
internal/apps/pihole/install_test.go
internal/apps/pihole/pihole.go
internal/apps/pihole/pihole_test.go
internal/apps/plex/plex.go
internal/apps/plex/plex_test.go
internal/apps/prometheus/prometheus.go
internal/apps/prometheus/prometheus_test.go
internal/apps/prometheus/readiness.go
internal/apps/sabnzbd/api.go
internal/apps/sabnzbd/sabnzbd.go
internal/apps/sabnzbd/sabnzbd_test.go
internal/apps/slskd/homarr.go
internal/apps/slskd/slskd.go
internal/apps/slskd/slskd_test.go
internal/apps/speedtesttracker/homarr.go
internal/apps/speedtesttracker/readiness_test.go
internal/apps/speedtesttracker/speedtesttracker.go
internal/apps/speedtesttracker/speedtesttracker_test.go
internal/apps/tdarr/homarr.go
internal/apps/tdarr/tdarr.go
internal/apps/tdarr/tdarr_test.go
internal/apps/technitiumdns/technitiumdns.go
internal/apps/technitiumdns/technitiumdns_test.go
internal/apps/tracearr/homarr.go
internal/apps/tracearr/homarr_test.go
internal/apps/tracearr/tracearr.go
internal/apps/transmission/transmission.go
internal/apps/transmission/transmission_test.go
internal/apps/umami/homarr.go
internal/apps/umami/umami.go
internal/apps/umami/umami_test.go
internal/apps/uptimekuma/uptimekuma.go
internal/apps/wud/discovery_test.go
internal/apps/wud/preflight_test.go
internal/apps/wud/wud.go
internal/apps/wud/wud_test.go
internal/catalog/generated_test.go
internal/release/installsh_skill_test.go
internal/skill/guide.md
internal/tui/copy.go
tools/release-proof/README.md
tools/release-proof/fixture.go
tools/release-proof/fixture_test.go
tools/release-proof/main.go
```

</details>

### PR 357

**[fix(eval): invalidate derived results before judging](https://github.com/ajnart/selfhost-skills/pull/357)**

- **State:** OPEN, draft. No merge approval inferred.
- **Checkout:** `feat/skill-eval-invalidation` (`gh pr checkout 357` in a clean new clone). **Recorded head:** `ccd742dc2e01c0388873eaa570ef8ce7ee40a220`. Exact independently published candidate head.
- **Base / stack:** `test/skill-eval-harness` at `3558e581856ae12bf803c6052384ee23ac2f93a2`; actual merge base `3558e581856ae12bf803c6052384ee23ac2f93a2`, current captured base in ancestry: **yes**.
- **Meaning:** Remove stale benchmark.json/review.html before judging and on failure, preserving valid execution inputs/raw diagnostics. Exactly three files above #259.
- **Source/evidence state:** Owner reports three focused existing fake-Claude CLI regressions and independent source passes. Parent #259 still lacks complete iteration-25 judgments/viewer/human acceptance.
- **Remaining / next:** Reconcile parent 3558e581 and child ccd742dc; obtain exact source merge direction and preserve the real stack. Coordinate separately authorized judgment-only recovery. No model retry, conversation rerun or paid fallback from reading this source fix.
- **Real dependency:** #259 → #357. Unlike the 30 Homarr siblings, this child actually contains the open parent head in ancestry. Review/merge order and parent update must preserve that boundary.

<details>
<summary>Complete changed paths at the recorded head</summary>

```text
evals/self-host/PROGRESS.md
evals/self-host/judge.py
evals/self-host/tests/test_grading.py
```

</details>

### PR 358

**[docs(handoff): preserve release backlog, PR topology and continuation prompt](https://github.com/ajnart/selfhost-skills/pull/358)**

- **State:** OPEN, draft. No merge approval inferred.
- **Checkout:** `docs/release-handoff` (`gh pr checkout 358` in a clean new clone). **Recorded head:** `cc6accce8c58dbdfb878aed6f278825777d6667a`. Exact initial publication head; later documentation receipt commits advance this branch without rewriting it.
- **Base / stack:** `main` at `ab4c92c428a2c2c9ab284a83f79f726418c1498b`; actual merge base `ab4c92c428a2c2c9ab284a83f79f726418c1498b`, current captured base in ancestry: **yes**.
- **Meaning:** This private documentation/evidence handoff with source checkpoints, every PR branch/state/stack, all 39 App records and the continuation prompt.
- **Source/evidence state:** Static JSON/Markdown/hash/secret-home-email/patch reconstruction gates pass; no feature merge or runtime/model/installer/deployment/release operation by this session.
- **Remaining / next:** Human review of handoff accuracy/private publication boundaries. Start another agent on docs/release-handoff; use LATEST-UPDATE and CONTINUE-PROMPT before historical plans. Do not merge archival candidate/notes branches into production.

<details>
<summary>Complete changed paths at the recorded head</summary>

```text
docs/handoffs/release-2026-10-13/.gitattributes
docs/handoffs/release-2026-10-13/APP-QUEUE.md
docs/handoffs/release-2026-10-13/CHECKPOINTS.md
docs/handoffs/release-2026-10-13/CONTINUE-PROMPT.md
docs/handoffs/release-2026-10-13/HANDOFF.md
docs/handoffs/release-2026-10-13/PR-HISTORY.md
docs/handoffs/release-2026-10-13/PR-STACKS.md
docs/handoffs/release-2026-10-13/SHA256SUMS
docs/handoffs/release-2026-10-13/START-HERE.md
docs/handoffs/release-2026-10-13/TRACKER-INVENTORY.md
docs/handoffs/release-2026-10-13/evidence/aggregate/artifact-hashes.reconciled.final.json
docs/handoffs/release-2026-10-13/evidence/aggregate/browser-cleanup-readback.final.json
docs/handoffs/release-2026-10-13/evidence/aggregate/captured-resources.json
docs/handoffs/release-2026-10-13/evidence/aggregate/cleanup.final.json
docs/handoffs/release-2026-10-13/evidence/aggregate/cleanup.json
docs/handoffs/release-2026-10-13/evidence/aggregate/debug-homarr.redacted.log
docs/handoffs/release-2026-10-13/evidence/aggregate/image-provenance.final.json
docs/handoffs/release-2026-10-13/evidence/aggregate/install.redacted.log
docs/handoffs/release-2026-10-13/evidence/aggregate/per-app-results.reconciled.final.json
docs/handoffs/release-2026-10-13/evidence/aggregate/status.redacted.log
docs/handoffs/release-2026-10-13/evidence/aggregate/summary.reconciled.final.json
docs/handoffs/release-2026-10-13/evidence/prepared-followup/hashes.json
docs/handoffs/release-2026-10-13/evidence/prepared-followup/result.json
docs/handoffs/release-2026-10-13/evidence/prepared-followup/synthetic-argv.after.json
docs/handoffs/release-2026-10-13/evidence/prepared-followup/synthetic-argv.before.json
docs/handoffs/release-2026-10-13/evidence/tested-source/checks.json
docs/handoffs/release-2026-10-13/evidence/tested-source/gate.json
docs/handoffs/release-2026-10-13/evidence/tested-source/inventory.json
docs/handoffs/release-2026-10-13/evidence/tested-source/manifest.final.json
docs/handoffs/release-2026-10-13/evidence/tested-source/plugin-probe.json
docs/handoffs/release-2026-10-13/export-provenance.json
docs/handoffs/release-2026-10-13/github/app-queue.json
docs/handoffs/release-2026-10-13/github/checkpoint-commits.json
docs/handoffs/release-2026-10-13/github/comments/pr-259.json
docs/handoffs/release-2026-10-13/github/comments/pr-300.json
docs/handoffs/release-2026-10-13/github/comments/pr-310.json
docs/handoffs/release-2026-10-13/github/comments/pr-311.json
docs/handoffs/release-2026-10-13/github/comments/pr-312.json
docs/handoffs/release-2026-10-13/github/comments/pr-313.json
docs/handoffs/release-2026-10-13/github/comments/pr-315.json
docs/handoffs/release-2026-10-13/github/comments/pr-317.json
docs/handoffs/release-2026-10-13/github/comments/pr-318.json
docs/handoffs/release-2026-10-13/github/comments/pr-319.json
docs/handoffs/release-2026-10-13/github/comments/pr-320.json
docs/handoffs/release-2026-10-13/github/comments/pr-321.json
docs/handoffs/release-2026-10-13/github/comments/pr-322.json
docs/handoffs/release-2026-10-13/github/comments/pr-323.json
docs/handoffs/release-2026-10-13/github/comments/pr-324.json
docs/handoffs/release-2026-10-13/github/comments/pr-325.json
docs/handoffs/release-2026-10-13/github/comments/pr-326.json
docs/handoffs/release-2026-10-13/github/comments/pr-327.json
docs/handoffs/release-2026-10-13/github/comments/pr-328.json
docs/handoffs/release-2026-10-13/github/comments/pr-329.json
docs/handoffs/release-2026-10-13/github/comments/pr-330.json
docs/handoffs/release-2026-10-13/github/comments/pr-331.json
docs/handoffs/release-2026-10-13/github/comments/pr-333.json
docs/handoffs/release-2026-10-13/github/comments/pr-334.json
docs/handoffs/release-2026-10-13/github/comments/pr-335.json
docs/handoffs/release-2026-10-13/github/comments/pr-336.json
docs/handoffs/release-2026-10-13/github/comments/pr-337.json
docs/handoffs/release-2026-10-13/github/comments/pr-338.json
docs/handoffs/release-2026-10-13/github/comments/pr-339.json
docs/handoffs/release-2026-10-13/github/comments/pr-340.json
docs/handoffs/release-2026-10-13/github/comments/pr-341.json
docs/handoffs/release-2026-10-13/github/comments/pr-342.json
docs/handoffs/release-2026-10-13/github/comments/pr-343.json
docs/handoffs/release-2026-10-13/github/comments/pr-344.json
docs/handoffs/release-2026-10-13/github/comments/pr-345.json
docs/handoffs/release-2026-10-13/github/comments/pr-346.json
docs/handoffs/release-2026-10-13/github/comments/pr-347.json
docs/handoffs/release-2026-10-13/github/comments/pr-348.json
docs/handoffs/release-2026-10-13/github/comments/pr-349.json
docs/handoffs/release-2026-10-13/github/comments/pr-351.json
docs/handoffs/release-2026-10-13/github/comments/pr-352.json
docs/handoffs/release-2026-10-13/github/comments/pr-355.json
docs/handoffs/release-2026-10-13/github/dependencies.json
docs/handoffs/release-2026-10-13/github/evaluation-current.json
docs/handoffs/release-2026-10-13/github/issues.json
docs/handoffs/release-2026-10-13/github/pr-259-detail.json
docs/handoffs/release-2026-10-13/github/pr-259-files.complete.json
docs/handoffs/release-2026-10-13/github/pr-300-detail.json
docs/handoffs/release-2026-10-13/github/pr-313-detail.json
docs/handoffs/release-2026-10-13/github/pr-355-detail.json
docs/handoffs/release-2026-10-13/github/pr-stack-audit.json
docs/handoffs/release-2026-10-13/github/pull-requests.json
docs/handoffs/release-2026-10-13/github/repository.json
docs/handoffs/release-2026-10-13/machine-observation.json
docs/handoffs/release-2026-10-13/references/aria2-final-source-review.md
docs/handoffs/release-2026-10-13/references/audiobookshelf-final-source-review.md
docs/handoffs/release-2026-10-13/references/bazarr-final-source-review.md
docs/handoffs/release-2026-10-13/references/evaluation-progress.live-head.md
docs/handoffs/release-2026-10-13/references/evaluation-readme.live-head.md
docs/handoffs/release-2026-10-13/references/frigate-hint-final-source-review.md
docs/handoffs/release-2026-10-13/references/gluetun-native-blocker.md
docs/handoffs/release-2026-10-13/references/homarr-aggregate-inspection.md
docs/handoffs/release-2026-10-13/references/homarr-aggregate-plan.md
docs/handoffs/release-2026-10-13/references/nzbget-diagnostic-source-review.md
docs/handoffs/release-2026-10-13/references/nzbget-native-logging-blocker.md
docs/handoffs/release-2026-10-13/references/release-homarr.md
docs/handoffs/release-2026-10-13/references/repository/AGENTS.md
docs/handoffs/release-2026-10-13/references/repository/CONTEXT.md
docs/handoffs/release-2026-10-13/references/repository/docs/agents/domain.md
docs/handoffs/release-2026-10-13/references/repository/docs/agents/homarr-integrations.md
docs/handoffs/release-2026-10-13/references/repository/docs/agents/implementing.md
docs/handoffs/release-2026-10-13/references/repository/docs/agents/issue-tracker.md
docs/handoffs/release-2026-10-13/references/repository/docs/homarr-external-coverage-plan.md
docs/handoffs/release-2026-10-13/references/repository/docs/homarr-immich-proof.md
docs/handoffs/release-2026-10-13/references/repository/docs/homarr-integration-contract.md
docs/handoffs/release-2026-10-13/references/repository/docs/homarr-integration-coverage-research.md
docs/handoffs/release-2026-10-13/references/repository/docs/homarr-ticket-index.md
docs/handoffs/release-2026-10-13/references/repository/docs/releasing.md
docs/handoffs/release-2026-10-13/references/video-handoff.pinned.md
docs/handoffs/release-2026-10-13/references/video-storyboard.pinned.md
docs/handoffs/release-2026-10-13/snapshot.json
docs/handoffs/release-2026-10-13/source/helper-public-username.prepared.patch
docs/handoffs/release-2026-10-13/source/prepared-helper.go.reference
docs/handoffs/release-2026-10-13/source/prepared-supervise.py.reference
docs/handoffs/release-2026-10-13/source/runner-diagnostics.prepared.patch
docs/handoffs/release-2026-10-13/source/synthetic-argv-probe.go.reference
docs/handoffs/release-2026-10-13/source/tested-candidate.patch
docs/handoffs/release-2026-10-13/validation.json
```

</details>
