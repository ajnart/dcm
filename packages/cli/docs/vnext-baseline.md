# vNext baseline (2026-09-28)

This is the starting evidence for the CLI-first milestone, not an acceptance
score. PR [#12](https://github.com/ajnart/selfhost-skills/pull/12) is the
feature branch; no vNext change is being pushed to `main`.

| Surface | Verified baseline | Gap against vNext |
| --- | --- | --- |
| Catalog | 112 app folders, 20 goals; exact folder discovery and support labels. Uptime Kuma has one validated single-service Compose recipe and a local-Linux apply path. | One trial does not promote the rest of the catalog. Paperless-ngx has no generic recipe/apply path. |
| CLI | Packaged Node-target command builds; `doctor`, catalog, plan, state, media, household, app, and adapter routes exist. Uptime Kuma `app image` now resolves and checks a pinned Linux manifest from the registry; its packaged command was run against the live v2 image index on x64. `app plan/apply/status/resume/up/down` has exact approvals and a private checkpoint. `app account-plan/account-prepare/handoff` can generate or adopt one owner-only credential reference, idempotently, with explicit secrets-full export; its account remains unverified until direct app evidence. A fresh 2026-09-28 rootless-Linux trial applied an isolated project, created an admin in the browser, observed a self-check monitor Up with HTTP 200, stopped and restarted via the CLI, then logged in from a fresh browser session and read back the persisted monitor. | This proves one local Linux trial, not automatic first-account creation, custom-password choice, cross-platform Docker apply, or measured ease. Installer routing and project state remain split across specialized adapters. |
| Graph | Read-only plans list jobs, prerequisites, and potential parallel groups. Household has a bounded Immich/Docmost initial parallel apply. | There is no general DAG executor, versioned job journal, or safe cross-app scheduler. |
| Media | Linux-only seven-service adapter and exact `ghcr.io/homarr-labs/homarr-test:v2` image; partial browser/credential handoff and Homarr attachment machinery. | Two new isolated end-to-end board/integration/widget/Notebook trials and measured ease are not recorded for this PR. |
| Other apps | Immich, Docmost, Vaultwarden, Caddy, and Homarr have bounded specialized commands. | App presence, container liveness, API evidence, and full functional acceptance are distinct. None of the 112 catalog records implies automatic installation. |
| Platforms | CI has now built and executed native catalog/plan/doctor binaries on Linux, macOS, and Windows x64/ARM64 runners with Node/Bun absent from `PATH`; deployment adapters still target Linux. A local Bun 1.4.0 Linux x64 native binary opened the TUI, loaded its catalog through a child CLI call, searched Uptime Kuma, and reached a separate app-only Uptime apply approval after a read-only plan for a second isolated project. The native TUI also opened the existing legacy project from Resume without a Docker mutation. | A native plan or Linux TUI preview does not prove Docker Desktop/WSL app deployment or full TUI apply. |
| Distribution | Private Git checkout can build a source-independent Node package; no public npm release. A local Bun 1.4.0 Linux x64 compiled probe passes `--version`, catalog recipe/search, planning, plan doctor, and initial TUI launch without Node/Bun on `PATH`. [CI run 36420041376](https://github.com/ajnart/selfhost-skills/actions/runs/36420041376) built, ran, checksummed, and uploaded all six native targets; a fresh Linux x64 artifact download passed its checksum, version, recipe lookup, and plan-doctor checks without Node/Bun on `PATH`. | These 30-day private artifacts are not durable releases or verified Docker installers. |
| Evaluation | Prior 73/100 reviewer judgment was provisional, not measured CLI ease. | Run the existing timed live evaluation after the target slices are functional. Do not present a new score from static checks. |

Next implementation boundary: integrate the prepared credential reference with
Uptime Kuma's first-account acceptance, then reuse that model for
Immich and Paperless-ngx. Extend the executable DAG and run a complete app
trial on macOS/Windows Docker Desktop or mark those apply paths unsupported.
The isolated Linux trial does not replace the two required media/Homarr trials.

## Implementation delta (2026-09-29)

This section updates the starting inventory above; it is not new live acceptance
evidence or an evaluation score.

- The bounded bundled-app route now covers Uptime Kuma, Immich, Paperless-ngx,
  and standalone Homarr. Uptime Kuma has separately approved first-account,
  local self-check, monitor baseline, and post-restart readback commands.
  Immich and Paperless-ngx have saved functional and restart canaries. A saved
  acceptance checkpoint remains historical until its exact runtime is checked.
- A mixed batch of two to eight independent bundled apps has an executable,
  two-at-a-time app-job DAG and an owner-only version-3 ledger. Only a proven
  never-dispatched pending job can be resumed with a fresh approval. In the
  TUI, successful jobs in a partial batch can continue their own account and
  acceptance checks without replaying the failed jobs.
- Homarr attachment still has distinct tile, Notebook, integration, widget,
  live-data, and browser-rendering gates. The generic TUI can offer Uptime
  Kuma's native integration. Generic Immich now has private acceptance input,
  a separately approved limited API key with uncertain-write recovery, and a
  native attachment path offered after its accepted restart canary. This is
  source progress, not a live integration or rendered-board result.

Remaining release gates are unchanged: platform Docker apply evidence, two
fresh isolated media/Homarr board trials, and a timed evaluation rerun. Keep
the prior provisional score separate from those missing measurements.
