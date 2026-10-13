# Current release status supplement — 13 October 2026

This source-status snapshot supplements documentation PR [#358](https://github.com/ajnart/selfhost-skills/pull/358), parent `80a8e574f19a35e12bc02c1b2b8480b21407b4a9`. Read it before [LATEST-UPDATE.md](LATEST-UPDATE.md) and the older handoff. Their archives, ledgers, tracker counts and tested heads remain historical records. This supplement uses static source/registry receipts and the release owner's reported review/merge results; it adds no independent runtime acceptance.

## Completed source work

- Upstream Homarr [#7170](https://github.com/homarr-labs/homarr/pull/7170) merged at `62c851` and shipped in [2.5.1](https://github.com/homarr-labs/homarr/releases/tag/v2.5.1). The owner records three reviews, 68 passing focused tests, CodeRabbit and CI passes. These validate that upstream change, not every self-host peer.
- Latest policy [#364](https://github.com/ajnart/selfhost-skills/pull/364) merged at `95031`. Stats SDK [#359](https://github.com/ajnart/selfhost-skills/pull/359) merged at `8cbc18db`; Downloads SDK [#362](https://github.com/ajnart/selfhost-skills/pull/362) merged at `69c109001b2edd90c42d192dde204e26bb9d2375` after the full local gate.
- The 15:11 UTC forward-merge audit records all **38 original peer branches** clean, with successful affected-package builds and unchanged peer App/descriptor files after reconciliation onto shared SDK main `69c109001b2edd90c42d192dde204e26bb9d2375`. It also records `links.go` differences for Navidrome, SABnzbd and NZBGet; common-code equality is not established for those branches.
- Those audited new peer heads were **not yet pushed** at this snapshot. Local forward merges are not original peer PR merges, current remote-head proof or native acceptance. Reconcile exact local/remote heads and required source reviews before publication.

## Homarr 2.5.2 changed the proof target

Homarr [2.5.2](https://github.com/homarr-labs/homarr/releases/tag/v2.5.2) appeared during proof. The owner reports the inspected source/API contracts unchanged. The registry receipt confirms `v2.5.2` and `latest` resolve to the same index:

- Index: `sha256:025471efe0735b6bb89953ea4e141c984a171c1781bc8ca404163d3c26d0e26d`.
- Linux/amd64 manifest: `sha256:4537fc05c5d920761a1f7d683654f2a8a84c264b70178d5559a034212755ed9c`.
- Linux/arm64 manifest: `sha256:eaf456ab4e8f15d80e3fa3801d4983c9953d04cd5ce49fc8e42d9c8c80ffb163`.
- Both platform images declare OCI revision `ebbe134c5e9fa3400266fc8c0199ff54e903634b`, OCI version `main`.

Compatibility source `1242243` is publishing at this snapshot. Its publication and actual authenticated **API 2.5.2 remain pending**. Registry metadata and matching source contracts do not prove the running API, rendered values or lifecycle behavior. Refresh the publication state and retain distinct source, index, platform, OCI and authenticated API pins before continuing proof.

## Human-deferred external prerequisites

Recorded decision at 14:54 UTC:

> I don't have this at the moment. Just merge or whatever is useful and then the rest will be done later.

The owner recorded these 11 prerequisites as deferred, with published PR comments. This defers the missing external evidence; it supplies no credentials, hardware, discovery access or functional acceptance, and does not waive privacy or lifecycle gates.

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

## Remaining acceptance and continuation

Browser/session and preservation/lifecycle acceptance remain unresolved. Do not claim all-39 proof, merge the original peers solely from these source results or turn prerequisite holds into passes. The earlier bounded Immich reference remains scoped to its recorded source/data; it does not accept the new image or the other 38 peers. Existing evaluation, distribution and publication gates remain separate.

The root custodian must reconcile the final image/API/publication state, common-code differences, original peer heads and scoped reviews before publishing this update. Any further runtime uses its separately approved containment and cleanup plan; this document initiates no runtime, account/provider, browser or publication action.

Static receipt provenance (SHA-256 of the source files at this snapshot):

- `current-release-homarr-image-252.json`: `ad22b6718acd172fe1a6816a6b5387faa2622d2cb7efa34ad925d9719e8ac25e`.
- `current-release-human-prerequisite-holds.json`: `3d71d0135cbb9f96383ef7ae655ac06fcc8efbdb94bc5010b85ee220211851dc`.
- `current-release-forward-merge-source-audit.json`: `29b8894b9827cfba780a77b1442761fafe8350899133eb510c9dce22eef27ae9`.

These source receipts were inspected locally; raw runtime, browser and private files were not read or transferred. The receipt hashes identify the snapshot and do not establish acceptance.
