---
name: selfhost-media
description: Media pack adapter. Use only when directly requested or delegated by explicit selfhost-setup or selfhost-upkeep to set up, synchronize, and verify the exact private owned-content stack of Seerr, Sonarr, Radarr, Prowlarr, qBittorrent, Jellyfin, and Homarr.
license: Apache-2.0; see LICENSE.txt
compatibility: Planning requires Bun 1.4.0 or newer and Bash; approved harness runs require Docker Compose and browser evidence requires agent-browser.
---

# Self-hosted media

Proceed only after a direct user request for this exact harness or delegation
from an explicitly invoked `selfhost-setup` or `selfhost-upkeep` workflow. A
generic personal-media plan is not authority to install this bundle.

If a verified standalone `self-host` CLI is already installed, use its
deterministic path for this exact seven-service pack: run `self-host doctor`,
show `self-host plan netflix --project-root PROJECT`, and get approval to
create local config. Run `self-host config init --project-root PROJECT --profile
media --run-id RUN_ID --username USERNAME` (the owner-only credential handoff
is on by default; add `--credential-handoff no` if the user opts out), then
`self-host up --project-root PROJECT`. The default uses all-interface short
port mappings and needs verified private firewall scope. On a public host
without that proof, explicitly select `--media-bind-mode host-only` during
`config init`; all seven ports then bind to 127.0.0.1 and other devices need a
separate approved private route. Show the selected ports, exposure, image policy, and approval
digest. Await exact approval before `self-host up
--project-root PROJECT --approve DIGEST --firewall-scope VERIFIED_SCOPE`, with
`VERIFIED_SCOPE` set to `router-private` or `docker-aware-private` only after
checking the actual policy. Omit `--firewall-scope` for host-only mode. The CLI
records operator confirmation, not firewall proof. Use `self-host resume --project-root
PROJECT --approve DIGEST --from STAGE` only after targeted repair. The
CLI needs no AI or browser, is not installed by this skill, and is not yet
published to npm. Never suggest `npx @ajnart/selfhost` as an available release.
For an isolated or preplanned range, set `--media-port-start FIRST` on
`config init`. It reserves exactly seven consecutive ports and fails on a
collision. A household bundle uses `bundle init --media-port-start FIRST`
with those seven ports in its fresh host inspection.
After a private HTTPS route is verified, use `install media access-proxy
plan|apply` to save one service's URL. Review its metadata-only approval and
follow its returned `reconcile-links plan|apply`, then obtain a fresh
`reconcile-notebook plan|apply` approval. Route creation, DNS/CA trust,
dashboard links and rendered recap remain separate checks.
If fresh read-only host inspection shows Docker's default address pools are
exhausted, select two verified-free private networks with
`--media-network-subnets DEFAULT_CIDR,WEB_CIDR`. Both must be distinct,
non-overlapping canonical RFC1918 IPv4 CIDRs from `/24` through `/28`. The
choice is included in the exact approval digest and creates only a run-owned
Compose override; it never changes Docker's global address pools or an
unrelated network. Omit the option to preserve Docker's normal allocator.

Do not run `media-runtime.ts exec` inside a CLI-managed `.selfhost/media-harness`:
the CLI installs its own manifest, so the skill-runtime verifier will reject
that directory as unexpected. Use `self-host install media diagnose` or the
CLI lifecycle commands for a CLI-managed run. When an installed CLI reports a
runtime mismatch after the CLI package is upgraded, use `self-host install
media runtime-sync plan --project-root PROJECT`, review its exact digest, then
run the matching `runtime-sync apply`. It preserves `.sessions` and performs no
Docker operation. Do not bypass its project lock, transition ledger, or
interrupted-transaction recovery.

Otherwise use the packaged harness as immutable input. Set `MEDIA_SKILL_ROOT` to the
absolute directory containing this `GUIDE.md`, then install into the current
project before running any harness command:

