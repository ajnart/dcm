# Latest update: concurrent work discovered at publication

**Read this before the older queue/plan.** The original snapshot was captured around 05:13–05:44 UTC on 13 October 2026. Final readback discovered independently opened #356/#357 and documentation #358. There are now **46 open / 128 total PRs**. The original 43/125 remain unchanged; no original PR closed, merged, retargeted or changed head in that readback.

This update is **owner-reported and source-backed**, not a new independent runtime/approval audit. We read pinned PR bodies/source documentation, fetched their refs and completed file listings. Private runtime/model attempts and the other owner's approval were not inspected or transferred. This handoff launched no operation to reproduce their results.

## Latest branch map

```text
main, captured ab4c92c4
  original 13 main-based PRs
  #356 feat/current-release-completion          independent combined draft
  #358 docs/release-handoff                    documentation; start here

merged #309 feat/homarr-immich-sol
  original 30 sibling peer PRs                 unchanged original heads/bases

#259 test/skill-eval-harness, 3558e581
  #357 feat/skill-eval-invalidation, ccd742dc    real stacked source fix
```

The 30 siblings are still not a 30-PR chain. There is now a genuine **#259 → #357** stack. [PR-STACKS.md](PR-STACKS.md#concurrent-additions-at-final-publication) has the three additional dossiers; [PR-HISTORY.md](PR-HISTORY.md#concurrent-additions) accounts for all 128 PRs across both snapshots.

## #356: newer candidate, not an original-peer rewrite

Draft [#356](https://github.com/ajnart/selfhost-skills/pull/356), branch **`feat/current-release-completion`**, exact head **`f245f7872d891ef51d7990cbebe8a30692cdcd73`**, base main **`ab4c92c428a2c2c9ab284a83f79f726418c1498b`**; 152 changed files.

Its [pinned owner handoff](references/concurrent-release-handoff.pr-356.md) reports:

- Reconstruction from preserved `f0b06ef7`, comparing current peer heads and including later Aria2/Audiobookshelf/NZBGet/Frigate work. New AdGuard/Paperless semantic verifiers, observed Slskd/Tracearr version forms, referenced-App preservation, bounded owned Stats partitions and a confined proof helper.
- Fresh Linux/amd64 install of 37 admissible peers plus Homarr: **55 services, 29,248 MiB, 15.95 CPUs, 512 PIDs/service**, loopback ports; Gluetun/WUD excluded. Initial exit 2. Bounded retries reportedly verified version repairs and repaired Homarr/Tdarr's referenced-App foreign-key failure. Final own Setup: **27 complete, ten Manual, one incomplete (Speedtest)**; repaired Homarr retry had zero failed steps.
- **25 saved integrations / 24 reviewed native/shared widgets**, Homarr API 2.4.1, AdGuard/Paperless native verification/freshness, useful native data and controlled empty states. One interrupted generated Tdarr duplicate remains retained conservatively; no unique-tile claim. This is not all-39 both-order/preservation/lifecycle acceptance.
- Full Go/build/vet/focused/race checks and independent Standards/Spec source passes; closed browser and zero owned containers/networks, data/images retained. Actual runtime receipts remain on another machine, **not transported or independently checked here**.

### What is superseded

`HANDOFF.md` and the old aggregate receipts remain immutable evidence of `aggregate-5iy1oywq`. Its missing diagnostics/nil verifiers are still true of **historical tested source and unchanged original peer PRs**, not a reason to repeat newer work. AdGuard/Paperless completions are on #356, not #311/#312. Original peer heads and APP-QUEUE source status remain unchanged.

Newly reported candidate version repairs, usable Immich/Paperless/AdGuard rendering and native data must be reconciled with that owner. Do not carry the old five failures forward as proven current-candidate failures, or invent old-run causality from a later run. Latest Home Assistant/NZBGet/provider/Manual outcomes need per-App receipts, not guesses from totals.

The previous orchestration route was evaluation assembly followed by original individual PR completion, **not a combined production PR**. #356 is an independent owner's combined draft. This handoff did not authorize merging it or replacing 38 peers with it. Ask the maintainer/custodian which integration route is intended; compare common-source/registration/ownership and exact review coverage first. Preserve all original PRs and both candidates.

The newer 55-service Linux scope differs from the historical 51-container/27-GiB/15.75-CPU caps. Its own authorization was not inspected here. Reconcile actual owner approval before reproducing/extending anything; neither old consent nor a PR body permits operating another machine.

## #357: real stacked fix; judging remains incomplete

Draft [#357](https://github.com/ajnart/selfhost-skills/pull/357), branch **`feat/skill-eval-invalidation`**, exact head **`ccd742dc2e01c0388873eaa570ef8ce7ee40a220`**, base **`test/skill-eval-harness` / `3558e581856ae12bf803c6052384ee23ac2f93a2`**.

Three files change: `evals/self-host/judge.py`, `evals/self-host/tests/test_grading.py`, `evals/self-host/PROGRESS.md`. It removes stale `benchmark.json`/`review.html` before judging and on failure while preserving execution/raw diagnostics. Owner reports three focused existing fake-Claude CLI regressions and independent source passes.

It is a child of #259, not a main-based harness replacement. Reconcile exact parent/child heads and source merge direction; preserve histories. Source invalidation repair does not finish the model gate. The reported 54 valid conversations still need complete quota-free blind/Recap judging, aggregation/viewer and human feedback. Coordinate **judgment-only** recovery under separate bounded authorization; preserve failed originals and private raw attempts.

## Latest remaining boundaries

- **Speedtest shared-host AppArmor:** owner reports enforcing `php_fpm` policy excludes image `/etc/php85/`; a reviewed but unapplied narrow read proposal exists. Shared-profile apply/reload is outside one-Project ownership; maintainer choice remains pending. No policy was changed, and the proposal does not prove startup. Do not apply it from this handoff.
- **Privacy/authority and prerequisites:** #332/#350/#354, trusted HTTPS, accounts/providers and hardware remain held. Zero-query AdGuard data does not certify the upstream percentage formula.
- **Acceptance and merge route:** individual production integration, both orders and full preservation/lifecycle remain incomplete. New smoke is not 39 closed tickets. Settle #356 versus original-PR reconciliation with the maintainer.
- **Evaluation:** #357 only fixes stale derived artifacts; full #259 judgments/viewer/human evidence remains outstanding.
- **Distribution/video:** source remains private and intended repository unresolved as reported. #313/#300/#193/#194/#295/#268 remain gated. Script HTTPS is not anonymous binary installation/update or publication approval.

**Next:** start on `docs/release-handoff`, reconcile #356/#357 owners/pins, then return a source-only plan and smallest approval questions. Read the old queue as original-branch history, not instructions to duplicate or undo later work. [CONTINUE-PROMPT.md](CONTINUE-PROMPT.md) states this precedence.
