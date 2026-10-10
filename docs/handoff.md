# Remote Codex handoff

> Historical snapshot (2026-10-07). #192 moved the Go module to the repository root and removed `.agents/`, `packages/` and the legacy `docs/`; read those paths with `git show e979269a:<path>`.

Snapshot: 2026-10-07. Continue on `feat/new-cli` in private
`ajnart/selfhost-skills`, [PR #31](https://github.com/ajnart/selfhost-skills/pull/31).
Repository access is required. Preserve the private repository and open PR boundary;
this handoff authorizes neither merging nor changing visibility.

## Start here

Fetch the branch and inspect status before editing. The Go module (the `new-cli` directory until #192)
is now the repository root. Use the Go version declared in `go.mod`.
Read these bounded references when resuming:

- `AGENTS.md`, `docs/agents/domain.md`, and `.agents/CONTEXT.md` for repository
  ownership and safety; consult the relevant `.agents/adr/` decision before changing a boundary.
- `CONTEXT.md` and [ADR 0002](adr/0002-one-dashboard-fixed-keybinds.md)
  for the agreed Go product model and TUI scope. Preserve explicit user-approved
  Go vocabulary and exposure choices where the older skill model differs.
- [Where to look](where-to-look.md) and [legacy catalog](legacy-catalog.md)
  for source routing. Historical porting counts in those references are obsolete.
- `docs/agents/issue-tracker.md` before tracker writes and
  `docs/agents/triage-labels.md` before triage. Refresh each issue and its comments.
- [Media API research](research/media-apis.md) for Jellyfin, Seerr and Homarr API work.

Local temporary evidence, private runtime stores and old chat history are not
required to resume; use the committed proof documents below.

## Completed work and evidence

The catalog port is complete: **93 Apps and 20 Recipes** (19 legacy Recipes plus
`media`). Coolify is deliberately excluded as a host controller. Preserve the
parity exceptions and existing App, Recipe, render and keybind checks.

Workflow implementation, Standards/Spec review and targeted tracker reconciliation
are complete. The old interrupted-review range and proposed lightweight batch are
obsolete. Preserve shared Project mutation sequencing, Setup helpers and isolated
TUI modules; resume only concrete new findings.

The [final runtime matrix](runtime-matrix.md) and [full records](runtime-matrix.json)
cover all 113 targets: **97 pass, 3 failed, 8 awaiting external credentials and
5 manual**. Each result retains its own source head, binary/image identities,
recorded stages and cleanup. This is a mixed-head snapshot; later source changes
do not upgrade historical runs. Generic lifecycle/archive checks do not establish
browser acceptance, database-content recovery or unrecorded workloads.

[Homarr proof](homarr-proof.md) and [JSON](homarr-proof.json) record nine real
container/API/browser stages plus owned cleanup at
`374bd1c813aa6f2d32580f1ae4fe2711a0ecb427`, with visually reviewed dashboard,
notification, media and notebook screenshots. Actual native PTY captures cover
Dashboard, expanded Workflow and Install search at the same head/binary:
[recording](demos/self-host.cast), [provenance](demos/capture.json). TUI evidence
is complete for that scoped fixture; the user's usual installed binary is not
claimed updated.

Three real installs remain failed with cleanup PASS:

- [BookStack #86](https://github.com/ajnart/selfhost-skills/issues/86) and
  [Speedtest Tracker #66](https://github.com/ajnart/selfhost-skills/issues/66):
  HTTP 502 at `72898709c83ad1ca243e7f3ceb7f0d086b61ef6f`.
- [Passbolt #100](https://github.com/ajnart/selfhost-skills/issues/100): HTTP 500
  at `b54733427f9c9ed44628073356a957a43bc4e8bb`.

The [PHP-FPM host-limit report](php-fpm-host-limit.md) and
[fixed projections](php-fpm-host-limit.json) distinguish prior source fixes,
public-image confinement reproductions and verified helper recovery/cleanup.
The Passbolt reproduction proves denial opening a fixed public bootstrap file,
not the complete cause of the live HTTP 500. All three issues remain open.
Guarded hints request host-administrator compatibility review; no host-policy
bypass or confinement change is authorized.

## Release proof

[Release proof](release-proof.md) and [JSON](release-proof.json) record private
0.1.0, 0.1.1 and [0.1.2](https://github.com/ajnart/selfhost-skills/releases/tag/new-cli-v0.1.2)
publication. Release 0.1.2 binds source
`d908cb6727ed6956cfbc7c6d5bf52ce1b8e3adbd` to
[successful release run 37663197041](https://github.com/ajnart/selfhost-skills/actions/runs/37663197041).
The exact source's [CI run 37662562771](https://github.com/ajnart/selfhost-skills/actions/runs/37662562771)
completed all five jobs successfully: source checks and native Linux/macOS
amd64/arm64 checks.

Authenticated Linux amd64 host update from 0.1.1 to 0.1.2 and a pinned fresh
0.1.2 install passed in owned destinations. All published archive checksums and
bytes matched their corresponding workflow artifacts; corrupted checksums were
refused while preserving the existing binary.

A clean minimal Alpine Linux amd64 container used the fixed 0.1.2 bootstrap to
install the published 0.1.0 binary, then that actual binary self-updated to 0.1.2.
Installed hashes matched the published assets. It used no host mount or Go/Bun/Node
runtime; exact cleanup passed and no owned markers remained. This is clean-container
install/update proof on the host kernel, not a fresh-machine/VM or application
Docker-deployment claim.

Published-release install/update on the other three platforms and WSL remain
unverified; native Windows is unsupported. Four-platform native source CI does
not substitute for those installation results. The user's usual installed binary
is not claimed updated. Distribution/installer proof is tracked in
[#44](https://github.com/ajnart/selfhost-skills/issues/44) and
[#109](https://github.com/ajnart/selfhost-skills/issues/109); refresh their state
before tracker work.

Release-source CI is immutable evidence for the tagged source. Subsequent
branch documentation and PR-head checks have their own identity; reconcile the
current branch/PR head when resuming. Preserve private PR #31 for user review.
Completed catalog, Workflow, Homarr and release proofs need no automatic rerun.

## Execution boundaries

Runtime work requires explicit authorization for the selected owned targets.
Within that scope, cap concurrent environments at 20 and run heavy targets
exclusively; this ceiling does not authorize a full-catalog rerun. Use the owned
Project harness, resource admission checks, fixed public/sanitized projections
and exact cleanup. A failed cleanup blocks further targets until recovered.

Keep `E2E_PRIVATE_DIAGNOSTICS=0`. Do not read secret stores, `.env*`, credentials,
sessions, cookies, browser state, private logs or process environments. Never
perform broad Docker teardown/prune, remove unowned volumes, alter host policy or
touch the user's real deployment as part of disposable proof. Public ingress and
other protected mutations retain their explicit approval boundaries.

For source edits, follow `AGENTS.md` and validate the affected boundary. Broad
Docker/test runs are not implied by this handoff. Stage only owned paths,
reconcile concurrent work before pushing and preserve PR #31 for user review.
