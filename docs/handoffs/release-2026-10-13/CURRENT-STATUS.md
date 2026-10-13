# Current release status supplement — 13 October 2026

Read this supplement first. It supersedes the older continuation and merge instructions in [LATEST-UPDATE.md](LATEST-UPDATE.md), [HANDOFF.md](HANDOFF.md), [CONTINUE-PROMPT.md](CONTINUE-PROMPT.md) and the tracker ledgers. Their archives, counts and tested heads remain historical records. Documentation PR [#358](https://github.com/ajnart/selfhost-skills/pull/358) carries this update.

The user authorized **source-only delivery now** and deferred outside prerequisites. Runtime acceptance no longer holds those authorized source merges. This decision does not establish all-39 native acceptance or authorize public release, account/provider actions or another runtime attempt.

## Source delivery

At this snapshot, main is `6c0482ead7807b8ed146cd1574924a123c822ddb`. **37 of the 38 original peer PRs are merged**: the static receipt records 36 successful merges, and the owner separately records Caddy [#315](https://github.com/ajnart/selfhost-skills/pull/315). Earlier blocked attempts in that receipt were followed by successful merges and are not current holds.

- Accepted shared SDK changes [#359](https://github.com/ajnart/selfhost-skills/pull/359), [#362](https://github.com/ajnart/selfhost-skills/pull/362), [#366](https://github.com/ajnart/selfhost-skills/pull/366) and [#369](https://github.com/ajnart/selfhost-skills/pull/369) must remain intact. Their helper gating permits exactly `2.5.1` or `2.5.2`; normal compatibility from [#368](https://github.com/ajnart/selfhost-skills/pull/368) remains `>=2.4.1`.
- The remaining original peer, PatchMon [#345](https://github.com/ajnart/selfhost-skills/pull/345), is pending its safe preparation / always-Manual source delivery. Privacy follow-up [#350](https://github.com/ajnart/selfhost-skills/issues/350) stays open; safe preparation does not accept native activation.
- Evaluation [#357](https://github.com/ajnart/selfhost-skills/pull/357), corrected head `977d6ec`, has all three independent reviews clear and is ready for its authorized source merge. This accepts the correction, not an evaluation score or human viewer acceptance.
- Installer [#313](https://github.com/ajnart/selfhost-skills/pull/313), actual-repository correction `6c209`, has source reviews ready. Video [#300](https://github.com/ajnart/selfhost-skills/pull/300) is receiving its actual-repository correction. Their remaining source merges are pending at this snapshot.
- Relevant CodeRabbit reviews were requested, but the bot was rate-limited. Completed independent reviews remain separate evidence; no fresh CodeRabbit pass is claimed.

Refresh exact PR heads and merge outcomes before calling source delivery complete. Publication issues [#193](https://github.com/ajnart/selfhost-skills/issues/193), [#194](https://github.com/ajnart/selfhost-skills/issues/194) and [#295](https://github.com/ajnart/selfhost-skills/issues/295) remain open.

## Homarr source, image and runtime proof

Upstream privacy fix [#7170](https://github.com/homarr-labs/homarr/pull/7170) merged at `62c851` and shipped in [2.5.1](https://github.com/homarr-labs/homarr/releases/tag/v2.5.1). The owner's three reviews, focused tests, CodeRabbit and CI results concern that upstream change.

[Homarr 2.5.2](https://github.com/homarr-labs/homarr/releases/tag/v2.5.2) is the newer proof target. The static registry receipt confirms `v2.5.2` and `latest` resolve to the same index:

- Index: `sha256:025471efe0735b6bb89953ea4e141c984a171c1781bc8ca404163d3c26d0e26d`.
- Linux/amd64 manifest: `sha256:4537fc05c5d920761a1f7d683654f2a8a84c264b70178d5559a034212755ed9c`.
- Linux/arm64 manifest: `sha256:eaf456ab4e8f15d80e3fa3801d4983c9953d04cd5ce49fc8e42d9c8c80ffb163`.
- Both images declare OCI revision `ebbe134c5e9fa3400266fc8c0199ff54e903634b` and OCI version `main`.

The owner verified actual authenticated **API 2.5.2** in the newest bounded three-peer fixture after its viewport correction. App geometry/rendering was still blocked by the tour; owned cleanup passed. API authentication and cleanup are bounded observations, not native/rendered/lifecycle acceptance for all peers. The old aggregate and later complete-all-39 runtime claims remain unaccepted. The earlier Immich reference retains only its recorded source/data scope.

## Human-deferred external prerequisites

At 14:54 UTC the user deferred these 11 prerequisites with: “I don't have this at the moment. Just merge or whatever is useful and then the rest will be done later.” The recorded PR comments preserve that decision. Deferred evidence stays pending after a source merge; missing credentials, hardware or discovery access are not functional passes.

| Peer / recorded comment | Deferred prerequisite |
| --- | --- |
| [gluetun #327](https://github.com/ajnart/selfhost-skills/pull/327#issuecomment-6148393897) | VPN provider credentials and a real tunnel with fail-closed verification |
| [sabnzbd #334](https://github.com/ajnart/selfhost-skills/pull/334#issuecomment-6148394315) | a real Usenet provider account |
| [nzbget #335](https://github.com/ajnart/selfhost-skills/pull/335#issuecomment-6148394696) | a real Usenet provider account |
| [slskd #342](https://github.com/ajnart/selfhost-skills/pull/342#issuecomment-6148395116) | a real Soulseek account/provider |
| [plex #348](https://github.com/ajnart/selfhost-skills/pull/348#issuecomment-6148395517) | Plex account ownership and claim |
| [frigate #331](https://github.com/ajnart/selfhost-skills/pull/331#issuecomment-6148395898) | an authorized Frigate camera |
| [home-assistant #333](https://github.com/ajnart/selfhost-skills/pull/333#issuecomment-6148396350) | a real Home Assistant token and entities |
| [peanut #347](https://github.com/ajnart/selfhost-skills/pull/347#issuecomment-6148396764) | a real NUT/UPS device |
| [tdarr #349](https://github.com/ajnart/selfhost-skills/pull/349#issuecomment-6148397079) | a Tdarr worker |
| [tracearr #346](https://github.com/ajnart/selfhost-skills/pull/346#issuecomment-6148397359) | an attached Tracearr media server |
| [wud #343](https://github.com/ajnart/selfhost-skills/pull/343#issuecomment-6148397631) | approved scoped WUD Docker discovery access |

## Continuation

Finish the authorized remaining source merges and reconcile the final main/source state. Keep outside prerequisites, native/rendered/lifecycle acceptance, evaluation validity/human feedback, distribution and publication as separate outstanding work. Further runtime needs its approved containment and cleanup scope; this documentation launches none.

Static receipt provenance (SHA-256 of the inspected source files):

- `current-release-source-merges-final.json`: `7b5bc5cdcaa0e2f1e969d725b77d60879de69f59016d625eb183b93f7e46fe50` (17:09 UTC; 36 successful peers).
- `current-release-human-prerequisite-holds.json`: `3d71d0135cbb9f96383ef7ae655ac06fcc8efbdb94bc5010b85ee220211851dc`.
- `current-release-homarr-image-252.json`: `ad22b6718acd172fe1a6816a6b5387faa2622d2cb7efa34ad925d9719e8ac25e`.

Other later statuses above are attributed to the release owner. Raw runtime, browser and private files were not read or transferred for this supplement. Receipt hashes identify snapshots and do not establish acceptance.
