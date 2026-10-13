# All 39 App handoff queue

**Original-branch snapshot:** peer heads remain unchanged. [LATEST-UPDATE.md](LATEST-UPDATE.md) records later candidate-only verifiers/common/version/rendering work on #356, not on these original peer branches. Reconcile with its owner before repeating historical next actions. New combined smoke does not close individual acceptance tickets.

This is a generated live-head/tested-pin reconciliation, not a new acceptance result. Common gates and ownership are in [HANDOFF.md](HANDOFF.md). Four peers (Bazarr, Caddy, Gatus, Prometheus) already have individual registration and normalized source passes; the others still need registration reconciliation. Every non-reference App still needs final exact accepted-head review and approved native/rendered/lifecycle proof. [PR-STACKS.md](PR-STACKS.md) explains each branch and actual stack. The old manifest contains historical authorization/observed fields; those are not current permission.

| App                                          | Issue                                                        | PR                                                         | Tested own Setup | Tested Homarr Link | Live head      |
| -------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------- | ---------------- | ------------------ | -------------- |
| AdGuard Home / `adguard-home`                | [#266](https://github.com/ajnart/selfhost-skills/issues/266) | [#311](https://github.com/ajnart/selfhost-skills/pull/311) | ok               | ok                 | `6731356c57d1` |
| ArchiveTeam Warrior / `archive-team-warrior` | [#267](https://github.com/ajnart/selfhost-skills/issues/267) | [#323](https://github.com/ajnart/selfhost-skills/pull/323) | not-selected     | not selected       | `35979a24463f` |
| Aria2 / `aria2`                              | [#269](https://github.com/ajnart/selfhost-skills/issues/269) | [#317](https://github.com/ajnart/selfhost-skills/pull/317) | ok               | ok                 | `71e5c0fc1afd` |
| Audiobookshelf / `audiobookshelf`            | [#270](https://github.com/ajnart/selfhost-skills/issues/270) | [#310](https://github.com/ajnart/selfhost-skills/pull/310) | ok               | ok                 | `895fb166f652` |
| Bazarr / `bazarr`                            | [#272](https://github.com/ajnart/selfhost-skills/issues/272) | [#320](https://github.com/ajnart/selfhost-skills/pull/320) | ok               | ok                 | `ed73c7651ca5` |
| Caddy / `caddy`                              | [#273](https://github.com/ajnart/selfhost-skills/issues/273) | [#315](https://github.com/ajnart/selfhost-skills/pull/315) | ok               | ok                 | `259033989ef4` |
| Dash. / `dashdot`                            | [#274](https://github.com/ajnart/selfhost-skills/issues/274) | [#319](https://github.com/ajnart/selfhost-skills/pull/319) | ok               | ok                 | `e0577f082b8b` |
| Deluge / `deluge`                            | [#275](https://github.com/ajnart/selfhost-skills/issues/275) | [#324](https://github.com/ajnart/selfhost-skills/pull/324) | ok               | ok                 | `0b3155367e64` |
| Emby / `emby`                                | [#276](https://github.com/ajnart/selfhost-skills/issues/276) | [#322](https://github.com/ajnart/selfhost-skills/pull/322) | manual           | skip               | `eed53d89603f` |
| Frigate / `frigate`                          | [#277](https://github.com/ajnart/selfhost-skills/issues/277) | [#331](https://github.com/ajnart/selfhost-skills/pull/331) | ok               | manual             | `0d06cdf51334` |
| Gatus / `gatus`                              | [#280](https://github.com/ajnart/selfhost-skills/issues/280) | [#321](https://github.com/ajnart/selfhost-skills/pull/321) | ok               | ok                 | `b8ab54070762` |
| Glances / `glances`                          | [#281](https://github.com/ajnart/selfhost-skills/issues/281) | [#326](https://github.com/ajnart/selfhost-skills/pull/326) | ok               | ok                 | `e68ea343cca6` |
| Gluetun / `gluetun`                          | [#279](https://github.com/ajnart/selfhost-skills/issues/279) | [#327](https://github.com/ajnart/selfhost-skills/pull/327) | not-selected     | not selected       | `7d70c832c426` |
| Gotify / `gotify`                            | [#282](https://github.com/ajnart/selfhost-skills/issues/282) | [#325](https://github.com/ajnart/selfhost-skills/pull/325) | ok               | ok                 | `384111f93671` |
| Home Assistant / `home-assistant`            | [#285](https://github.com/ajnart/selfhost-skills/issues/285) | [#333](https://github.com/ajnart/selfhost-skills/pull/333) | incomplete       | skip               | `2ea747b1ee94` |
| Immich / `immich`                            | [#262](https://github.com/ajnart/selfhost-skills/issues/262) | [#309](https://github.com/ajnart/selfhost-skills/pull/309) | incomplete       | skip               | `33e7fbccb754` |
| Lidarr / `lidarr`                            | [#283](https://github.com/ajnart/selfhost-skills/issues/283) | [#318](https://github.com/ajnart/selfhost-skills/pull/318) | ok               | ok                 | `e8ea969a9d3a` |
| Linkwarden / `linkwarden`                    | [#286](https://github.com/ajnart/selfhost-skills/issues/286) | [#328](https://github.com/ajnart/selfhost-skills/pull/328) | ok               | ok                 | `76ff8634ddaa` |
| Navidrome / `navidrome`                      | [#284](https://github.com/ajnart/selfhost-skills/issues/284) | [#330](https://github.com/ajnart/selfhost-skills/pull/330) | ok               | ok                 | `f34392800878` |
| Netdata / `netdata`                          | [#287](https://github.com/ajnart/selfhost-skills/issues/287) | [#329](https://github.com/ajnart/selfhost-skills/pull/329) | ok               | ok                 | `87a69b36ab07` |
| Nextcloud / `nextcloud`                      | [#288](https://github.com/ajnart/selfhost-skills/issues/288) | [#340](https://github.com/ajnart/selfhost-skills/pull/340) | ok               | ok                 | `21f74e29d9c7` |
| NZBGet / `nzbget`                            | [#290](https://github.com/ajnart/selfhost-skills/issues/290) | [#335](https://github.com/ajnart/selfhost-skills/pull/335) | incomplete       | skip               | `d03616aac0a2` |
| Paperless-ngx / `paperless-ngx`              | [#289](https://github.com/ajnart/selfhost-skills/issues/289) | [#312](https://github.com/ajnart/selfhost-skills/pull/312) | ok               | ok                 | `df16f7231e92` |
| PatchMon / `patchmon`                        | [#291](https://github.com/ajnart/selfhost-skills/issues/291) | [#345](https://github.com/ajnart/selfhost-skills/pull/345) | incomplete       | skip               | `05f68f3bd937` |
| PeaNUT / `peanut`                            | [#293](https://github.com/ajnart/selfhost-skills/issues/293) | [#347](https://github.com/ajnart/selfhost-skills/pull/347) | manual           | skip               | `fc5583b0f5b4` |
| Pi-hole / `pihole`                           | [#292](https://github.com/ajnart/selfhost-skills/issues/292) | [#339](https://github.com/ajnart/selfhost-skills/pull/339) | ok               | ok                 | `64be8d4ba38f` |
| Plex / `plex`                                | [#294](https://github.com/ajnart/selfhost-skills/issues/294) | [#348](https://github.com/ajnart/selfhost-skills/pull/348) | not-selected     | not selected       | `8db89ddd5057` |
| Prometheus / `prometheus`                    | [#299](https://github.com/ajnart/selfhost-skills/issues/299) | [#336](https://github.com/ajnart/selfhost-skills/pull/336) | ok               | ok                 | `2231ee7542a1` |
| SABnzbd / `sabnzbd`                          | [#298](https://github.com/ajnart/selfhost-skills/issues/298) | [#334](https://github.com/ajnart/selfhost-skills/pull/334) | manual           | skip               | `908931b24cf9` |
| Slskd / `slskd`                              | [#297](https://github.com/ajnart/selfhost-skills/issues/297) | [#342](https://github.com/ajnart/selfhost-skills/pull/342) | not-selected     | not selected       | `2cf210a6700b` |
| Speedtest Tracker / `speedtest-tracker`      | [#296](https://github.com/ajnart/selfhost-skills/issues/296) | [#351](https://github.com/ajnart/selfhost-skills/pull/351) | manual           | skip               | `29659099e33d` |
| Tdarr / `tdarr`                              | [#301](https://github.com/ajnart/selfhost-skills/issues/301) | [#349](https://github.com/ajnart/selfhost-skills/pull/349) | ok               | ok                 | `21d3624b8641` |
| Technitium DNS / `technitium-dns`            | [#303](https://github.com/ajnart/selfhost-skills/issues/303) | [#338](https://github.com/ajnart/selfhost-skills/pull/338) | ok               | ok                 | `aafb8c4e71cc` |
| Tracearr / `tracearr`                        | [#302](https://github.com/ajnart/selfhost-skills/issues/302) | [#346](https://github.com/ajnart/selfhost-skills/pull/346) | incomplete       | skip               | `ab4ac17a94c0` |
| Traefik / `traefik`                          | [#304](https://github.com/ajnart/selfhost-skills/issues/304) | [#352](https://github.com/ajnart/selfhost-skills/pull/352) | ok               | ok                 | `3ecd50a43461` |
| Transmission / `transmission`                | [#305](https://github.com/ajnart/selfhost-skills/issues/305) | [#337](https://github.com/ajnart/selfhost-skills/pull/337) | ok               | ok                 | `dc9c2ea0166e` |
| Umami / `umami`                              | [#308](https://github.com/ajnart/selfhost-skills/issues/308) | [#344](https://github.com/ajnart/selfhost-skills/pull/344) | ok               | ok                 | `b6fe06345f84` |
| Uptime Kuma / `uptime-kuma`                  | [#307](https://github.com/ajnart/selfhost-skills/issues/307) | [#341](https://github.com/ajnart/selfhost-skills/pull/341) | manual           | skip               | `980e9c8730a1` |
| What's Up Docker / `wud`                     | [#306](https://github.com/ajnart/selfhost-skills/issues/306) | [#343](https://github.com/ajnart/selfhost-skills/pull/343) | not-selected     | not selected       | `00d57bf66104` |

## Per-App records

Full live PR heads and historical source bases are deliberately shown separately. `registered_source` in the aggregate results means only the disposable candidate union registry, not registration in the individual production branch.

### AdGuard Home — `adguard-home`

- Issue [#266](https://github.com/ajnart/selfhost-skills/issues/266) **OPEN**; PR [#311](https://github.com/ajnart/selfhost-skills/pull/311) **OPEN**, draft=True; branch `feat/homarr-adguard-sol`, current GitHub base `main`.
- **Live head:** `6731356c57d130e503ab24f28aa5cb7825355b2f`. **Actually aggregate-tested source:** `6731356c57d130e503ab24f28aa5cb7825355b2f`. **Historical import base:** `5aafb4c1833fd4cd9caf0f7beaac31e625aafe22`.
- Source status: Stage-1 nil verifier; cancelled completion. Tested leaf `internal/apps/homarr/integration_adguard.go`; next candidate leaf `internal/apps/homarr/integration_adguard.go`. Native verifier in tested source: **False**.
- Aggregate own Setup: **ok**; Link step: **ok**; runtime selected: **True**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed).
- App-specific hold: App-only prerequisite proof; native percentage correctness and full Homarr lifecycle held
- **Next:** Resume the cancelled original owner only by explicit direction; forward-merge the exact frozen contract if still needed; complete a real semantic native verifier, retain null/empty/missing distinctions and do not invent a blocked-percentage inversion.
- Import allowlist from tested manifest: `internal/apps/adguard/adguard.go`, `internal/apps/homarr/integration_adguard.go`. These are historical paths, not a fresh-head diff allowlist.
- Recorded review/status pointer: https://github.com/ajnart/selfhost-skills/pull/311#issuecomment-6124784889. Read its exact head/scope; old source verdicts do not establish native acceptance.

### ArchiveTeam Warrior — `archive-team-warrior`

- Issue [#267](https://github.com/ajnart/selfhost-skills/issues/267) **OPEN**; PR [#323](https://github.com/ajnart/selfhost-skills/pull/323) **OPEN**, draft=True; branch `feat/homarr-warrior-sol`, current GitHub base `feat/homarr-immich-sol`.
- **Live head:** `35979a24463fc97e0e4ccd1bb45ce7eb870dca29`. **Actually aggregate-tested source:** `35979a24463fc97e0e4ccd1bb45ce7eb870dca29`. **Historical import base:** `573a206e2b4a76574fd7e8cbd1f21c5a4c2fd37d`.
- Source status: Not final runtime-accepted. Tested leaf `internal/apps/homarr/target_archive_team_warrior.go`; next candidate leaf `internal/apps/homarr/target_archive_team_warrior.go`. Native verifier in tested source: **True**.
- Aggregate own Setup: **not-selected**; Link step: **not selected**; runtime selected: **False**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed).
- App-specific hold: Idle startup can contact HQ; approved outbound scope or verified inert fail-closed bootstrap required
- **Next:** Keep excluded until a verified inert bootstrap or explicit bounded HQ/outbound archival approval. An idle startup still contacts HQ; do not download archival data.
- Import allowlist from tested manifest: `internal/apps/archiveteamwarrior/archiveteamwarrior.go`, `internal/apps/archiveteamwarrior/status.go`, `internal/apps/homarr/target_archive_team_warrior.go`. These are historical paths, not a fresh-head diff allowlist.

### Aria2 — `aria2`

- Issue [#269](https://github.com/ajnart/selfhost-skills/issues/269) **OPEN**; PR [#317](https://github.com/ajnart/selfhost-skills/pull/317) **OPEN**, draft=True; branch `feat/homarr-aria2-sol`, current GitHub base `main`.
- **Live head:** `71e5c0fc1afd1732a38b299137f0001ed99a19d3`. **Actually aggregate-tested source:** `114477a54418376a9c8e3c9182446a8bcffb4d36`. **Historical import base:** `5aafb4c1833fd4cd9caf0f7beaac31e625aafe22`.
- Source status: Complete corrected verifier source pair PASS; individually unregistered and live proof held. Tested leaf `internal/apps/homarr/integration_aria2.go`; next candidate leaf `internal/apps/homarr/target_aria2.go`. Native verifier in tested source: **False**.
- Aggregate own Setup: **ok**; Link step: **ok**; runtime selected: **True**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed).
- App-specific hold: RPC/download prerequisite proof only; native/rendered/full lifecycle held
- **Next:** Import reviewed 71e5c0fc and target_aria2.go into a NEW evaluation candidate; coordinate individual registration; live-check independently sampled RPC/Downloads/one-item Stats without volatile cross-sample equality.
- Import allowlist from tested manifest: `internal/apps/aria2/aria2.go`, `internal/apps/homarr/integration_aria2.go`. These are historical paths, not a fresh-head diff allowlist.
- Recorded review/status pointer: https://github.com/ajnart/selfhost-skills/pull/317#issuecomment-6131718826. Read its exact head/scope; old source verdicts do not establish native acceptance.

### Audiobookshelf — `audiobookshelf`

- Issue [#270](https://github.com/ajnart/selfhost-skills/issues/270) **OPEN**; PR [#310](https://github.com/ajnart/selfhost-skills/pull/310) **OPEN**, draft=True; branch `feat/homarr-audiobookshelf-sol`, current GitHub base `main`.
- **Live head:** `895fb166f652181745d188934bf70d8d9479bea6`. **Actually aggregate-tested source:** `5b9e0c09abc9ce2e440a90767753f5ee8e8e0b6f`. **Historical import base:** `5aafb4c1833fd4cd9caf0f7beaac31e625aafe22`.
- Source status: Complete corrected verifier source pair PASS; individually unregistered and live proof held. Tested leaf `internal/apps/homarr/integration_audiobookshelf.go`; next candidate leaf `internal/apps/homarr/target_audiobookshelf.go`. Native verifier in tested source: **False**.
- Aggregate own Setup: **ok**; Link step: **ok**; runtime selected: **True**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed).
- App-specific hold: Token is not fully read-only; owned audio/native rendering and lifecycle held
- **Next:** Import reviewed 895fb166 and target_audiobookshelf.go into a NEW candidate; coordinate individual registration; exercise saved identity, Audio Stats/listening units and genuine refresh; disclose administrator/all-library authority.
- Import allowlist from tested manifest: `internal/apps/audiobookshelf/audiobookshelf.go`, `internal/apps/audiobookshelf/homarr_credentials.go`, `internal/apps/homarr/integration_audiobookshelf.go`. These are historical paths, not a fresh-head diff allowlist.
- Recorded review/status pointer: https://github.com/ajnart/selfhost-skills/pull/310#issuecomment-6131643138. Read its exact head/scope; old source verdicts do not establish native acceptance.

### Bazarr — `bazarr`

- Issue [#272](https://github.com/ajnart/selfhost-skills/issues/272) **OPEN**; PR [#320](https://github.com/ajnart/selfhost-skills/pull/320) **OPEN**, draft=True; branch `feat/homarr-bazarr-sol`, current GitHub base `main`.
- **Live head:** `ed73c7651ca5372f5ec9a880e9d66ddf1fca9093`. **Actually aggregate-tested source:** `ed73c7651ca5372f5ec9a880e9d66ddf1fca9093`. **Historical import base:** `6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c`.
- Source status: Individually registered + complete normalized source pair PASS; native/lifecycle held. Tested leaf `internal/apps/homarr/target_bazarr.go`; next candidate leaf `internal/apps/homarr/target_bazarr.go`. Native verifier in tested source: **True**.
- Aggregate own Setup: **ok**; Link step: **ok**; runtime selected: **True**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed).
- App-specific hold: Media/subtitle prerequisites and native lifecycle held; no provider success inferred
- **Next:** Preserve the already normalized/registered source and its complete source pass. Reconcile cumulative registration with current main, then obtain independent native/rendered/lifecycle evidence and final exact accepted-head review; do not redo unchanged source work merely to fill review slots.
- Import allowlist from tested manifest: `internal/apps/bazarr/api.go`, `internal/apps/bazarr/bazarr.go`, `internal/apps/homarr/target_bazarr.go`. These are historical paths, not a fresh-head diff allowlist.
- Recorded review/status pointer: https://github.com/ajnart/selfhost-skills/pull/320#issuecomment-6127740675. Read its exact head/scope; old source verdicts do not establish native acceptance.

### Caddy — `caddy`

- Issue [#273](https://github.com/ajnart/selfhost-skills/issues/273) **OPEN**; PR [#315](https://github.com/ajnart/selfhost-skills/pull/315) **OPEN**, draft=True; branch `feat/homarr-caddy-sol`, current GitHub base `main`.
- **Live head:** `259033989ef44589658a3adbc3c4505175d41ae0`. **Actually aggregate-tested source:** `259033989ef44589658a3adbc3c4505175d41ae0`. **Historical import base:** `6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c`.
- Source status: Individually registered + complete normalized source pair PASS; native/lifecycle held. Tested leaf `internal/apps/homarr/target_caddy.go`; next candidate leaf `internal/apps/homarr/target_caddy.go`. Native verifier in tested source: **True**.
- Aggregate own Setup: **ok**; Link step: **ok**; runtime selected: **True**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed).
- App-specific hold: Registered/source-only; real production-Link/rendered/both-order/cross-kind lifecycle held
- **Next:** Preserve the already normalized/registered source and its complete source pass. Reconcile cumulative registration with current main, then obtain independent native/rendered/lifecycle evidence and final exact accepted-head review; do not redo unchanged source work merely to fill review slots.
- Import allowlist from tested manifest: `internal/apps/caddy/caddy.go`, `internal/apps/homarr/target_caddy.go`. These are historical paths, not a fresh-head diff allowlist.
- Recorded review/status pointer: https://github.com/ajnart/selfhost-skills/pull/315#issuecomment-6115733170. Read its exact head/scope; old source verdicts do not establish native acceptance.

### Dash. — `dashdot`

- Issue [#274](https://github.com/ajnart/selfhost-skills/issues/274) **OPEN**; PR [#319](https://github.com/ajnart/selfhost-skills/pull/319) **OPEN**, draft=True; branch `feat/homarr-dashdot-sol`, current GitHub base `feat/homarr-immich-sol`.
- **Live head:** `e0577f082b8b5d36bfa65a4dc76827e7ebb97c98`. **Actually aggregate-tested source:** `e0577f082b8b5d36bfa65a4dc76827e7ebb97c98`. **Historical import base:** `573a206e2b4a76574fd7e8cbd1f21c5a4c2fd37d`.
- Source status: Not final runtime-accepted. Tested leaf `internal/apps/homarr/target_dashdot.go`; next candidate leaf `internal/apps/homarr/target_dashdot.go`. Native verifier in tested source: **True**.
- Aggregate own Setup: **ok**; Link step: **ok**; runtime selected: **True**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed).
- App-specific hold: CPU/RAM slice only; unavailable hardware is not zero or permission for new privileges
- **Next:** No demonstrated aggregate production defect. Reuse the observed source checks, normalize/register the individual branch, complete exact-head review and obtain independent native/rendered/lifecycle evidence; preserve the App-specific scope below.
- Import allowlist from tested manifest: `internal/apps/dashdot/dashdot.go`, `internal/apps/dashdot/metrics.go`, `internal/apps/homarr/target_dashdot.go`. These are historical paths, not a fresh-head diff allowlist.

### Deluge — `deluge`

- Issue [#275](https://github.com/ajnart/selfhost-skills/issues/275) **OPEN**; PR [#324](https://github.com/ajnart/selfhost-skills/pull/324) **OPEN**, draft=True; branch `feat/homarr-deluge-sol`, current GitHub base `feat/homarr-immich-sol`.
- **Live head:** `0b3155367e6423acb3450ccc19021bace705e7a0`. **Actually aggregate-tested source:** `0b3155367e6423acb3450ccc19021bace705e7a0`. **Historical import base:** `cf8f04c07da6a0394c30c5000906ac441ca4601c`.
- Source status: Not final runtime-accepted. Tested leaf `internal/apps/homarr/target_deluge.go`; next candidate leaf `internal/apps/homarr/target_deluge.go`. Native verifier in tested source: **True**.
- Aggregate own Setup: **ok**; Link step: **ok**; runtime selected: **True**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed).
- App-specific hold: Ambiguous daemon connection remains Manual; owned download/native lifecycle held
- **Next:** No demonstrated aggregate production defect. Reuse the observed source checks, normalize/register the individual branch, complete exact-head review and obtain independent native/rendered/lifecycle evidence; preserve the App-specific scope below.
- Import allowlist from tested manifest: `internal/apps/deluge/deluge.go`, `internal/apps/homarr/target_deluge.go`. These are historical paths, not a fresh-head diff allowlist.
- Recorded review/status pointer: https://github.com/ajnart/selfhost-skills/pull/324#issuecomment-6122229430. Read its exact head/scope; old source verdicts do not establish native acceptance.

### Emby — `emby`

- Issue [#276](https://github.com/ajnart/selfhost-skills/issues/276) **OPEN**; PR [#322](https://github.com/ajnart/selfhost-skills/pull/322) **OPEN**, draft=True; branch `feat/homarr-emby-sol`, current GitHub base `feat/homarr-immich-sol`.
- **Live head:** `eed53d89603f1d89aaa4dff2ff9c5f1a94d86497`. **Actually aggregate-tested source:** `eed53d89603f1d89aaa4dff2ff9c5f1a94d86497`. **Historical import base:** `cf8f04c07da6a0394c30c5000906ac441ca4601c`.
- Source status: Not final runtime-accepted. Tested leaf `internal/apps/homarr/target_emby.go`; next candidate leaf `internal/apps/homarr/target_emby.go`. Native verifier in tested source: **True**.
- Aggregate own Setup: **manual**; Link step: **skip**; runtime selected: **True**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed).
- App-specific hold: First-owner wizard Manual; real key inventory, media/playback and native lifecycle held
- **Next:** First-owner wizard remains an expected Manual step. After explicit completion, verify actual owned key inventory and native data; no playback/library scans are approved.
- Import allowlist from tested manifest: `internal/apps/emby/emby.go`, `internal/apps/emby/homarr.go`, `internal/apps/homarr/target_emby.go`. These are historical paths, not a fresh-head diff allowlist.

### Frigate — `frigate`

- Issue [#277](https://github.com/ajnart/selfhost-skills/issues/277) **OPEN**; PR [#331](https://github.com/ajnart/selfhost-skills/pull/331) **OPEN**, draft=True; branch `feat/homarr-frigate-sol`, current GitHub base `feat/homarr-immich-sol`.
- **Live head:** `0d06cdf5133459657af2f6a126d8bb12fa3235c2`. **Actually aggregate-tested source:** `0d06cdf5133459657af2f6a126d8bb12fa3235c2`. **Historical import base:** `dce263ef822dc056558a648f8f59ea795a3e56d9`.
- Source status: Not final runtime-accepted. Tested leaf `internal/apps/homarr/target_frigate.go`; next candidate leaf `internal/apps/homarr/target_frigate.go`. Native verifier in tested source: **True**.
- Aggregate own Setup: **ok**; Link step: **manual**; runtime selected: **True**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed).
- App-specific hold: Trusted HTTPS prerequisite; authenticated HTTP starter remains Manual before mutation; no footage/hardware proof
- **Next:** Carry separately reviewed #355 only through custodian reconciliation. Trusted HTTPS and both CLI/Homarr trust need explicit approval; no port 5000, disabled auth or certificate bypass.
- Import allowlist from tested manifest: `internal/apps/frigate/frigate.go`, `internal/apps/homarr/target_frigate.go`. These are historical paths, not a fresh-head diff allowlist.

### Gatus — `gatus`

- Issue [#280](https://github.com/ajnart/selfhost-skills/issues/280) **OPEN**; PR [#321](https://github.com/ajnart/selfhost-skills/pull/321) **OPEN**, draft=True; branch `feat/homarr-gatus-sol`, current GitHub base `main`.
- **Live head:** `b8ab54070762845e7720e7c16322a6611dc82eaa`. **Actually aggregate-tested source:** `b8ab54070762845e7720e7c16322a6611dc82eaa`. **Historical import base:** `6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c`.
- Source status: Individually registered + complete normalized source pair PASS; native/lifecycle held. Tested leaf `internal/apps/homarr/target_gatus.go`; next candidate leaf `internal/apps/homarr/target_gatus.go`. Native verifier in tested source: **True**.
- Aggregate own Setup: **ok**; Link step: **ok**; runtime selected: **True**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed).
- App-specific hold: Registered/source-only; real native/rendered/local provenance/both-order/cross-kind lifecycle held
- **Next:** Preserve the already normalized/registered source and its complete source pass. Reconcile cumulative registration with current main, then obtain independent native/rendered/lifecycle evidence and final exact accepted-head review; do not redo unchanged source work merely to fill review slots.
- Import allowlist from tested manifest: `internal/apps/gatus/gatus.go`, `internal/apps/homarr/target_gatus.go`. These are historical paths, not a fresh-head diff allowlist.
- Recorded review/status pointer: https://github.com/ajnart/selfhost-skills/pull/321#issuecomment-6115733184. Read its exact head/scope; old source verdicts do not establish native acceptance.

### Glances — `glances`

- Issue [#281](https://github.com/ajnart/selfhost-skills/issues/281) **OPEN**; PR [#326](https://github.com/ajnart/selfhost-skills/pull/326) **OPEN**, draft=True; branch `feat/homarr-glances-sol`, current GitHub base `feat/homarr-immich-sol`.
- **Live head:** `e68ea343cca6fdb8097d47f0f981df11d38f48dd`. **Actually aggregate-tested source:** `e68ea343cca6fdb8097d47f0f981df11d38f48dd`. **Historical import base:** `dce263ef822dc056558a648f8f59ea795a3e56d9`.
- Source status: Not final runtime-accepted. Tested leaf `internal/apps/homarr/target_glances.go`; next candidate leaf `internal/apps/homarr/target_glances.go`. Native verifier in tested source: **True**.
- Aggregate own Setup: **ok**; Link step: **ok**; runtime selected: **True**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed).
- App-specific hold: Native empty-credential contract cannot justify disabling existing authentication; Manual boundary
- **Next:** No demonstrated aggregate production defect. Reuse the observed source checks, normalize/register the individual branch, complete exact-head review and obtain independent native/rendered/lifecycle evidence; preserve the App-specific scope below.
- Import allowlist from tested manifest: `internal/apps/glances/glances.go`, `internal/apps/glances/homarr.go`, `internal/apps/homarr/target_glances.go`. These are historical paths, not a fresh-head diff allowlist.
- Recorded review/status pointer: https://github.com/ajnart/selfhost-skills/pull/326#issuecomment-6118356387. Read its exact head/scope; old source verdicts do not establish native acceptance.

### Gluetun — `gluetun`

- Issue [#279](https://github.com/ajnart/selfhost-skills/issues/279) **OPEN**; PR [#327](https://github.com/ajnart/selfhost-skills/pull/327) **OPEN**, draft=True; branch `feat/homarr-gluetun-sol`, current GitHub base `feat/homarr-immich-sol`.
- **Live head:** `7d70c832c426eb1485ef8f072d461a621cfcabb1`. **Actually aggregate-tested source:** `7d70c832c426eb1485ef8f072d461a621cfcabb1`. **Historical import base:** `cf8f04c07da6a0394c30c5000906ac441ca4601c`.
- Source status: Not final runtime-accepted. Tested leaf `internal/apps/homarr/target_gluetun.go`; next candidate leaf `internal/apps/homarr/target_gluetun.go`. Native verifier in tested source: **True**.
- Aggregate own Setup: **not-selected**; Link step: **not selected**; runtime selected: **False**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed), #332 (open).
- App-specific hold: Native blocker [#332](https://github.com/ajnart/selfhost-skills/issues/332) open; secret-bearing settings read denied; provider/tunnel scope held
- **Next:** Resolve #332 via supported non-secret summary semantics before activation/registration; missing pre-mutation preflight is not waived by a later verifier rejection. Keep excluded.
- Import allowlist from tested manifest: `internal/apps/gluetun/gluetun.go`, `internal/apps/homarr/target_gluetun.go`. These are historical paths, not a fresh-head diff allowlist.

### Gotify — `gotify`

- Issue [#282](https://github.com/ajnart/selfhost-skills/issues/282) **OPEN**; PR [#325](https://github.com/ajnart/selfhost-skills/pull/325) **OPEN**, draft=True; branch `feat/homarr-gotify-sol`, current GitHub base `feat/homarr-immich-sol`.
- **Live head:** `384111f936710bf75cb18707b8d64274772903d7`. **Actually aggregate-tested source:** `384111f936710bf75cb18707b8d64274772903d7`. **Historical import base:** `b8f5ea0b27c1641079b834b280cc28b067119b1d`.
- Source status: Not final runtime-accepted. Tested leaf `internal/apps/homarr/target_gotify.go`; next candidate leaf `internal/apps/homarr/target_gotify.go`. Native verifier in tested source: **True**.
- Aggregate own Setup: **ok**; Link step: **ok**; runtime selected: **True**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed).
- App-specific hold: Normalization/registration held; actual scoped account/message/native/rendered/lifecycle proof pending
- **Next:** No demonstrated aggregate production defect. Reuse the observed source checks, normalize/register the individual branch, complete exact-head review and obtain independent native/rendered/lifecycle evidence; preserve the App-specific scope below.
- Import allowlist from tested manifest: `internal/apps/gotify/gotify.go`, `internal/apps/gotify/homarr.go`, `internal/apps/homarr/target_gotify.go`. These are historical paths, not a fresh-head diff allowlist.
- Recorded review/status pointer: https://github.com/ajnart/selfhost-skills/pull/325#issuecomment-6115787860. Read its exact head/scope; old source verdicts do not establish native acceptance.

### Home Assistant — `home-assistant`

- Issue [#285](https://github.com/ajnart/selfhost-skills/issues/285) **OPEN**; PR [#333](https://github.com/ajnart/selfhost-skills/pull/333) **OPEN**, draft=True; branch `feat/homarr-home-assistant-sol`, current GitHub base `feat/homarr-immich-sol`.
- **Live head:** `2ea747b1ee94f8a50c8741230b245aedb9cd12b4`. **Actually aggregate-tested source:** `2ea747b1ee94f8a50c8741230b245aedb9cd12b4`. **Historical import base:** `dce263ef822dc056558a648f8f59ea795a3e56d9`.
- Source status: Not final runtime-accepted. Tested leaf `internal/apps/homarr/target_home_assistant.go`; next candidate leaf `internal/apps/homarr/target_home_assistant.go`. Native verifier in tested source: **True**.
- Aggregate own Setup: **incomplete**; Link step: **skip**; runtime selected: **True**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed).
- App-specific hold: Owner/MFA/token/entity Manual gates; no real-device automation or guessed entity acceptance
- **Next:** Optionally resume safe diagnostic forwarding after redaction review. Capture stage/category plus redacted exec/log evidence before claiming an authentication or token fix; preserve owner/MFA/entity Manual boundaries.
- Import allowlist from tested manifest: `internal/apps/homeassistant/homeassistant.go`, `internal/apps/homeassistant/homarr.go`, `internal/apps/homeassistant/homarr_auth.go`, `internal/apps/homarr/target_home_assistant.go`. These are historical paths, not a fresh-head diff allowlist.

### Immich — `immich`

- Issue [#262](https://github.com/ajnart/selfhost-skills/issues/262) **CLOSED**; PR [#309](https://github.com/ajnart/selfhost-skills/pull/309) **MERGED**, draft=False; branch `feat/homarr-immich-sol`, current GitHub base `main`.
- **Live head:** `33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`. **Actually aggregate-tested source:** `33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`. **Historical import base:** `33e7fbccb7541d2bbf1d81968eb21c35a1b5bfd7`.
- Source status: Merged reference; accepted bounded authenticated EMPTY library only. Tested leaf `internal/apps/homarr/target_immich.go`; next candidate leaf `internal/apps/homarr/target_immich.go`. Native verifier in tested source: **True**.
- Aggregate own Setup: **incomplete**; Link step: **skip**; runtime selected: **True**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: none recorded / reference issue already closed.
- App-specific hold: Accepted 1/39 empty-library reference only; populated media/cross-kind and listed limits remain
- **Next:** Keep accepted reference unchanged. Recompute proposed database/ML cap redistribution in a fresh plan and observe timestamp-aligned startup/OOM/readiness; do not infer a source regression from the aggregate OOM flag.
- Import allowlist from tested manifest: `internal/apps/immich/homarr.go`, `internal/apps/immich/immich.go`, `internal/apps/homarr/target_immich.go`. These are historical paths, not a fresh-head diff allowlist.

### Lidarr — `lidarr`

- Issue [#283](https://github.com/ajnart/selfhost-skills/issues/283) **OPEN**; PR [#318](https://github.com/ajnart/selfhost-skills/pull/318) **OPEN**, draft=True; branch `feat/homarr-lidarr-sol`, current GitHub base `feat/homarr-immich-sol`.
- **Live head:** `e8ea969a9d3a2f07ca9ba626996a6207d0cd087d`. **Actually aggregate-tested source:** `e8ea969a9d3a2f07ca9ba626996a6207d0cd087d`. **Historical import base:** `573a206e2b4a76574fd7e8cbd1f21c5a4c2fd37d`.
- Source status: Not final runtime-accepted. Tested leaf `internal/apps/homarr/target_lidarr.go`; next candidate leaf `internal/apps/homarr/target_lidarr.go`. Native verifier in tested source: **True**.
- Aggregate own Setup: **ok**; Link step: **ok**; runtime selected: **True**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed).
- App-specific hold: Calendar/music data and native lifecycle held; no external download approval
- **Next:** No demonstrated aggregate production defect. Reuse the observed source checks, normalize/register the individual branch, complete exact-head review and obtain independent native/rendered/lifecycle evidence; preserve the App-specific scope below.
- Import allowlist from tested manifest: `internal/apps/lidarr/lidarr.go`, `internal/apps/homarr/target_lidarr.go`. These are historical paths, not a fresh-head diff allowlist.
- Recorded review/status pointer: https://github.com/ajnart/selfhost-skills/pull/318#issuecomment-6124102113. Read its exact head/scope; old source verdicts do not establish native acceptance.

### Linkwarden — `linkwarden`

- Issue [#286](https://github.com/ajnart/selfhost-skills/issues/286) **OPEN**; PR [#328](https://github.com/ajnart/selfhost-skills/pull/328) **OPEN**, draft=True; branch `feat/homarr-linkwarden-sol`, current GitHub base `feat/homarr-immich-sol`.
- **Live head:** `76ff8634ddaa70ce2f5bb757bc0427f3dcf8e72c`. **Actually aggregate-tested source:** `76ff8634ddaa70ce2f5bb757bc0427f3dcf8e72c`. **Historical import base:** `6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c`.
- Source status: Not final runtime-accepted. Tested leaf `internal/apps/homarr/target_linkwarden.go`; next candidate leaf `internal/apps/homarr/target_linkwarden.go`. Native verifier in tested source: **True**.
- Aggregate own Setup: **ok**; Link step: **ok**; runtime selected: **True**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed).
- App-specific hold: Token retains administrator write authority; private bookmark/native lifecycle proof held
- **Next:** No demonstrated aggregate production defect. Reuse the observed source checks, normalize/register the individual branch, complete exact-head review and obtain independent native/rendered/lifecycle evidence; preserve the App-specific scope below.
- Import allowlist from tested manifest: `internal/apps/linkwarden/linkwarden.go`, `internal/apps/linkwarden/homarr.go`, `internal/apps/homarr/target_linkwarden.go`. These are historical paths, not a fresh-head diff allowlist.
- Recorded review/status pointer: https://github.com/ajnart/selfhost-skills/pull/328#issuecomment-6122072416. Read its exact head/scope; old source verdicts do not establish native acceptance.

### Navidrome — `navidrome`

- Issue [#284](https://github.com/ajnart/selfhost-skills/issues/284) **OPEN**; PR [#330](https://github.com/ajnart/selfhost-skills/pull/330) **OPEN**, draft=True; branch `feat/homarr-navidrome-sol`, current GitHub base `feat/homarr-immich-sol`.
- **Live head:** `f343928008783ce6cc9b2e58f82ed6e378382631`. **Actually aggregate-tested source:** `f343928008783ce6cc9b2e58f82ed6e378382631`. **Historical import base:** `dce263ef822dc056558a648f8f59ea795a3e56d9`.
- Source status: Not final runtime-accepted. Tested leaf `internal/apps/homarr/target_navidrome.go`; next candidate leaf `internal/apps/homarr/target_navidrome.go`. Native verifier in tested source: **True**.
- Aggregate own Setup: **ok**; Link step: **ok**; runtime selected: **True**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed).
- App-specific hold: Shared Admin scope/query-secret transport limits; owned audio/listening/native lifecycle held
- **Next:** No demonstrated aggregate production defect. Reuse the observed source checks, normalize/register the individual branch, complete exact-head review and obtain independent native/rendered/lifecycle evidence; preserve the App-specific scope below.
- Import allowlist from tested manifest: `internal/apps/navidrome/navidrome.go`, `internal/apps/navidrome/homarr.go`, `internal/apps/homarr/target_navidrome.go`. These are historical paths, not a fresh-head diff allowlist.
- Recorded review/status pointer: https://github.com/ajnart/selfhost-skills/pull/330#issuecomment-6122653186. Read its exact head/scope; old source verdicts do not establish native acceptance.

### Netdata — `netdata`

- Issue [#287](https://github.com/ajnart/selfhost-skills/issues/287) **OPEN**; PR [#329](https://github.com/ajnart/selfhost-skills/pull/329) **OPEN**, draft=True; branch `feat/homarr-netdata-sol`, current GitHub base `feat/homarr-immich-sol`.
- **Live head:** `87a69b36ab077b5683b47932935f49a5fa41280b`. **Actually aggregate-tested source:** `87a69b36ab077b5683b47932935f49a5fa41280b`. **Historical import base:** `dce263ef822dc056558a648f8f59ea795a3e56d9`.
- Source status: Not final runtime-accepted. Tested leaf `internal/apps/homarr/target_netdata.go`; next candidate leaf `internal/apps/homarr/target_netdata.go`. Native verifier in tested source: **True**.
- Aggregate own Setup: **ok**; Link step: **ok**; runtime selected: **True**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed).
- App-specific hold: Real available collector/native data and lifecycle held; no Cloud/hardware success inferred
- **Next:** No demonstrated aggregate production defect. Reuse the observed source checks, normalize/register the individual branch, complete exact-head review and obtain independent native/rendered/lifecycle evidence; preserve the App-specific scope below.
- Import allowlist from tested manifest: `internal/apps/netdata/netdata.go`, `internal/apps/netdata/metrics.go`, `internal/apps/homarr/target_netdata.go`. These are historical paths, not a fresh-head diff allowlist.
- Recorded review/status pointer: https://github.com/ajnart/selfhost-skills/pull/329#issuecomment-6121022426. Read its exact head/scope; old source verdicts do not establish native acceptance.

### Nextcloud — `nextcloud`

- Issue [#288](https://github.com/ajnart/selfhost-skills/issues/288) **OPEN**; PR [#340](https://github.com/ajnart/selfhost-skills/pull/340) **OPEN**, draft=True; branch `feat/homarr-nextcloud-sol`, current GitHub base `feat/homarr-immich-sol`.
- **Live head:** `21f74e29d9c7e75da04c0410a2fcad717cc2f75f`. **Actually aggregate-tested source:** `21f74e29d9c7e75da04c0410a2fcad717cc2f75f`. **Historical import base:** `795c6d082c8affd213447e0629328fb7ba9d2fe4`.
- Source status: Not final runtime-accepted. Tested leaf `internal/apps/homarr/target_nextcloud.go`; next candidate leaf `internal/apps/homarr/target_nextcloud.go`. Native verifier in tested source: **True**.
- Aggregate own Setup: **ok**; Link step: **ok**; runtime selected: **True**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed).
- App-specific hold: Broad administrator app-password/2FA tradeoff; real calendar/notification/lifecycle held
- **Next:** No demonstrated aggregate production defect. Reuse the observed source checks, normalize/register the individual branch, complete exact-head review and obtain independent native/rendered/lifecycle evidence; preserve the App-specific scope below.
- Import allowlist from tested manifest: `internal/apps/nextcloud/nextcloud.go`, `internal/apps/homarr/target_nextcloud.go`. These are historical paths, not a fresh-head diff allowlist.
- Recorded review/status pointer: https://github.com/ajnart/selfhost-skills/pull/340#issuecomment-6118250647. Read its exact head/scope; old source verdicts do not establish native acceptance.

### NZBGet — `nzbget`

- Issue [#290](https://github.com/ajnart/selfhost-skills/issues/290) **OPEN**; PR [#335](https://github.com/ajnart/selfhost-skills/pull/335) **OPEN**, draft=True; branch `feat/homarr-nzbget-sol`, current GitHub base `feat/homarr-immich-sol`.
- **Live head:** `d03616aac0a2aa902097cbd7062d99abf514f891`. **Actually aggregate-tested source:** `52eab49981b87fed11ba6a9e152ebf1eab2a07ab`. **Historical import base:** `795c6d082c8affd213447e0629328fb7ba9d2fe4`.
- Source status: Complete source pair PASS on diagnostic pin; activation privacy-held by #354. Tested leaf `internal/apps/homarr/target_nzbget.go`; next candidate leaf `internal/apps/homarr/target_nzbget.go`. Native verifier in tested source: **True**.
- Aggregate own Setup: **incomplete**; Link step: **skip**; runtime selected: **True**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed), #354 (open).
- App-specific hold: Restricted login is not read-only; provider/native/credential-path redaction/lifecycle held
- **Next:** Use diagnostic-reviewed d03616aa; independently review prepared argv guard and any exact one-use owned-service restart policy. Capture the real save/permission/subprocess result. Native activation stays blocked by #354.
- Import allowlist from tested manifest: `internal/apps/nzbget/nzbget.go`, `internal/apps/nzbget/homarr.go`, `internal/apps/homarr/target_nzbget.go`. These are historical paths, not a fresh-head diff allowlist.
- Recorded review/status pointer: https://github.com/ajnart/selfhost-skills/pull/335#issuecomment-6131251720. Read its exact head/scope; old source verdicts do not establish native acceptance.

### Paperless-ngx — `paperless-ngx`

- Issue [#289](https://github.com/ajnart/selfhost-skills/issues/289) **OPEN**; PR [#312](https://github.com/ajnart/selfhost-skills/pull/312) **OPEN**, draft=True; branch `feat/homarr-paperless-sol`, current GitHub base `main`.
- **Live head:** `df16f7231e9299e9fb6c5975da6669f398f6ce30`. **Actually aggregate-tested source:** `df16f7231e9299e9fb6c5975da6669f398f6ce30`. **Historical import base:** `5aafb4c1833fd4cd9caf0f7beaac31e625aafe22`.
- Source status: Stage-1 nil verifier; cancelled completion. Tested leaf `internal/apps/homarr/integration_paperless.go`; next candidate leaf `internal/apps/homarr/integration_paperless.go`. Native verifier in tested source: **False**.
- Aggregate own Setup: **ok**; Link step: **ok**; runtime selected: **True**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed).
- App-specific hold: App credential prerequisite proof only; native widget, ingestion/OCR and lifecycle not accepted
- **Next:** Resume the cancelled original owner only by explicit direction; complete semantic saved-native document/count/widget verification through the existing seam, preserving canonical owned identity and private recovery; no OCR/ingestion run implied.
- Import allowlist from tested manifest: `internal/apps/paperlessngx/paperlessngx.go`, `internal/apps/paperlessngx/token.go`, `internal/apps/homarr/integration_paperless.go`. These are historical paths, not a fresh-head diff allowlist.
- Recorded review/status pointer: https://github.com/ajnart/selfhost-skills/pull/312#issuecomment-6124860310. Read its exact head/scope; old source verdicts do not establish native acceptance.

### PatchMon — `patchmon`

- Issue [#291](https://github.com/ajnart/selfhost-skills/issues/291) **OPEN**; PR [#345](https://github.com/ajnart/selfhost-skills/pull/345) **OPEN**, draft=True; branch `feat/homarr-patchmon-sol`, current GitHub base `feat/homarr-immich-sol`.
- **Live head:** `05f68f3bd937bdec2bb0efd32c0e171c08a794c2`. **Actually aggregate-tested source:** `05f68f3bd937bdec2bb0efd32c0e171c08a794c2`. **Historical import base:** `d956824f3758e26bb9cdfc262e229eaf67ef187c`.
- Source status: Not final runtime-accepted. Tested leaf `internal/apps/homarr/target_patchmon.go`; next candidate leaf `internal/apps/homarr/target_patchmon.go`. Native verifier in tested source: **True**.
- Aggregate own Setup: **incomplete**; Link step: **skip**; runtime selected: **True**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed), #350 (open).
- App-specific hold: Native blocker [#350](https://github.com/ajnart/selfhost-skills/issues/350) open; statistics credentials also authorize enrollment; issuance/registration held
- **Next:** Capture owned server/dependency startup logs and listener chronology for connection refusal. Separately resolve #350 statistics/enrollment authority before issuing or activating credentials.
- Import allowlist from tested manifest: `internal/apps/patchmon/patchmon.go`, `internal/apps/patchmon/homarr.go`, `internal/apps/homarr/target_patchmon.go`. These are historical paths, not a fresh-head diff allowlist.
- Recorded review/status pointer: https://github.com/ajnart/selfhost-skills/pull/345#issuecomment-6114026819. Read its exact head/scope; old source verdicts do not establish native acceptance.

### PeaNUT — `peanut`

- Issue [#293](https://github.com/ajnart/selfhost-skills/issues/293) **OPEN**; PR [#347](https://github.com/ajnart/selfhost-skills/pull/347) **OPEN**, draft=True; branch `feat/homarr-peanut-sol`, current GitHub base `feat/homarr-immich-sol`.
- **Live head:** `fc5583b0f5b45e137464c06e67213e0f7ff6e75d`. **Actually aggregate-tested source:** `fc5583b0f5b45e137464c06e67213e0f7ff6e75d`. **Historical import base:** `d956824f3758e26bb9cdfc262e229eaf67ef187c`.
- Source status: Not final runtime-accepted. Tested leaf `internal/apps/homarr/target_peanut.go`; next candidate leaf `internal/apps/homarr/target_peanut.go`. Native verifier in tested source: **True**.
- Aggregate own Setup: **manual**; Link step: **skip**; runtime selected: **True**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed).
- App-specific hold: NUT/UPS readings Manual; dummy API data is not physical hardware-health proof
- **Next:** Owner-selected NUT/UPS is an expected Manual prerequisite. A dummy local API can prove parsing only, not physical UPS readings or health.
- Import allowlist from tested manifest: `internal/apps/peanut/peanut.go`, `internal/apps/homarr/target_peanut.go`. These are historical paths, not a fresh-head diff allowlist.

### Pi-hole — `pihole`

- Issue [#292](https://github.com/ajnart/selfhost-skills/issues/292) **OPEN**; PR [#339](https://github.com/ajnart/selfhost-skills/pull/339) **OPEN**, draft=True; branch `feat/homarr-pihole-sol`, current GitHub base `feat/homarr-immich-sol`.
- **Live head:** `64be8d4ba38fb0e6f92e7f7d00d560603da37f87`. **Actually aggregate-tested source:** `64be8d4ba38fb0e6f92e7f7d00d560603da37f87`. **Historical import base:** `d956824f3758e26bb9cdfc262e229eaf67ef187c`.
- Source status: Not final runtime-accepted. Tested leaf `internal/apps/homarr/target_pihole.go`; next candidate leaf `internal/apps/homarr/target_pihole.go`. Native verifier in tested source: **True**.
- Aggregate own Setup: **ok**; Link step: **ok**; runtime selected: **True**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed).
- App-specific hold: v6 application-password/2FA scope gates; container-local DNS/native lifecycle held; no controls
- **Next:** No demonstrated aggregate production defect. Reuse the observed source checks, normalize/register the individual branch, complete exact-head review and obtain independent native/rendered/lifecycle evidence; preserve the App-specific scope below.
- Import allowlist from tested manifest: `internal/apps/pihole/pihole.go`, `internal/apps/pihole/homarr.go`, `internal/apps/homarr/target_pihole.go`. These are historical paths, not a fresh-head diff allowlist.

### Plex — `plex`

- Issue [#294](https://github.com/ajnart/selfhost-skills/issues/294) **OPEN**; PR [#348](https://github.com/ajnart/selfhost-skills/pull/348) **OPEN**, draft=True; branch `feat/homarr-plex-sol`, current GitHub base `feat/homarr-immich-sol`.
- **Live head:** `8db89ddd50574153405c0d1a60dee18e0dfa16d0`. **Actually aggregate-tested source:** `8db89ddd50574153405c0d1a60dee18e0dfa16d0`. **Historical import base:** `d956824f3758e26bb9cdfc262e229eaf67ef187c`.
- Source status: Not final runtime-accepted. Tested leaf `internal/apps/homarr/target_plex.go`; next candidate leaf `internal/apps/homarr/target_plex.go`. Native verifier in tested source: **True**.
- Aggregate own Setup: **not-selected**; Link step: **not selected**; runtime selected: **False**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed).
- App-specific hold: Account ownership/server-ID Manual gate; administrator token, media/playback/native lifecycle held
- **Next:** Keep excluded until separately approved external account and attested server ownership. Do not use real user tokens, claim servers, playback media or infer entitlement.
- Import allowlist from tested manifest: `internal/apps/plex/plex.go`, `internal/apps/homarr/target_plex.go`. These are historical paths, not a fresh-head diff allowlist.

### Prometheus — `prometheus`

- Issue [#299](https://github.com/ajnart/selfhost-skills/issues/299) **OPEN**; PR [#336](https://github.com/ajnart/selfhost-skills/pull/336) **OPEN**, draft=True; branch `feat/homarr-prometheus-sol`, current GitHub base `main`.
- **Live head:** `2231ee7542a1fe6082ec8f0a568ebb2ffa2dd17b`. **Actually aggregate-tested source:** `2231ee7542a1fe6082ec8f0a568ebb2ffa2dd17b`. **Historical import base:** `6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c`.
- Source status: Individually registered + complete normalized source pair PASS; native/lifecycle held. Tested leaf `internal/apps/homarr/target_prometheus.go`; next candidate leaf `internal/apps/homarr/target_prometheus.go`. Native verifier in tested source: **True**.
- Aggregate own Setup: **ok**; Link step: **ok**; runtime selected: **True**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed).
- App-specific hold: Registered/source-only; native/rendered/Basic-mode/both-order/cross-kind lifecycle held
- **Next:** Preserve the already normalized/registered source and its complete source pass. Reconcile cumulative registration with current main, then obtain independent native/rendered/lifecycle evidence and final exact accepted-head review; do not redo unchanged source work merely to fill review slots.
- Import allowlist from tested manifest: `internal/apps/prometheus/prometheus.go`, `internal/apps/prometheus/readiness.go`, `internal/apps/homarr/target_prometheus.go`. These are historical paths, not a fresh-head diff allowlist.
- Recorded review/status pointer: https://github.com/ajnart/selfhost-skills/pull/336#issuecomment-6115733177. Read its exact head/scope; old source verdicts do not establish native acceptance.

### SABnzbd — `sabnzbd`

- Issue [#298](https://github.com/ajnart/selfhost-skills/issues/298) **OPEN**; PR [#334](https://github.com/ajnart/selfhost-skills/pull/334) **OPEN**, draft=True; branch `feat/homarr-sabnzbd-sol`, current GitHub base `feat/homarr-immich-sol`.
- **Live head:** `908931b24cf9c013768fce1a94c64e96aa37f109`. **Actually aggregate-tested source:** `908931b24cf9c013768fce1a94c64e96aa37f109`. **Historical import base:** `dce263ef822dc056558a648f8f59ea795a3e56d9`.
- Source status: Not final runtime-accepted. Tested leaf `internal/apps/homarr/target_sabnzbd.go`; next candidate leaf `internal/apps/homarr/target_sabnzbd.go`. Native verifier in tested source: **True**.
- Aggregate own Setup: **manual**; Link step: **skip**; runtime selected: **True**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed).
- App-specific hold: Full API key/provider Manual gate; no Usenet transfer or native lifecycle acceptance
- **Next:** Enabled consecutive provider configuration remains Manual; authenticated empty config is not failed authentication. Do not create fake provider success or transfer Usenet data.
- Import allowlist from tested manifest: `internal/apps/sabnzbd/sabnzbd.go`, `internal/apps/sabnzbd/api.go`, `internal/apps/homarr/target_sabnzbd.go`. These are historical paths, not a fresh-head diff allowlist.
- Recorded review/status pointer: https://github.com/ajnart/selfhost-skills/pull/334#issuecomment-6123210143. Read its exact head/scope; old source verdicts do not establish native acceptance.

### Slskd — `slskd`

- Issue [#297](https://github.com/ajnart/selfhost-skills/issues/297) **OPEN**; PR [#342](https://github.com/ajnart/selfhost-skills/pull/342) **OPEN**, draft=True; branch `feat/homarr-slskd-sol`, current GitHub base `feat/homarr-immich-sol`.
- **Live head:** `2cf210a6700b6a6d2a39fb57bb511ff17d6cec96`. **Actually aggregate-tested source:** `2cf210a6700b6a6d2a39fb57bb511ff17d6cec96`. **Historical import base:** `d956824f3758e26bb9cdfc262e229eaf67ef187c`.
- Source status: Not final runtime-accepted. Tested leaf `internal/apps/homarr/target_slskd.go`; next candidate leaf `internal/apps/homarr/target_slskd.go`. Native verifier in tested source: **True**.
- Aggregate own Setup: **not-selected**; Link step: **not selected**; runtime selected: **False**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed).
- App-specific hold: Soulseek login Manual; effective ReadOnly role/write denial and native lifecycle unproved
- **Next:** Keep excluded until provider/network authorization; verify effective ReadOnly authority rather than assuming the configured role prevents writes.
- Import allowlist from tested manifest: `internal/apps/slskd/slskd.go`, `internal/apps/slskd/homarr.go`, `internal/apps/homarr/target_slskd.go`. These are historical paths, not a fresh-head diff allowlist.

### Speedtest Tracker — `speedtest-tracker`

- Issue [#296](https://github.com/ajnart/selfhost-skills/issues/296) **OPEN**; PR [#351](https://github.com/ajnart/selfhost-skills/pull/351) **OPEN**, draft=True; branch `feat/homarr-speedtest-sol`, current GitHub base `feat/homarr-immich-sol`.
- **Live head:** `29659099e33da9bead3aad2414f8f3965efafc27`. **Actually aggregate-tested source:** `29659099e33da9bead3aad2414f8f3965efafc27`. **Historical import base:** `d956824f3758e26bb9cdfc262e229eaf67ef187c`.
- Source status: Not final runtime-accepted. Tested leaf `internal/apps/homarr/target_speedtest_tracker.go`; next candidate leaf `internal/apps/homarr/target_speedtest_tracker.go`. Native verifier in tested source: **True**.
- Aggregate own Setup: **manual**; Link step: **skip**; runtime selected: **True**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed).
- App-specific hold: Normalization/registration held; actual token/rootless/rendered proof and separate lawful measurement/bandwidth approval pending
- **Next:** Keep missing usable measurement Manual. Token issuance/results:read authority and rootless startup need bounded proof; running a bandwidth measurement requires separate approval.
- Import allowlist from tested manifest: `internal/apps/speedtesttracker/speedtesttracker.go`, `internal/apps/speedtesttracker/homarr.go`, `internal/apps/homarr/target_speedtest_tracker.go`. These are historical paths, not a fresh-head diff allowlist.
- Recorded review/status pointer: https://github.com/ajnart/selfhost-skills/pull/351#issuecomment-6114247126. Read its exact head/scope; old source verdicts do not establish native acceptance.

### Tdarr — `tdarr`

- Issue [#301](https://github.com/ajnart/selfhost-skills/issues/301) **OPEN**; PR [#349](https://github.com/ajnart/selfhost-skills/pull/349) **OPEN**, draft=True; branch `feat/homarr-tdarr-sol`, current GitHub base `feat/homarr-immich-sol`.
- **Live head:** `21d3624b86411b9011a4e9ad3cacc94b60174279`. **Actually aggregate-tested source:** `21d3624b86411b9011a4e9ad3cacc94b60174279`. **Historical import base:** `d956824f3758e26bb9cdfc262e229eaf67ef187c`.
- Source status: Not final runtime-accepted. Tested leaf `internal/apps/homarr/target_tdarr.go`; next candidate leaf `internal/apps/homarr/target_tdarr.go`. Native verifier in tested source: **True**.
- Aggregate own Setup: **ok**; Link step: **ok**; runtime selected: **True**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed).
- App-specific hold: Global key/node Manual gates; worker/media/license/GPU/transcoding and native lifecycle held
- **Next:** No demonstrated aggregate production defect. Reuse the observed source checks, normalize/register the individual branch, complete exact-head review and obtain independent native/rendered/lifecycle evidence; preserve the App-specific scope below.
- Import allowlist from tested manifest: `internal/apps/tdarr/tdarr.go`, `internal/apps/tdarr/homarr.go`, `internal/apps/homarr/target_tdarr.go`. These are historical paths, not a fresh-head diff allowlist.

### Technitium DNS — `technitium-dns`

- Issue [#303](https://github.com/ajnart/selfhost-skills/issues/303) **OPEN**; PR [#338](https://github.com/ajnart/selfhost-skills/pull/338) **OPEN**, draft=True; branch `feat/homarr-technitium-sol`, current GitHub base `feat/homarr-immich-sol`.
- **Live head:** `aafb8c4e71cc8d6dabb27ee4e3a8d2a34c9cd631`. **Actually aggregate-tested source:** `aafb8c4e71cc8d6dabb27ee4e3a8d2a34c9cd631`. **Historical import base:** `795c6d082c8affd213447e0629328fb7ba9d2fe4`.
- Source status: Not final runtime-accepted. Tested leaf `internal/apps/homarr/target_technitium_dns.go`; next candidate leaf `internal/apps/homarr/target_technitium_dns.go`. Native verifier in tested source: **True**.
- Aggregate own Setup: **ok**; Link step: **ok**; runtime selected: **True**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed).
- App-specific hold: Effective account permissions/LastHour semantics and native lifecycle held; no resolver/zone/control actions
- **Next:** No demonstrated aggregate production defect. Reuse the observed source checks, normalize/register the individual branch, complete exact-head review and obtain independent native/rendered/lifecycle evidence; preserve the App-specific scope below.
- Import allowlist from tested manifest: `internal/apps/technitiumdns/technitiumdns.go`, `internal/apps/homarr/target_technitium_dns.go`. These are historical paths, not a fresh-head diff allowlist.

### Tracearr — `tracearr`

- Issue [#302](https://github.com/ajnart/selfhost-skills/issues/302) **OPEN**; PR [#346](https://github.com/ajnart/selfhost-skills/pull/346) **OPEN**, draft=True; branch `feat/homarr-tracearr-sol`, current GitHub base `feat/homarr-immich-sol`.
- **Live head:** `ab4ac17a94c0ee42807e8cf6bc16c5f5241e3c6f`. **Actually aggregate-tested source:** `ab4ac17a94c0ee42807e8cf6bc16c5f5241e3c6f`. **Historical import base:** `d956824f3758e26bb9cdfc262e229eaf67ef187c`.
- Source status: Not final runtime-accepted. Tested leaf `internal/apps/homarr/target_tracearr.go`; next candidate leaf `internal/apps/homarr/target_tracearr.go`. Native verifier in tested source: **True**.
- Aggregate own Setup: **incomplete**; Link step: **skip**; runtime selected: **True**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed).
- App-specific hold: Owner key can terminate streams; owned online media-server prerequisite and native lifecycle held
- **Next:** Capture actual authenticated API version field/type/value and matching image provenance with safe evidence capture. Keep the exact gate until a supported contract is demonstrated; no media-server/provider access implied.
- Import allowlist from tested manifest: `internal/apps/tracearr/tracearr.go`, `internal/apps/tracearr/homarr.go`, `internal/apps/homarr/target_tracearr.go`. These are historical paths, not a fresh-head diff allowlist.

### Traefik — `traefik`

- Issue [#304](https://github.com/ajnart/selfhost-skills/issues/304) **OPEN**; PR [#352](https://github.com/ajnart/selfhost-skills/pull/352) **OPEN**, draft=True; branch `feat/homarr-traefik-sol`, current GitHub base `feat/homarr-immich-sol`.
- **Live head:** `3ecd50a434613b649e072cd33917d22e4d780e93`. **Actually aggregate-tested source:** `3ecd50a434613b649e072cd33917d22e4d780e93`. **Historical import base:** `d956824f3758e26bb9cdfc262e229eaf67ef187c`.
- Source status: Not final runtime-accepted. Tested leaf `internal/apps/homarr/target_traefik.go`; next candidate leaf `internal/apps/homarr/target_traefik.go`. Native verifier in tested source: **True**.
- Aggregate own Setup: **ok**; Link step: **ok**; runtime selected: **True**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed).
- App-specific hold: Existing protected BasicAuth/API only; pagination/central freshness and native lifecycle held
- **Next:** No demonstrated aggregate production defect. Reuse the observed source checks, normalize/register the individual branch, complete exact-head review and obtain independent native/rendered/lifecycle evidence; preserve the App-specific scope below.
- Import allowlist from tested manifest: `internal/apps/homarr/target_traefik.go`. These are historical paths, not a fresh-head diff allowlist.

### Transmission — `transmission`

- Issue [#305](https://github.com/ajnart/selfhost-skills/issues/305) **OPEN**; PR [#337](https://github.com/ajnart/selfhost-skills/pull/337) **OPEN**, draft=True; branch `feat/homarr-transmission-sol`, current GitHub base `feat/homarr-immich-sol`.
- **Live head:** `dc9c2ea0166ed139fc4f799333272bc13ac7f442`. **Actually aggregate-tested source:** `dc9c2ea0166ed139fc4f799333272bc13ac7f442`. **Historical import base:** `795c6d082c8affd213447e0629328fb7ba9d2fe4`.
- Source status: Not final runtime-accepted. Tested leaf `internal/apps/homarr/target_transmission.go`; next candidate leaf `internal/apps/homarr/target_transmission.go`. Native verifier in tested source: **True**.
- Aggregate own Setup: **ok**; Link step: **ok**; runtime selected: **True**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed).
- App-specific hold: Full-control RPC login; harmless owned fixture/native lifecycle held; no whitelist/auth weakening
- **Next:** No demonstrated aggregate production defect. Reuse the observed source checks, normalize/register the individual branch, complete exact-head review and obtain independent native/rendered/lifecycle evidence; preserve the App-specific scope below.
- Import allowlist from tested manifest: `internal/apps/transmission/transmission.go`, `internal/apps/homarr/target_transmission.go`. These are historical paths, not a fresh-head diff allowlist.
- Recorded review/status pointer: https://github.com/ajnart/selfhost-skills/pull/337#issuecomment-6122229434. Read its exact head/scope; old source verdicts do not establish native acceptance.

### Umami — `umami`

- Issue [#308](https://github.com/ajnart/selfhost-skills/issues/308) **OPEN**; PR [#344](https://github.com/ajnart/selfhost-skills/pull/344) **OPEN**, draft=True; branch `feat/homarr-umami-sol`, current GitHub base `feat/homarr-immich-sol`.
- **Live head:** `b6fe06345f84005290cb12e187d1ad983a19b354`. **Actually aggregate-tested source:** `b6fe06345f84005290cb12e187d1ad983a19b354`. **Historical import base:** `d956824f3758e26bb9cdfc262e229eaf67ef187c`.
- Source status: Not final runtime-accepted. Tested leaf `internal/apps/homarr/target_umami.go`; next candidate leaf `internal/apps/homarr/target_umami.go`. Native verifier in tested source: **True**.
- Aggregate own Setup: **ok**; Link step: **ok**; runtime selected: **True**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed).
- App-specific hold: View-only role still owns website writes; real chart/controlled visits/lifecycle held; no shared Stats provider
- **Next:** No demonstrated aggregate production defect. Reuse the observed source checks, normalize/register the individual branch, complete exact-head review and obtain independent native/rendered/lifecycle evidence; preserve the App-specific scope below.
- Import allowlist from tested manifest: `internal/apps/umami/umami.go`, `internal/apps/umami/homarr.go`, `internal/apps/homarr/target_umami.go`. These are historical paths, not a fresh-head diff allowlist.

### Uptime Kuma — `uptime-kuma`

- Issue [#307](https://github.com/ajnart/selfhost-skills/issues/307) **OPEN**; PR [#341](https://github.com/ajnart/selfhost-skills/pull/341) **OPEN**, draft=True; branch `feat/homarr-uptime-kuma-sol`, current GitHub base `feat/homarr-immich-sol`.
- **Live head:** `980e9c8730a1c9acec11a5250ba9e8a589ff9979`. **Actually aggregate-tested source:** `980e9c8730a1c9acec11a5250ba9e8a589ff9979`. **Historical import base:** `d956824f3758e26bb9cdfc262e229eaf67ef187c`.
- Source status: Not final runtime-accepted. Tested leaf `internal/apps/homarr/target_uptime_kuma.go`; next candidate leaf `internal/apps/homarr/target_uptime_kuma.go`. Native verifier in tested source: **True**.
- Aggregate own Setup: **manual**; Link step: **skip**; runtime selected: **True**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed).
- App-specific hold: Explicit existing status-page slug; admin/key modes Manual, no private-page/publication inference
- **Next:** Preserve administrator and intentionally selected existing status-page slug prerequisites. Do not guess/adopt/publish a page or treat an API key as protecting public page JSON.
- Import allowlist from tested manifest: `internal/apps/uptimekuma/uptimekuma.go`, `internal/apps/homarr/target_uptime_kuma.go`. These are historical paths, not a fresh-head diff allowlist.

### What's Up Docker — `wud`

- Issue [#306](https://github.com/ajnart/selfhost-skills/issues/306) **OPEN**; PR [#343](https://github.com/ajnart/selfhost-skills/pull/343) **OPEN**, draft=True; branch `feat/homarr-wud-sol`, current GitHub base `feat/homarr-immich-sol`.
- **Live head:** `00d57bf6610473938789c5b95189b18309cc1973`. **Actually aggregate-tested source:** `00d57bf6610473938789c5b95189b18309cc1973`. **Historical import base:** `d956824f3758e26bb9cdfc262e229eaf67ef187c`.
- Source status: Not final runtime-accepted. Tested leaf `internal/apps/homarr/target_wud.go`; next candidate leaf `internal/apps/homarr/target_wud.go`. Native verifier in tested source: **True**.
- Aggregate own Setup: **not-selected**; Link step: **not selected**; runtime selected: **False**. No independently captured aggregate native/rendered value. Immich's earlier separate proof is not replaced by this run.
- Native dependencies: #262 (closed).
- App-specific hold: Scoped discovery endpoint and registry-outbound approval required; labels are not Project-only authority; inert inventory not real monitoring
- **Next:** Keep excluded until Project-scoped discovery and registry outbound are explicitly scoped; no real Docker socket mounts, host watchers or unfiltered discovery.
- Import allowlist from tested manifest: `internal/apps/wud/wud.go`, `internal/apps/homarr/target_wud.go`. These are historical paths, not a fresh-head diff allowlist.

## Separate common diagnostic PR

[#355](https://github.com/ajnart/selfhost-skills/pull/355) at `aaa37b83e99d116936a4353fedf0a8a61068205d` changes only `internal/apps/homarr/links.go` +3/-0 against frozen `6b82c55f`. Standards/Spec PASS0: https://github.com/ajnart/selfhost-skills/pull/355#issuecomment-6131656990. It preserves the Frigate TLS recovery hint; it does not complete or close #277/#331. Do not import NZBGet aggregate context into its production branch.
