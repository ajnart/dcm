# Current-release handoff — 13 October 2026

This edition records a fresh Linux CLI install and repairs on
`feat/current-release-completion`, based on main
`ab4c92c428a2c2c9ab284a83f79f726418c1498b`. The current release covers the
39 Catalog Homarr peers; the 41 proposed external kinds remain future work.

Published draft candidates: [integration proof and repairs #356](https://github.com/ajnart/selfhost-skills/pull/356)
and [eval invalidation fix #357](https://github.com/ajnart/selfhost-skills/pull/357).
Both pushed heads and PR bases were verified. Desktop artifact attachment calls
did not return, so their app-side attachment state is unconfirmed.

## Source and ownership

The production candidate was reconstructed from preserved checkpoint
`f0b06ef7fa7b49263e5217d0d7853015886d9e86`. Every peer App and descriptor
was compared with its current pushed PR head; latest Aria2/Audiobookshelf/NZBGet
corrections and the Frigate recovery hint were included. The registry has 48
Links: the original nine plus the 39 current-release peers.

All 42 open current-release PRs received independent source reviews. Their
original heads, draft states, bases and histories were preserved. No original
peer PR was merged, retargeted or force-pushed. The old `feat/improve-speed`
checkout and its unrelated dirty files remain unchanged.

## Single install and bounded retries

One fresh production `cli.Run` install selected 37 admissible peers plus
Homarr. Gluetun lacked real VPN credentials/tunnel-safety evidence; WUD lacked
an approved Docker TLS endpoint/CA. No placeholder credentials replaced these
prerequisites. The pass pulled 53 distinct images and created 55 services:
54 running containers and one successful initialization container.

All published ports were verified on loopback. Actual limits were checked:
29,248 MiB aggregate memory, 15.95 CPUs and 512 PIDs per service. No other
Project, host resolver, Docker socket, engine setting, media library or private
browser profile was changed. No download, archive, speed measurement or
hardware job was initiated.

The initial install took 1,031.36 seconds and exited 2: 26 Apps completed
Setup, nine reached Manual steps, and three were incomplete. The three failures
were Slskd's `0.26.1.0` version, Tracearr's `v2.6.0` version and Speedtest's
PHP-FPM configuration access.

A targeted same-Project retry verified the two version repairs, then exposed
Homarr's Tdarr duplicate-App cleanup failure. Tdarr uses browser port 8265 and
native API port 8266; deletion of an integration-referenced App failed with a
foreign-key error. The following Homarr-only repair retry exited 3 (Manual)
with **zero failed steps**. Final observed Setup was **27 complete, ten Manual,
one incomplete**; Speedtest was the remaining incomplete App.

## Homarr evidence

Authenticated Homarr API version was 2.4.1. Its resolved linux/amd64 image has
OCI revision `3d4150e59f600876b7e308f857b2f21572b75348`, OCI version `main`,
and index digest
`sha256:ee67a5e856c051c4e114418a54b89a3fc3cb5507d0689e5cb89c790305c549cd`.
These identities are distinct from the API version and tagged research baseline.

The pass saved 25 integrations; 24 native/shared widgets were independently
reviewed in the browser. Observations included Immich's one user/empty library,
AdGuard's 184,348 blocked domains, actual CPU/RAM values, healthy Traefik
resources, and legitimate empty downloader/audio/Paperless states.
Paperless's null inbox was accompanied by explicit absent-inbox-tag metadata.
The repaired AdGuard and Paperless Links passed authenticated native verification
and advancing Stats refreshes. Paperless added five supported shared metrics:
71 existing Stats entries became 76, all within the 100-entry limit.

All 25 original integration IDs survived. The first failed retry replaced one
managed Tdarr placement before encountering its foreign-key error. The repair
preserved all 70 post-failure widget IDs and restored a canonical placement,
leaving 71 items. An interrupted generated Tdarr duplicate remains retained
conservatively: generic App item IDs were not persisted, so automatic removal
cannot distinguish a person-owned placement. This is not a unique-tile claim.

Source regressions additionally verify stable IDs after customized ping
Addresses, retained tiles with stale ownership, bounded Stats partitions above
100 entries, and retry/remove/reinstall preservation. The single live pass does
not establish all 39 peer lifecycle, populated-media, account, physical hardware
or both-installation-order acceptance gates.

## Repairs and checks

- Accept only the observed pinned Slskd/Tracearr version forms; unsupported
  versions remain rejected. Missing provider/media-server prerequisites remain Manual.
- Add meaningful AdGuard/Paperless native verifiers and explicit data/schema checks.
- Partition only owned Stats into at most 100 entries per item, preserving
  custom entries, bindings and unrelated resources.
- Stop Gluetun's privacy-held Link before mutation and persist correct
  Gluetun/PatchMon/Frigate recovery instructions.
- Preserve integration-referenced App records, custom ping/name/icon fields,
  and retained user tiles through duplicate/interrupted reconciliation.
- Confine proof-helper resumed operations to a canonical private current-user
  fixture and its derived Compose name; stop authenticated diagnostic redirects.
- Fix isolated installer/catalog fixtures to represent required API/tool contracts.

The full Go suite, build, vet, e2e-tag vet without runtime, shell syntax and
focused regressions pass. Race checks pass for TUI, Activity, Homarr and Warrior.
The independent Standards and Spec reviews cleared their findings after repairs.
No broad Docker or installer runtime test followed the single install.

The separate eval fix branch `feat/skill-eval-invalidation`, based on PR #259
head `3558e581856ae12bf803c6052384ee23ac2f93a2`, invalidates stale
`benchmark.json`/`review.html` before judging. Three existing fake-Claude CLI
regressions pass. Historical raw conversations, judgments and scores were not
modified. The recorded 54 valid conversations still need complete quota-free
judgments, aggregation/viewer and human review; their private attempts were not
accessed here.

## Remaining release boundaries

Speedtest's actual PHP-FPM child enters an enforcing shared host `php_fpm`
profile, while shell/PHP CLI can read the same configuration. The profile's PHP
abstraction permits `/etc/php{,5,7,8}/**`, excluding the image's `/etc/php85/`
layout. A reviewed, unapplied first-path proposal grants only
`/etc/php85/php-fpm.conf r,`. Applying/reloading this shared profile is outside
the one-Project mutation boundary; the requested host-scope choice is pending.
The proposal alone does not prove subsequent startup.

Account/hardware/TLS/credential-safety Manual steps remain explicit. Upstream
privacy boundaries #332, #350 and #354 were not bypassed. AdGuard's upstream
blocked-percentage formula is not certified by zero-query data.

The anonymous landing page and installer at `https://selfhost.ajnart.dev` return
200. Source remains private at `ajnart/selfhost-skills`; `ajnart/selfhost`
returns 404. PRs #313/#300 remain gated candidates: public script transport is
not working anonymous binary installation/self-update or video publication.
No repository visibility, release assets or public source were changed.

## Evidence and reproduction

Credential-free local evidence is at
`/tmp/self-host-mega-20261013-3109467286/`: immutable `first-pass/`,
`first-pass-report.json`, `image-identities.json`, named diagnostic projections,
separate retry events/status, native observations and `home-final.png`.
Raw logs, Project credentials/configuration, data and browser auth are excluded
from Git. Local evidence paths are machine-specific, not transported runtime input.

The owned browser was closed and scoped Compose Down completed. Final readback
in `cleanup-readback.json` confirms zero owned containers and zero owned networks;
all 53 used images, private Project data and readonly evidence remain. The live
preview has stopped. No volumes, data or images were deleted, and no shared host
policy was changed. The pending Speedtest host choice remains open.

[The proof helper](../tools/release-proof/README.md) documents rebuilding and
an explicitly approved fresh pass. Preserve all archived checkpoints and build
future candidates on new branches. Container/HTTP/saved-connection observations
remain distinct from native, rendered, lifecycle and release acceptance.

## Reviewed PR inventory

Heads below are the exact remote snapshot used by this review; source fixes are
on the completion branches rather than rewriting these original PRs.

| PR | Reviewed head | Scope |
| --- | --- | --- |
| [#259](https://github.com/ajnart/selfhost-skills/pull/259) | `3558e581856ae12bf803c6052384ee23ac2f93a2` | test(skill): isolate and verify the skill evaluation harness |
| [#300](https://github.com/ajnart/selfhost-skills/pull/300) | `1a82599509947e0c6a6c300654a9bed1d6f7ab88` | feat(video): use canonical release domain in showreel |
| [#310](https://github.com/ajnart/selfhost-skills/pull/310) | `895fb166f652181745d188934bf70d8d9479bea6` | feat(audiobookshelf): stage Homarr credentials and Audio Stats descriptor |
| [#311](https://github.com/ajnart/selfhost-skills/pull/311) | `6731356c57d130e503ab24f28aa5cb7825355b2f` | fix(adguard): verify Setup credentials and prepare native Homarr data |
| [#312](https://github.com/ajnart/selfhost-skills/pull/312) | `df16f7231e9299e9fb6c5975da6669f398f6ce30` | feat(paperless-ngx): provision verified read-only Homarr credentials |
| [#313](https://github.com/ajnart/selfhost-skills/pull/313) | `599bdafc8749ad69d1ffc1518f0239cf73e62aca` | feat(release): deploy gated installer site on selfhost.ajnart.dev |
| [#315](https://github.com/ajnart/selfhost-skills/pull/315) | `259033989ef44589658a3adbc3c4505175d41ae0` | feat(homarr): add Caddy upstream statistics descriptor |
| [#317](https://github.com/ajnart/selfhost-skills/pull/317) | `71e5c0fc1afd1732a38b299137f0001ed99a19d3` | feat(aria2): verify Homarr RPC prerequisites |
| [#318](https://github.com/ajnart/selfhost-skills/pull/318) | `e8ea969a9d3a2f07ca9ba626996a6207d0cd087d` | feat(homarr): add Lidarr calendar and statistics descriptor |
| [#319](https://github.com/ajnart/selfhost-skills/pull/319) | `e0577f082b8b5d36bfa65a4dc76827e7ebb97c98` | feat(homarr): add scoped Dashdot CPU and RAM Link |
| [#320](https://github.com/ajnart/selfhost-skills/pull/320) | `ed73c7651ca5372f5ec9a880e9d66ddf1fca9093` | feat(bazarr): verify API credentials and native Homarr widgets |
| [#321](https://github.com/ajnart/selfhost-skills/pull/321) | `b8ab54070762845e7720e7c16322a6611dc82eaa` | feat(homarr): verify Gatus local readiness and native Stats |
| [#322](https://github.com/ajnart/selfhost-skills/pull/322) | `eed53d89603f1d89aaa4dff2ff9c5f1a94d86497` | feat(emby): prepare Homarr credentials and native widgets |
| [#323](https://github.com/ajnart/selfhost-skills/pull/323) | `35979a24463fc97e0e4ccd1bb45ce7eb870dca29` | feat(homarr): verify Warrior workers and declare native widgets |
| [#324](https://github.com/ajnart/selfhost-skills/pull/324) | `0b3155367e6423acb3450ccc19021bace705e7a0` | feat(deluge): verify Web credentials and native Homarr downloads |
| [#325](https://github.com/ajnart/selfhost-skills/pull/325) | `384111f936710bf75cb18707b8d64274772903d7` | feat(homarr): prepare scoped Gotify notifications Link |
| [#326](https://github.com/ajnart/selfhost-skills/pull/326) | `e68ea343cca6fdb8097d47f0f981df11d38f48dd` | feat(homarr): add verified Glances resources Link |
| [#327](https://github.com/ajnart/selfhost-skills/pull/327) | `7d70c832c426eb1485ef8f072d461a621cfcabb1` | feat(gluetun): stage guarded Homarr target and separate readiness |
| [#328](https://github.com/ajnart/selfhost-skills/pull/328) | `76ff8634ddaa70ce2f5bb757bc0427f3dcf8e72c` | feat(linkwarden): prepare owned Homarr statistics access |
| [#329](https://github.com/ajnart/selfhost-skills/pull/329) | `87a69b36ab077b5683b47932935f49a5fa41280b` | feat(homarr): add scoped Netdata statistics Link |
| [#330](https://github.com/ajnart/selfhost-skills/pull/330) | `f343928008783ce6cc9b2e58f82ed6e378382631` | feat(navidrome): verify native Homarr music data |
| [#331](https://github.com/ajnart/selfhost-skills/pull/331) | `0d06cdf5133459657af2f6a126d8bb12fa3235c2` | feat(homarr): prepare authenticated Frigate Stats Link |
| [#333](https://github.com/ajnart/selfhost-skills/pull/333) | `2ea747b1ee94f8a50c8741230b245aedb9cd12b4` | feat(home-assistant): add read-only Homarr token and entity slice |
| [#334](https://github.com/ajnart/selfhost-skills/pull/334) | `908931b24cf9c013768fce1a94c64e96aa37f109` | feat(homarr): verify SABnzbd credentials and native widgets |
| [#335](https://github.com/ajnart/selfhost-skills/pull/335) | `d03616aac0a2aa902097cbd7062d99abf514f891` | feat(nzbget): prepare restricted Homarr Downloads access |
| [#336](https://github.com/ajnart/selfhost-skills/pull/336) | `2231ee7542a1fe6082ec8f0a568ebb2ffa2dd17b` | feat(homarr): add verified Prometheus target statistics |
| [#337](https://github.com/ajnart/selfhost-skills/pull/337) | `dc9c2ea0166ed139fc4f799333272bc13ac7f442` | feat(homarr): verify Transmission RPC and native download widgets |
| [#338](https://github.com/ajnart/selfhost-skills/pull/338) | `aafb8c4e71cc8d6dabb27ee4e3a8d2a34c9cd631` | feat(homarr): prepare owned Technitium DNS statistics |
| [#339](https://github.com/ajnart/selfhost-skills/pull/339) | `64be8d4ba38fb0e6f92e7f7d00d560603da37f87` | feat(pihole): prepare verified Homarr application-password statistics |
| [#340](https://github.com/ajnart/selfhost-skills/pull/340) | `21f74e29d9c7e75da04c0410a2fcad717cc2f75f` | feat(nextcloud): prepare credentials and native Homarr widgets |
| [#341](https://github.com/ajnart/selfhost-skills/pull/341) | `980e9c8730a1c9acec11a5250ba9e8a589ff9979` | feat(homarr): add explicit Uptime Kuma status-page Link |
| [#342](https://github.com/ajnart/selfhost-skills/pull/342) | `2cf210a6700b6a6d2a39fb57bb511ff17d6cec96` | feat(homarr): prepare Slskd downloads and provider readiness |
| [#343](https://github.com/ajnart/selfhost-skills/pull/343) | `00d57bf6610473938789c5b95189b18309cc1973` | feat(homarr): add authenticated WUD update widgets |
| [#344](https://github.com/ajnart/selfhost-skills/pull/344) | `b6fe06345f84005290cb12e187d1ad983a19b354` | feat(homarr): prepare owned Umami analytics connection |
| [#345](https://github.com/ajnart/selfhost-skills/pull/345) | `05f68f3bd937bdec2bb0efd32c0e171c08a794c2` | feat(homarr): prepare PatchMon Link with read-only credential hold |
| [#346](https://github.com/ajnart/selfhost-skills/pull/346) | `ab4ac17a94c0ee42807e8cf6bc16c5f5241e3c6f` | feat(homarr): add owned Tracearr connection slice |
| [#347](https://github.com/ajnart/selfhost-skills/pull/347) | `fc5583b0f5b45e137464c06e67213e0f7ff6e75d` | feat(homarr): add guarded PeaNUT UPS and native Stats descriptor |
| [#348](https://github.com/ajnart/selfhost-skills/pull/348) | `8db89ddd50574153405c0d1a60dee18e0dfa16d0` | feat(homarr): verified Plex credential and native widget slice |
| [#349](https://github.com/ajnart/selfhost-skills/pull/349) | `21d3624b86411b9011a4e9ad3cacc94b60174279` | feat(tdarr): prepare authenticated native Homarr monitoring |
| [#351](https://github.com/ajnart/selfhost-skills/pull/351) | `29659099e33da9bead3aad2414f8f3965efafc27` | feat(speedtest-tracker): prepare scoped Homarr results link |
| [#352](https://github.com/ajnart/selfhost-skills/pull/352) | `3ecd50a434613b649e072cd33917d22e4d780e93` | feat(homarr): add protected Traefik native Link descriptor |
| [#355](https://github.com/ajnart/selfhost-skills/pull/355) | `aaa37b83e99d116936a4353fedf0a8a61068205d` | fix(homarr): preserve Frigate TLS recovery hint |
