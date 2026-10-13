# Current release status supplement — 13 October 2026

Read this supplement first. It supersedes the older continuation and merge instructions in [LATEST-UPDATE.md](LATEST-UPDATE.md), [HANDOFF.md](HANDOFF.md), [CONTINUE-PROMPT.md](CONTINUE-PROMPT.md) and the tracker ledgers. Their archives, counts and tested heads remain historical records. Documentation PR [#358](https://github.com/ajnart/selfhost-skills/pull/358) carries this update.

The user authorized **source-only delivery now** and deferred outside prerequisites. Runtime acceptance no longer holds those authorized source merges. This decision does not establish all-39 native acceptance or authorize public release, account/provider actions or another runtime attempt.

## Source delivery

At this snapshot, main is `4f07fe977e4e566b5cc112f8faccaa09bf650426`. **All 38 original peer PRs are merged**: the static receipt records 36 successful merges, and the owner separately records Caddy [#315](https://github.com/ajnart/selfhost-skills/pull/315) and PatchMon [#345](https://github.com/ajnart/selfhost-skills/pull/345). Earlier blocked attempts in that receipt were followed by successful merges and are not current holds. The final owner audit records all 38 original PRs merged, their 38 issues closed and all 38 local/remote source heads equal with clean worktrees; the repository remains private.

- Accepted shared SDK changes [#359](https://github.com/ajnart/selfhost-skills/pull/359), [#362](https://github.com/ajnart/selfhost-skills/pull/362), [#366](https://github.com/ajnart/selfhost-skills/pull/366) and [#369](https://github.com/ajnart/selfhost-skills/pull/369) must remain intact. Their helper gating permits exactly `2.5.1` or `2.5.2`; normal compatibility from [#368](https://github.com/ajnart/selfhost-skills/pull/368) remains `>=2.4.1`.
- PatchMon [#345](https://github.com/ajnart/selfhost-skills/pull/345) merged as guarded preparation with an always-Manual boundary: source `6289b76658ab6a1b09fb24efcdeea16ae379679d`, merge `c7fe473c64efe8158ae54517062aa80194c9fe77`. Issue [#291](https://github.com/ajnart/selfhost-skills/issues/291) closed under source delivery; privacy follow-up [#350](https://github.com/ajnart/selfhost-skills/issues/350) stays open. This does not accept native activation.
- Evaluation [#357](https://github.com/ajnart/selfhost-skills/pull/357) merged after all three independent reviews cleared: source `98f7044809faf9287477b782eef8b5b745bf848a`, merge `947cae01e7b04fc9d58fb469509142865efb2deb`. This accepts the correction, not an evaluation score or human viewer acceptance.
- Installer [#313](https://github.com/ajnart/selfhost-skills/pull/313) merged its actual-repository correction after all three independent reviews cleared: source `5570708c5d4842955e4d27be91517250b91a06e7`, merge `ab86faf1c85656c30e691ff433d20035e04ab4ab`. Video [#300](https://github.com/ajnart/selfhost-skills/pull/300) also merged after all three independent reviews cleared: source `3f22f70474d636ecc4e6bf17c8d752394dbb6db2`, merge `0c69f9b3ba2b9df86c2537a37b2524aedcac9f2a`. Its source artifact is delivered; publication prerequisites [#268](https://github.com/ajnart/selfhost-skills/issues/268) remain open.
- Relevant CodeRabbit reviews were requested, but the bot was rate-limited. Completed independent reviews remain separate evidence; no fresh CodeRabbit pass is claimed.

Documentation [#358](https://github.com/ajnart/selfhost-skills/pull/358) publishes this revision. Older Pi coding-agent command fix [#14](https://github.com/ajnart/selfhost-skills/pull/14) is closed as superseded by the Go rewrite; its original `6c65` history is preserved. This supplies no current-release runtime proof. Publication issues [#193](https://github.com/ajnart/selfhost-skills/issues/193), [#194](https://github.com/ajnart/selfhost-skills/issues/194) and [#295](https://github.com/ajnart/selfhost-skills/issues/295) remain open.

Source privacy closure for [#332](https://github.com/ajnart/selfhost-skills/issues/332), [#354](https://github.com/ajnart/selfhost-skills/issues/354) and [#363](https://github.com/ajnart/selfhost-skills/issues/363) accepts implemented corrections only. Remaining runtime proof is explicitly carried by open [#45](https://github.com/ajnart/selfhost-skills/issues/45); implementation issues [#279](https://github.com/ajnart/selfhost-skills/issues/279), [#290](https://github.com/ajnart/selfhost-skills/issues/290) and [#298](https://github.com/ajnart/selfhost-skills/issues/298) closed under authorized source delivery. PatchMon authority issue #350 remains separate and open.

The owner's combined local source gate passed: formatting, build, vet (including the e2e tag), race checks for TUI/Activity/Homarr and shell syntax passed at `0c69f9b3`; the full test suite passed for every package except five WUD fixture failures. Test-only correction [#370](https://github.com/ajnart/selfhost-skills/pull/370) then merged after three independent reviews found no findings: source `1bb911a2eb92ddeac2a6bb0c530a87f9d5212bf7`, merge `4f07fe977e4e566b5cc112f8faccaa09bf650426`. The full WUD package and nine red/green cases passed with that correction; production Go source is identical. This combines the full-suite run with the affected-package correction, without a broad rerun or runtime acceptance.

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

Reconcile the final main/source state. The 38 original peer PRs plus evaluation, installer and video source work are merged; this documentation revision is published through #358. Keep outside prerequisites, native/rendered/lifecycle acceptance, evaluation validity/human feedback, distribution and publication as separate outstanding work. Further runtime needs its approved containment and cleanup scope; this documentation launches none.

Static receipt provenance (SHA-256 of the inspected source files):

- `current-release-source-merges-final.json`: `7b5bc5cdcaa0e2f1e969d725b77d60879de69f59016d625eb183b93f7e46fe50` (17:09 UTC; 36 successful peers).
- `current-release-human-prerequisite-holds.json`: `3d71d0135cbb9f96383ef7ae655ac06fcc8efbdb94bc5010b85ee220211851dc`.
- `current-release-homarr-image-252.json`: `ad22b6718acd172fe1a6816a6b5387faa2622d2cb7efa34ad925d9719e8ac25e`.

Other later statuses above are attributed to the release owner. Raw runtime, browser and private files were not read or transferred for this supplement. Receipt hashes identify snapshots and do not establish acceptance.
