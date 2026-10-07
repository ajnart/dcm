# Remote Codex handoff

Snapshot: 2026-10-07. Continue the Go rewrite in `ajnart/selfhost-skills`, branch
`feat/new-cli`, [PR #31](https://github.com/ajnart/selfhost-skills/pull/31).
The repository is private; the receiving machine needs repository access.
The user wants a Codex agent on another machine, **not a Paseo agent**.

## Start here

Clone or fetch `feat/new-cli` and inspect status before editing. The Go module is
`new-cli/`, tracked by the outer repository; it is no longer a nested repository.
Use Go as declared by `new-cli/go.mod` (currently 1.26.0).

Read these exact paths, rather than crawling the repository:

- `AGENTS.md` and `docs/agents/{domain,issue-tracker,triage-labels}.md` for repository rules.
- `new-cli/CONTEXT.md` and `new-cli/docs/adr/0002-one-dashboard-fixed-keybinds.md`
  for the current Go product model and the amended TUI scope.
- `new-cli/docs/where-to-look.md` and `new-cli/docs/legacy-catalog.md` for source routing.
  Their historical progress counts are stale: the port is complete.
- `new-cli/docs/research/media-apis.md` when checking Jellyfin, Seerr or Homarr APIs.

The Go rewrite's vocabulary and exposure choices were explicitly agreed with the
user; preserve them when the older skill's domain model differs. Local cached
plugins, `.scratch` briefs, Claude agent definitions, old worktrees and conversation
memory are not required to resume. The references below are committed or on GitHub.

## Current state

- Code head before this documentation handoff:
  `eeaaeff06a62fdf5cf936fb872eff2bb2dbbbddb`.
- All implementation and sub-agent changes are merged into `feat/new-cli` and
  pushed. No implementation branch remains to merge for this task.
- PR #30 (the initial rewrite) was merged. PR #31 is the follow-up and was open
  at this snapshot. Refresh its state and head before pushing.
- **Catalog port is complete:** 93/94 legacy Apps, Coolify deliberately excluded
  as a host controller; all 19 legacy Recipes plus the additional `media` Recipe.
  Do not restart porting or remove the deliberate parity exceptions.
- `TestEveryLegacyAppIsPorted`, `TestEveryLegacyRecipeIsPorted`,
  `TestEveryCatalogAppRenders`, and the keybind audit exist. The facts file is
  `new-cli/internal/catalog/testdata/legacy-facts.json`; tests never need the
  legacy tree at runtime.
- Stale LAN detection, `config set LAN_IP=auto`, and repeatable Host settings
  review are merged and tested.
- The TUI has Dashboard, Install, Settings, Stack and Workflow views. Install
  searches with `/`; Settings edits PUID/PGID/UMASK and both folders; Stack shows
  Compose containers and updates. Images pull with progress before install/update.
- Architecture work is merged: shared Project mutation sequencing, deeper Setup
  helpers and isolated view modules. Preserve these boundaries.
- Homarr widgets, its setup notebook and ntfy topic/token wiring are merged.
  ntfy/Homarr widget behavior still needs real-container/UI verification.
- The previous session reported a green full `go test ./...` and vet after the
  Workflow merges. GitHub's `new-cli` check on code head `eeaaeff0` was verified
  green during preparation of this handoff. This is source/CI evidence, not proof
  that every App or the user's installed binary works.

## First task: finish the interrupted Workflow review

The implementation is finished. Review it as one change, fix concrete findings,
then commit and push the fixes to PR #31. Do not reimplement its tickets.

Use the code-review skill when available, with separate Standards and Spec axes.
The originating spec is [#32](https://github.com/ajnart/selfhost-skills/issues/32);
the implemented tickets are #33 through #37. Pin these review refs:

```sh
git diff c85b44c3dac1b7f9bc74452cb5cde33aad1fd5ad...eeaaeff06a62fdf5cf936fb872eff2bb2dbbbddb -- new-cli/
git log c85b44c3dac1b7f9bc74452cb5cde33aad1fd5ad..eeaaeff06a62fdf5cf936fb872eff2bb2dbbbddb --oneline
```

This range includes nearby FreshRSS and secret-exec/e2e fixes as well as Workflow.
Account for all changed files; identify unrelated fixes separately. If the remote
head moves, reconcile and update the review coverage rather than overwriting work.

The Workflow acceptance requirements, preserved here for offline review:

1. `w` opens Workflow, listed in the top bar, help and keybind audit. Every installed
   App appears, including unmanaged Apps labelled "added by hand, no Setup".
2. One pure Workflow module combines persisted status with task events. Its output
   orders render, pull, start, Setup steps, Links, then check; states are done,
   skipped, failed, running and not run. Header counts fully configured Apps,
   failed steps and running steps.
3. Render/pull/start are remembered per App across sessions and appear in
   `status --json`. A failed pull keeps its error/hint. Existing Setup records
   remain meaningful: stage failures must not leave Setup permanently incomplete.
4. Live starts show running until their terminal event; live data overrides saved
   data. Pull progress is visible. A new run resets the affected App's live steps
   without destroying unrelated state or Link targets.
5. A failed Link belongs to its declaring App and names its target. A Link waiting
   for its target is not run, with its reason. `enter` expands/collapses a failure's
   error and hint; `r` retries Setup for the selected App only.
6. Space expands/collapses Apps. Configured Apps start collapsed; Apps needing
   attention start expanded. `/` filters by name/id; esc clears the filter first,
   then returns home. Arrow keys and j/k select; pgup/pgdn and mouse wheel scroll.
   Selection stays visible among 40+ Apps, and output fits 80x24 terminals.
7. Tests exercise the pure module, isolated views, CLI JSON, keybind audit and a
   reviewed 120x30 golden. Keep the scope in ADR 0002; no speculative shortcuts.

Owning files for this review:

- `new-cli/internal/tui/workflow.go` — pure snapshot and event merging.
- `new-cli/internal/tui/workflow_view.go` — selection/filter/expansion/scrolling.
- `new-cli/internal/tui/{model,view,keys,dashboard}.go` — wiring and action hints.
- `new-cli/internal/tui/workflow*_test.go`, `views_test.go`, `harness_test.go`,
  `golden_test.go`, `testdata/workflow.golden` — behavioral seams and layout.
- `new-cli/internal/service/{mutation,service,install,lifecycle}.go` and
  `mutation_test.go` — stage recording and Setup verdicts.
- `new-cli/internal/cli/workflow_test.go` — persisted stages in CLI status JSON.

Merge conflicts were resolved when #35, #36 and #37 touched the same view files.
Pay particular attention to expansion changing row heights, selection after
filtering, retry event ordering, stale live events overriding fresh persisted
status, and event attribution during multi-App pulls. Recent regression fixes
preserved Link target labels and waiting reasons, kept unmanaged labels on their
App row, and prevented a failed start stage from poisoning the Setup verdict.

## Validation and real Docker follow-up

Use focused regression tests for review fixes; the user explicitly requested TDD
for Workflow. Do not add dependencies or abstractions without a concrete need.
Run the relevant package checks once after edits. The final Workflow integration
gate is `go vet ./...` and `go test ./...` from `new-cli/`.

The e2e harness already exists under `new-cli/e2e/`, behind the `e2e` build tag.
CI definitions are at the repository root:
`.github/workflows/new-cli.yml` and `.github/workflows/new-cli-e2e.yml`.
The harness uses `SELF_HOST_HOME` and `SELF_HOST_COMPOSE_PROJECT` for isolated
projects, verifies install/Setup/Check, idempotent rerun, backup and restore, then
cleans up only its own project. Browser-only first administrators are reported as
manual; Apps needing external credentials are distinct from verified passes.

Prior real runs reported passes for default ntfy/Vaultwarden/media targets and
small batches. Actual failures in AdGuard, authentik, Docmost and FreshRSS were
fixed and individually verified. Their tests stay valuable: readiness redirects,
bootstrap timing, JSON content type and absent-admin probes differed from fakes.
Full-catalog runtime coverage is **incomplete**. Logs from those runs were local
temporary evidence and are not available in a fresh clone.

Next proposed lightweight targets are `forgejo`, `gatus`, `glances`, `lldap`,
`valkey`; that batch was not run. On a receiving machine with owned Docker
capacity, run one target at a time, for example:

```sh
E2E_TARGETS=forgejo E2E_LOG_DIR=/tmp/selfhost-e2e-forgejo go test -tags e2e -v -timeout 45m ./e2e/
```

Preserve these limits:

- **Do not launch `E2E_TARGETS=all` or many stacks concurrently.** The user stopped
  the full-catalog run because their Mac could not handle the load. No heartbeat
  should restart it; the previous e2e heartbeat was deleted.
- The receiving agent runs remotely. It cannot verify or replace the user's
  `~/.local/bin/self-host`, repair `~/self-host`, or claim the user's installed TUI
  is updated from remote source checks. Track that manual validation separately.
- Keep secrets, `.env*`, saved credentials, sessions, browser state and runtime
  artifacts out of source/commits/reports. Never prune Docker globally, delete
  unowned volumes or touch the user's actual `selfhost` Compose project.
- When monitoring Actions, use one `gh run watch <id> --compact --exit-status`;
  inspect `gh run view <id> --log` if it fails. No repeated polling turns.
- Commit only owned paths. Fetch/reconcile the PR branch before pushing; no force
  push over concurrent work. Leave PR #31 for user review after fixes. Tickets
  #33–#37 were open at handoff; close them only when completion is recorded.

## Completion report

Report Standards and Spec findings, fixes and commits, relevant local checks and
hosted CI separately, and each real-Docker target as pass/fail/manual/skipped.
State remaining installed-binary/UI validation and external-account requirements.
The catalog port is done; continue the review and bounded runtime proof rather
than creating new features.