```bash
MEDIA_SKILL_ROOT="/absolute/path/to/selfhost-media"
bun "$MEDIA_SKILL_ROOT/scripts/media-runtime.ts" init
bun "$MEDIA_SKILL_ROOT/scripts/media-runtime.ts" verify
```

Pass `--project /absolute/project/path` before `--` to select another project.
Use `sync` to refresh an existing installation. The runtime preserves every
existing `.sessions` tree and rejects other unrecognized runtime content.

## Workflow

1. Read [safety.md](references/safety.md) and
   [legal-owned-content.md](references/legal-owned-content.md).
2. Read [graph.md](references/graph.md) when choosing or explaining service
   relationships.
3. Read [runtime.md](references/runtime.md) before initializing or executing the
   harness.
4. Initialize and verify the private copy. Treat a failed verification as a stop
   condition.
5. Render the runbook or forward a session command explicitly:

   ```bash
   bun "$MEDIA_SKILL_ROOT/scripts/media-runtime.ts" exec -- render-prompt RUN_ID
   bun "$MEDIA_SKILL_ROOT/scripts/media-runtime.ts" exec -- session create RUN_ID USERNAME [--port-start FIRST] [--network-subnets DEFAULT_CIDR,WEB_CIDR]
   ```

6. Follow the installed `PROMPT.md`, ordered prompt modules, and
   `docs/headless-setup.md`. Use the run-scoped API scripts first; use
   agent-browser only for a failed service path or requested visual evidence.
   For an approved existing session, `bun scripts/setup-media-run.ts run RUN_ID
   personal --approved` runs the measured sequence until the Homarr Notebook
   needs a separate exact-plan review. Review `session.sh homarr-notebook plan
   RUN_ID personal`, then resume with `--from homarr-notebook
   --notebook-approve DIGEST`. It does not create a session or approve deployment
   for the user. A resume with `--from`
   is not a whole-run benchmark. Do not infer an under-ten-minute result from
   dry-run stage listing or from partial timing.
   For a CLI-managed run, `self-host install media benchmark --project-root
   PROJECT --run-id RUN_ID` validates the owner-only v1 timing records and
   reports the latest invocation without Docker, browser, or credential reads.
   It times command stages only: session preparation and manual browser repair
   are excluded. Its output never proves the whole setup finished under ten
   minutes or that the full stack passed acceptance.
   On script failure, read the adapter-owned secrets-full mode-`0600`
   `setup-fallback-SERVICE.json` to resume the exact service and step with its
   existing credentials and cookie-jar locations. Normal reports include only
   this private artifact's path and safe failure classification.
   Run their relative commands from the installed project's
   `.selfhost/media-harness` directory. Resolve assigned ports through the
   session helper and keep every action scoped to one run identifier. Do not
   live-test a new headless path before the user approves that test.
7. Read [acceptance.md](references/acceptance.md) before reporting completion.
   Mark indirect or absent evidence unproven.
8. Report passed, failed and pending acceptance rows. Refresh `session
   connections RUN_ID`. If saved credentials were requested, the aggregate
   runner attempts a partial handoff even when a stage fails. Run `session
   handoff RUN_ID` if that attempt failed or the user requested a fresh export:
   it writes `artifacts/private-handoff.json` (0600) containing
   generated password, usernames, available API keys, URLs and storage paths,
   plus a redacted `handoff-report.md`. Return the paths without opening the
   private file. Re-export on upkeep only when requested. Partial setup must
   remain explicitly incomplete in the setup report.

Confirm the admin username before `create`. `defaults` selects `admin` and a
generated password; do not silently select a username without that consent.
If browser fallback is needed, read `docs/browser-benchmark.md` and use
`browser-benchmark.ts lookup SERVICE` for the selected service’s direct paths.
Use `browser-key refs` instead of visible snapshots on populated API-key pages.

Run `bun "$MEDIA_SKILL_ROOT/scripts/verify-bundle.ts"` to verify the packaged
asset. Add `--source-root /path/to/source` only when auditing source drift.
Neither verifier uses Docker or reads runtime sessions.
