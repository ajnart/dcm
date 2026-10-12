# self-host skill evaluation progress

## Scope

The harness is tracked in [PR #259](https://github.com/ajnart/selfhost-skills/pull/259).
The operator guide changes stay in [PR #257](https://github.com/ajnart/selfhost-skills/pull/257).
The proposed Catalog contributor skill is separate and remains unimplemented.

```text
person's request → project-local router → self-host skill → frozen guide
                              ↓
           inspect → plan → approval → apply → verify
                              ↓
       raw evidence → validity gate → grading → skill-creator viewer
```

App operations use fixtures. This does not prove real installation, native
platform behavior, or correct authorization scope for every Action.

## Harness acceptance gates

No percentage estimate: each gate requires evidence.

| Gate                                                                   | Status                                                        |
| ---------------------------------------------------------------------- | ------------------------------------------------------------- |
| Runner CLI saves frozen inputs, streams and failure diagnostics        | Regression tests pass                                         |
| Grading rejects missing manifests, unknown checks and failed judgments | Regression tests pass                                         |
| Shell boundary blocks host reads/writes/execution and network access   | macOS canary tests pass                                       |
| Real CLI discovers the router in router-present configurations         | Observed; missing discovery now invalidates execution         |
| Claude transport and shell use no bypassPermissions                    | Implemented; fail-closed hooks require CLI 2.1.295+           |
| Local build, vet, tests, race checks and installer syntax              | Passed                                                        |
| Complete real-model batch with both guides and three repetitions       | Iteration 15 smoke valid; full iteration 16 running           |
| Complete blind judgments, aggregation and supplied review viewer       | Iteration 15 complete; full batch and human feedback pending  |
| Independent Standards and Spec review                                  | Final source and follow-up fixes passed both independent axes |

The user approved tests at three seams: runner CLI → saved artifacts, grading
CLI → accepted/rejected grades, and execution boundary → blocked host/network
access. Tests use a fake Claude executable only at the external model boundary;
shell canaries exercise the real OS sandbox. See [README.md](README.md) for commands.

## Evidence ledger

- **Iteration 1: invalid.** Agent-authored transcripts and wrong approval/repetition
  accounting. Its scores are not evidence.
- **Iteration 2: historical fixture result.** Approximately 96% with the skill
  versus 34% without, using four scenarios and scripted replies. Not comparable
  with the later seven-scenario, model-person conversations.
- **Iteration 3: invalid.** All 42 runs hit the Claude quota. The old 42.7% score
  was produced from empty runs and must not be used.
- **Iteration 4: invalid.** Restricted mode suppressed project skill discovery;
  the router was absent. One conversation also exhausted its turn budget.
  Discovery is now explicitly checked; restricted mode is not used because it
  prevents evaluating the real project-local router.
- **Iteration 5: invalid.** The original-guide conversation encountered a missing
  media-folder config fixture and exhausted its budget. Added the fixture and
  a regression test.
- **Iteration 6: invalid.** Both routers loaded, but the original-guide conversation
  needed more than eight turns. Kept the failure; added an explicit recorded
  conversation-budget override. Later comparisons give both guides 16 turns.
- **Iteration 7: invalid.** Two person calls returned prose preceding their JSON;
  strict parsing rejected them and pending runs were cancelled. Person and judge
  calls now use schema-validated structured output rather than relaxing parsing.
- **Iteration 8: invalid.** Both task runs hit the session quota after preflight
  succeeded. No score was produced. Claude reports a reset at 22:00 Europe/Paris.
  A fresh comparison remains pending after that reset.
- **Iteration 9: valid smoke.** After the 22:00 Europe/Paris reset, both model
  preflights passed. The MacBook scenario completed once per guide within the
  shared 16-turn budget, with no execution errors or permission denials.
  Complete blind Opus judgments and scripted grading gave revised **11/12**
  and original **10/12**; all eight scripted assertions passed in both. The
  revised guide offered the media choice and asked for the folder before install;
  the original did not. Supplied aggregation and static viewer were generated;
  model/repetition placeholders were corrected to actual smoke provenance.
  Evidence: `~/.cache/self-host-skill-evals/iteration-9/`.
  One run is not a general improvement claim. Both plain-language failures cite
  Docker in the required experience question, partially conflicting with the
  prescribed wording. Grades are unchanged and this caveat is in viewer notes.
- **Iteration 10: invalid.** Nineteen runs completed; the remaining 23 failed or
  were cancelled after revised MacBook run 3 exhausted its 16-turn budget.
  No grading or aggregate score was produced. That conversation chased
  contradictory fixtures: Jellyfin-only install labelled Media, Sonarr
  credentials, permanently empty Docker observations, and a nonexistent
  placeholder Home folder. Four red-to-green shell/fixture regressions now
  cover those inconsistencies. The full offline suite has 40 passing tests;
  Ruff, Pyright (including both extensionless fixture scripts), and independent
  Standards/Spec re-review passed. Guides, assertions, and budget are unchanged.
  Corrections apply only to future frozen inputs; iteration 10 remains untouched.
- **Iteration 11: valid corrected smoke.** Both account-access preflights passed.
  One MacBook run per frozen guide completed in five turns with no denials or
  errors, using the reconciled audit, selected-App fixtures and neutral runtime
  identifiers. Complete blind judgments and scripted grading gave revised
  **11/12**, original **10/12**; all eight scripted assertions passed in both.
  Supplied aggregation and static viewer are at
  `~/.cache/self-host-skill-evals/iteration-11/`; metadata placeholders were
  corrected to the actual models and single repetition. This is smoke evidence,
  not a general improvement claim. The judge explicitly called the revised
  media-choice pass lenient because "The fuller setup" was not explained.
  Both plain-language failures partly conflict with the prescribed experience
  question and also cite other confusing wording. Verdicts remain unchanged;
  viewer notes flag both caveats for human review.
- **Iteration 12: invalid.** Six runs completed; 36 failed or were cancelled
  after revised MacBook run 3 exhausted the unchanged 16-turn budget. No grades
  or aggregate score were produced. The simulated person selected an optional
  library follow-up after the install Recap and then invented browser failure
  observations absent from its persona. Unsupported debug/logs/Setup/feedback
  fixtures prolonged the troubleshooting. An original-guide run also followed
  placeholder zero-byte media into drive troubleshooting and observed real
  host mount/device metadata through read-only shell commands. This is not
  evidence of real drive state or native platform behavior; do not publish the
  raw transcript without redaction. The current shell sandbox protects files
  and network but does not virtualize every read-only machine observation.
  Further model runs are paused pending the decision whether the install
  scenario ends at the Recap or must include an explicitly modeled browser
  acceptance flow. Either way, machine/media observations need consistent
  synthetic coverage; merely raising the turn limit would hide the problem.
- **Iteration 13: invalid transport failure.** The original-guide conversation
  failed on turn 6 with an API/DNS `ENOTFOUND` connection error. Shared
  cancellation stopped the revised-guide conversation on turn 8. Neither run
  completed; no judgments, grades or benchmark were produced. Frozen inputs
  and raw diagnostics are retained unchanged.
- **Iteration 14: invalid launch-path failure.** Both preflights passed, but
  the revised run never read the guide: fixture commands failed silently and
  the person/agent conversation exhausted 16 turns. Its peer was cancelled on
  turn 10. Neither was graded. Offline reproduction identified inherited
  file-backed stdout/stderr outside the sandbox, unlike earlier piped tests;
  another reproduction found missing metadata permission for archived-fixture
  symlinks. This is not evidence of guide quality. Evidence remains untouched.
- **Iteration 15: valid current-input smoke.** Both MacBook conversations
  completed without denials or execution errors: original in five turns,
  revised in seven. Complete blind Opus judgments and scripted grading gave
  **11/12** each; all eight scripted assertions and both separate Recap
  assessments passed. Overall `acceptance_passed` remains false because the
  original plain-language assertion failed in both configurations. Its evidence
  partly conflicts with the required experience question and credential/Home
  folder wording; the revised response also used DHCP jargon. The original
  media-choice assertion passed leniently on the person's volunteered preference,
  without an explicit two-option offer. Verdicts are unchanged. Supplied
  aggregation and static viewer, with actual model/repetition provenance and
  these caveats, are at `~/.cache/self-host-skill-evals/iteration-15/`. The viewer
  was opened for human feedback. One run per guide is not a general improvement
  claim and does not clear the full-comparison or human acceptance gates.
- **Iteration 16: running.** The previously authorized full comparison uses
  all seven scenarios, both unchanged frozen guides, three repetitions and
  equal 16-turn limits, with two concurrent conversations. The current-input
  smoke execution and complete judgments are valid. No model switch, paid
  fallback or billing change is used; any execution failure blocks grading.

Attempts are retained, not patched into successful runs or silently dropped from
a benchmark. Changes to fixtures, models or budgets define a new comparison.

The original guide comes from `86246cfe`; SHA-256:
`b6f7e41a27aa706a00dc062c1166ccc7abea5874653f55bd84e3e9cb2fb195c1`.
The revised guide comes from `665cfd1f`. The router is unchanged. Each run keeps
its actual guide, router and flattened scenario, with guide/router fingerprints;
each iteration keeps independent frozen stubs. Judge usage/cost is now retained.

## Limits and remaining work

### Release audit follow-up (October 11, 2026)

Reviewed the complete PR against pinned `origin/main`
`5aafb4c1833fd4cd9caf0f7beaac31e625aafe22`, its body and comments, and the
repository standards. Corrections are limited to the fixture harness:

- Active model calls and their process-group children now terminate when a
  parallel batch fails, a call times out, or a call finishes. Background Bash
  requests are refused; deliberately detached hostile code remains out of scope.
- Read access outside the workspace is restricted to the current session's
  tool-results folder. Shell canaries cover absolute host automation tools and
  workspace symlink escapes as well as host reads, writes and network access.
- Regrading clears old scores before validation; judge preflight failure clears
  old verdicts. Cached judgments require matching assertion/conversation hashes,
  and positional grading cannot bypass incomplete judgments elsewhere in a batch.
- Guide-before-change checks now include host and Docker mutations; synthetic
  secret checks include host/Docker arguments and actual Bash inputs. Every
  publication needs a matching nonempty domain plan and later approval.
- Empty task streams and malformed usage are invalid. Cache tokens are included
  without counting person calls; missing reported cost is unknown, not free.
  Stream tool calls and fixture command invocations have separate metrics.
- The fake CLI accepts value flags using `=`, retains Profile changes and does
  not mark failed installs complete. Existing-Project fixture Profiles agree
  with their Status. Ruff and Pyright now include extensionless Python stubs.

The offline gate passes **55 focused regressions**, Ruff lint/format and Pyright.
The repository Go gate was rerun successfully, without Docker runtime, browser,
installer execution, a live Project, or real provider calls. The connected
catalog lists Sonnet/Opus 5.5 as active; account access was not tested.
No dependency was added. No source-worktree edits or child reviewers were used.
Fresh independent review is delegated to the parent session, not claimed here.
The concurrent smoke-evidence commit `0d09773f` is preserved. Its iteration 9
result predates these audit corrections. Iteration 10 subsequently failed as
recorded above. Neither is acceptance evidence for changed harness inputs.
The audit launched no additional real-model run.

The parent session reconciled the audit commits with the four fixture-fidelity
corrections without dropping either change. The combined offline suite passes
60 regressions, Ruff lint/format including extensionless stubs, and Pyright.
Combined Standards review passed; Spec review caught configuration
labels in the synthetic Home folder revealing treatment to the blind judge.
A red-to-green runner regression now requires neutral runtime folder identifiers;
run artifacts still retain their configuration mapping. Spec re-review passed.
Iteration 11 was recorded as clearing that earlier smoke gate. It predates the
fresh fixture-contract and cancellation findings below and does not establish
acceptance of the corrected harness. Its raw evidence and grades remain unchanged.

### Fresh independent review corrections (October 11, 2026)

The clean release-audit worktree preserved `0668395f` and concurrent `0c3df2d5`
by fast-forward, without accessing or modifying the source worktree. Fresh
Standards and Spec findings are corrected at the existing fixture/CLI seams:

- All tracked credential fixtures, including the four linked platform fixtures,
  retain the production `apps` object: App IDs map to secret-name/string-value
  objects. Filtering retains that shape. Shared Admin login stays under `admin`.
- Sonarr's Debug report uses `id`, `name`, `managed`, `setup`, real StepStatus
  fields, `log_lines`, and a `{url, working}` health-check object. Successful
  Setup changes its result only; qBittorrent and the other current Apps remain
  in Status and Docker observations. Setup does not overwrite the installed selection.
- Direct App installation does not invent a Recipe or a Homarr Dashboard.
  Recipe installation records the named Recipe for newly installed Apps and
  preserves earlier selections and their Recipe attribution.
- Question-option descriptions are retained alongside labels for the simulated
  person, conversation output and blind judge.
- Successful synthetic publication persists only after the success fixture,
  with production-shaped plan fields and selected App/domain Addresses. Status
  retains Home network fallback and shows Cloudflare Access and its connector;
  later plans show current publication. Missing approval/token input, refused
  Apps and failed publication do not replace the remembered state.
- SIGINT/KeyboardInterrupt and SIGTERM set shared cancellation and cancel queued
  futures before executor shutdown. Owned active process groups terminate,
  raw diagnostics survive, and execution/judgments remain invalid with a nonzero
  exit. Partial judgments cannot be reused. No external comparison process is
  inspected or terminated.

Existing tests were extended, not new testcases or files. Red-to-green checks
cover credential/debug contracts, selection and publication consistency, full
option rendering, and disposable signal interruption of runner and judge batches.
Each signal check has six planned calls and two active fake calls; cancellation
prevents the four queued calls, retains partial diagnostics, and prevents the
owned child from writing its delayed marker. The final gate passed all 60 existing
offline tests, Ruff lint/format, Pyright and the documented Go build/vet/tests/race
and installer-syntax checks; `gofmt -l .` was empty and `git diff --check` passed.
No dependency or production JSON contract changed.

All earlier batches, including iterations 9 and 11 and the invalid iteration 12,
used earlier frozen fixtures/rendering and do not prove the corrected inputs are
valid. Historical raw evidence, grades and viewer notes are not edited or
reinterpreted as new results. A new bounded-authorized comparison, complete
judgments/aggregation, human viewer feedback and final parent review remain
required; the scenario-boundary decision recorded for iteration 12 is also open.
This correction uses no paid model/preflight call, browser, Docker runtime,
live Project, real secret, protected-file read or child agent. PR #259 stays draft.

### Pinned parent review verdict

The parent's [independent Standards and Spec verdict](https://github.com/ajnart/selfhost-skills/pull/259#issuecomment-6114075345)
records both axes passing with zero findings at source
`467cd06a2b59b189d9c269e4f89d14997ef992f6`, against fixed base
`3800111d292005af38221da47845956694956185`. Spec independently ran nine existing
focused offline regressions and diff checks; Standards checked fixture/production
contracts and the owned-process boundary. These reviews accessed no active raw
runs and made no new paid calls.

This clears the source-review gate for that pin only, not comparison acceptance.
The install-Recap versus browser boundary and consistent synthetic machine/media
observations remain unresolved. Boundary or fixture logic changes need approval,
offline verification and a fresh source review before any authorized comparison.
All historical evidence remains unchanged; full corrected-input execution,
complete judgments/aggregation and viewer/human feedback are still pending.
This documentary update changes no guide, router, assertion, fixture or runtime.

### Approved offline scenario boundary corrections

The parent approved install, actual CLI verification, then an adequate Recap
for newcomer scenarios. Optional library/browser follow-ups are declined after
that handoff, not expanded into invented browser failures. This resolves the
source-boundary decision recorded after iteration 12, without reinterpreting
that failed attempt. Native/browser functional acceptance remains separate.

Each scenario now records its own completion criteria. Successful CLI Status
records an observation through the existing fixture state boundary; completion
requires that observation after the latest change and checks the relevant goal:
installed Apps, fixed LAN Address, retried Sonarr Setup, or Paperless's published
Address/Cloudflare Access with Jellyfin private. Missing, failed or stale CLI
verification cannot be overridden by a person's `done`. Completion does not
pass assertions or replace the blind judge's assessment of an inadequate Recap,
missing approval or other guide failures. All original assertions are unchanged.

The four existing platform fixtures declare metadata-only movie names and sizes.
Preparation creates folders, not zero-byte counterfeit movies. Bounded listing
and size observations are explicitly synthetic; payload, playback and other
unmodeled observations are refused. Relay probe binaries are denied, broad
kernel-query permission is removed, and file metadata access is restricted to
runtime/working paths and literal ancestors. This does not claim full machine
virtualization or tamper-proof containment of hostile code.

Existing runner, execution and grading tests are extended at these seams, with
no new testcases/files, comments, dependencies or framework. Guide snapshots
`86246cfe`/`665cfd1f`, their fingerprints, the router, all original assertions,
equal 16-turn comparison budgets and historical frozen evidence stay unchanged.
The final offline gate passes all 60 existing tests, Ruff lint/format, Pyright,
the documented Go build/vet/tests/race/installer-syntax checks and diff checks.
Regressions cover absent, stale and failed verification for every scenario,
successful goal-specific verification, unchanged assertion failure despite a
person's `done`, media metadata without fake payloads and denied relay probes.
Only newly frozen inputs use these corrections. No paid model/preflight/account
call, browser, Docker runtime, installer, live Project, protected-file access,
child agent or external process intervention is authorized or performed.

The earlier clean source verdict at `467cd06a` does not cover this new logic.
Fresh independent Standards and Spec reviews are required at the new source
head. The 42-conversation comparison remains separately unauthorized: the
proposed Sonnet 5.5 agent/person and Opus 5.5 judge selection, at most 1,388 CLI
model invocations including preflights, and an enforceable spend cap still need
explicit approval. Complete judgments/aggregation, viewer and human acceptance
remain pending; PR #259 stays draft.

### Source re-review follow-up (October 12, 2026)

The parent reported Standards session `ses_ed35177b9ffe3T3Yb3OuXHBKDZ` passed
with zero findings at `3c9f13721a2971cce3214ce47c084b4d3b067ab3`. Spec session
`ses_ed35177b3ffedvrEOeZx74aKqr` found two P2s. Neither verdict is reused for
the logic changed in this follow-up; both independent source axes remain due
at the final head.

Verification freshness now includes already recorded host and Docker mutation
attempts, using the existing `host_change` and `docker_mutating` classifiers.
Failed or denied attempts conservatively stale an earlier Status observation
until a later successful verification. Read-only observations do not stale it.
No new shell probe, host query, permission or classifier is introduced.

All four newcomer scenarios, including WSL, now require a separate blind Recap
assessment in the existing judge call. It checks each installed App's purpose
and Address, the Home folder and the credential pointer without secrets. The
judge sees only the assistant's actual replies, commands, criterion and filtered
verified App inventory/Home folder, not a guide label or secrets. The person's
`done` is never an assessment. New frozen metadata records `judgment_schema: 2`;
the criterion and inventory are included in the judgment fingerprint. Missing
or invalid assessments/inputs cannot produce a grade. A negative assessment is
recorded separately in judge metrics and grading, with `acceptance_passed: false`
and a viewer review note; original assertions and their totals/rates are untouched.
Assertion-only aggregation is not independent completion acceptance.

Existing runner/grading test bodies cover late successful/failed mutation
attempts versus read-only observations and fresh re-verification; every newcomer
with each missing Recap detail; malformed/missing assessments and inputs; stale
criterion/inventory fingerprints; and the unchanged historical schema contract.
Offline fake-model tests validate these seams, not a real judge's quality.
All 60 existing offline tests, Ruff lint/format, Pyright, diff checks and the
full documented Go formatting/build/vet/tests/race/installer-syntax gate pass.
No new testcase, file, comment, dependency or grading framework is added.
Historical raw evidence/verdicts remain unmodified and unread; guide/router
snapshots, personas, first prompts, assertions and equal 16-turn budgets stay
unchanged. The paid 42-conversation comparison, 1,388-CLI-invocation ceiling,
explicit monetary authorization/enforceable cap and human acceptance remain
separate, unmet gates. PR #259 stays draft.

### Current session follow-up (October 12, 2026)

The user approved proceeding with the install/CLI-verification/Recap boundary,
committing and pushing the fixes, and continuing the comparison. Concurrent
commits through `16571438` were preserved by fast-forward; unrelated source
worktree changes remain untouched. Fresh independent review found a Python
launcher regression and missing service stop/disable freshness classification.

The actual shell tests reproduced seven launcher failures: `/usr/bin/python3`
could not resolve the developer-selection symlink under the tightened metadata
policy. Guarded PATH now resolves the already-required Command Line Tools
Python directly; no sandbox read permission is widened. The existing runner
regression was extended with systemctl stop/disable and service stop attempts,
including failures and fresh re-verification. Six subcases failed before the
shared classifier fix. All 60 offline tests, Ruff lint/format, and Pyright now
pass; both reviewers rechecked and cleared their findings.

The CLI authentication-status check confirmed a first-party Claude Pro
subscription login, with no API-key environment or custom endpoint. Continue
only with the selected Sonnet 5.5 task/person and Opus 5.5 judge, unchanged guide
snapshots and equal 16-turn budgets: one two-run MacBook smoke, then at most one
42-run comparison if smoke execution and judgments are valid. No paid fallback,
model switch or billing change is authorized; stop if quota/access is blocked.
Historical evidence is untouched. This does not clear the full comparison or
human viewer gates, and PR #259 remains draft.

### Actual launch-path regressions (October 12, 2026)

The shell seam now reproduces Claude's inherited regular-file stdout/stderr,
including 131072 bytes per stream and original exit status 7. The existing
runner fixture-preservation test exercises the actual guard/OS sandbox over
the prepared symlinked scenario, through guide, host, install and verification
commands, rather than unguarded fake command execution. The affected tests
went red on both observed fixture failures before correction.

A trusted synchronous pipe relay forwards completed stdout/stderr without
reopening agent-writable paths. Review caught and rejected an initial capture
path read escape and asynchronous forwarding; neither interim design was
committed or used in model runs. The final relay drains both pipes and waits
before returning, preserving the child status. Literal metadata permission
includes only configured roots/aliases and their canonical ancestors; host
read/write/network and arbitrary workspace-symlink canaries still pass.
Both independent reviewers cleared the final changes. Historical evidence,
guide/router snapshots, assertions and equal conversation budgets are unchanged.
All 60 existing offline tests pass, including the prepared runner canary;
Ruff lint/format and Pyright also pass. No new testcases, files or dependencies
were added. The first full offline command exceeded its 120-second shell timeout;
a fresh complete run with a longer shell timeout passed all 60 in 88 seconds.

### Earlier review evidence

Review follow-up fixes cover positional grading's batch gate, option-prefixed
Docker mutations, matching Paperless publication plans, explicit model success
envelopes, timeout diagnostics, and simulated manual Windows/WSL completion.
Each has an offline regression through the agreed CLI seams. Catalog fixture
duplication and historical unused checks are non-blocking review observations;
they remain unchanged to keep this fix focused.

Both review axes rechecked the fixes and returned code-ready verdicts. The
Spec follow-up also caught a container command's `--help` argument being mistaken
for Docker help; that regression now passes. The earlier offline gate was 36 tests,
Ruff lint/format, and Pyright. This does not clear the pending real-model batch
or human viewer gates, and PR #259 stays draft.

- Execution supports macOS only. Debian, Mint and WSL remain fixture simulations.
- The Claude transport needs account authentication/network access and is not
  inside the shell's OS sandbox. File access is guarded through hooks.
- Fixtures and their writable state/logs are not tamper-proof against a hostile
  model. Evaluate only the trusted router; use a disposable account/machine for
  untrusted skills. Raw logs are private and require redaction before sharing.
- Model-generated approval labels establish timing, not permission scope. The
  public-Access check requires an approval after its plan; the judge and human
  review must still assess the explanation and the requested Action.
- Agent timing excludes person and judge calls; their reported usage/cost lives
  in separate raw artifacts. No audience or real-installation claim follows.
- Finish the full batch, judgments, viewer and independent review before merging
  the harness. Improve the guide from valid findings and human feedback afterward.
- Trigger labels need user review before description optimization. Contributor
  skill design questions remain separate.
