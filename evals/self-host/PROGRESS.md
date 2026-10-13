# self-host skill evaluation progress

## Scope

The harness is tracked in [PR #259](https://github.com/ajnart/selfhost-skills/pull/259).
The original operator guide changes merged in [PR #257](https://github.com/ajnart/selfhost-skills/pull/257).
Further guide improvements belong in a separate follow-up PR.
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
| Complete real-model batch with both guides and three repetitions       | Iteration 25 valid: all 54 expanded conversations completed   |
| Complete blind judgments, aggregation and supplied review viewer       | Iteration 26 complete; viewer open, human feedback pending    |
| Independent Standards and Spec review                                  | Final source and follow-up fixes passed both independent axes |

The user approved tests at three seams: runner CLI → saved artifacts, grading
CLI → accepted/rejected grades, and execution boundary → blocked host/network
access. Tests use a fake Claude executable only at the external model boundary;
shell canaries exercise the real OS sandbox. See [README.md](README.md) for commands.

## Derived report invalidation (October 13, 2026)

A failed fresh judgment attempt removed verdicts and grades but left a prior
`benchmark.json` and `review.html` visible. The existing fake-Claude judge CLI
regression reproduced this before correction. Judgment invalidation now removes
both derived reports before execution validation or model preflight, while
preserving conversation inputs, execution evidence and archived raw responses.
The focused regression passes. No private attempts or model calls were accessed
for this source correction; the completed iteration 26 comparison remains
historical evidence, with human feedback still pending.

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
- **Iteration 16: invalid public-scenario contract.** Twenty of 42 runs
  completed; 22 failed or were cancelled. Revised public-Access run 2 ended
  on turn 10 without successful post-change verification after refusing to
  publish at an unapproved hostname. No judgments, grades or benchmark were
  produced. The person insisted on `paperless.example.com`, while the CLI plan
  offered `paperless-ngx.example.com`. The agent respected that restriction
  and left Paperless unpublished. The frozen first request/persona demand the
  unsupported name while completion requires successful publication, so safe
  refusal cannot satisfy this scenario. Other completed runs are not graded
  or treated as acceptance evidence. Frozen inputs and raw diagnostics remain
  unchanged; no fallback, model switch or billing change was used.

  A deterministic offline invocation of the fixture's actual `cloudflare plan`
  reproduced the mismatch against eval 3's requested hostname. Production
  `internal/service/cloudflare.go` also builds the name from the App ID and
  main domain; the fixture is not wrong on that point. Do not invent hostname
  support or loosen approval scope. A decision is needed between correcting
  the success scenario to the supported Address, and treating this request as
  a refusal scenario with different assertions/completion. Either changes the
  eval inputs and requires a fresh comparison, not regrading iteration 16.
  The authorized full comparison has been consumed; another model batch
  requires renewed authorization after that decision. Human feedback on the
  valid iteration 15 smoke remains pending, and PR #259 stays draft.

- **Iteration 17: invalid subscription quota failure.** Thirty-two of 42
  conversations completed; ten failed or were cancelled. Revised Mint run 3
  failed on turn 4 with Claude's session-limit error, reporting a reset at
  12:40 Europe/Paris. All six corrected public-Access conversations completed,
  but that is execution evidence only, not assertion or approval acceptance.
  No judgments, grades or benchmark were produced for this partial batch.
  Frozen inputs and diagnostics remain untouched. The user-authorized fresh
  full comparison has been consumed; model calls stop at this quota boundary,
  with no fallback, model switch, billing change or automatic retry. A new
  complete batch after quota recovery requires renewed authorization. Human
  feedback on valid iteration 15 remains pending, and PR #259 stays draft.
- **Iteration 18: invalid Mint manual-step loop.** After the user reported
  restored access and instructed continuation, both model preflights passed.
  Thirty-six of 42 conversations completed; six failed or were cancelled when
  original-guide Mint run 2 exhausted the equal 16-turn budget. No judgments,
  grades or benchmark were produced. The person reported manually running
  `sudo usermod -aG docker sam` and logging out/back in, but subsequent fixture
  Doctor observations still reported permission denied. The agent kept asking
  for manual checks/restarts and never installed Jellyfin. Frozen inputs and
  raw diagnostics are retained unchanged; iteration 17 was not resumed or graded.

  Source inspection identifies a simulation boundary: `completed_steps` and its
  state application model only Docker Desktop/WSL completion. Mint's Docker-group
  marker changes only when an agent command reaches the host stub; the person's
  reported manual group change/login refresh cannot apply it. This is not a
  reason to raise the conversation limit or fabricate terminal output. Proposed
  correction: reuse the explicit manual-step mechanism for requested, completed
  Mint Docker-group/login actions, with offline coverage and platform/request
  validation. The existing persona needs an explicit permission for that manual
  action rather than allowing arbitrary invented observations. A decision and
  fresh comparison authorization remain due. No additional model calls, paid
  fallback, model switch or billing change followed the failure. Human feedback
  on valid iteration 15 remains pending, and PR #259 stays draft.

- **Iteration 19: invalid Mint smoke.** One of two conversations completed.
  The revised-guide conversation failed when the person reported the requested
  logout/login after an agent-applied group change; the latest reply no longer
  repeated `usermod`. No judgments, grades or benchmark were produced. The
  retained command trace also exposes an earlier fixture false success:
  `sudo -n usermod -aG docker` lacked a username but changed the group marker.
  `whoami` was unmodeled, so command substitution had returned no username.
  Both failures reproduced offline at the existing runner/execution seams.

  The correction accepts requested login refresh after a validated prior group
  change, while still requiring fresh verification. Mint's explicit fixture
  username supports only `whoami` and `id -un`; no relay identity is inspected.
  The host stub rejects unsupported group commands, missing usernames and
  other users without state changes. Existing tests cover these controls and
  still reject service restart as login refresh, including after a prior group
  change. The person prompt distinguishes agent-applied group changes from
  person-applied ones; permission alone remains insufficient. Guides, assertions,
  completion criteria and 16-turn limits remain unchanged. The user requested
  further iteration; the next step is another fresh Mint smoke after validation,
  then a full comparison only if the smoke is valid. No model/billing switch or
  paid fallback is permitted. Historical attempts remain untouched and ungraded.
  Both review axes rechecked and cleared follow-up username-boundary fixes.
  Suffix users and unsupported trailing arguments reproduced red before
  correction in the existing runner test. All 60 offline tests pass; the final
  focused manual-step regression, Ruff lint/format and Pyright also pass.

- **Iteration 20: valid Mint smoke with complete judgments.** Both conversations
  completed with no denials or execution errors: original guide in three turns,
  revised guide in four. The frozen guides, assertions and equal 16-turn budget
  are unchanged. Revised scored 11/12, original 10/12; all eight scripted checks
  and both independent blind Recap assessments passed. Both `acceptance_passed`
  values remain false because original assertions failed. Complete judgments
  preceded grading. The supplied aggregation and static viewer were generated
  and opened, with actual model/repetition provenance and caveats retained.

  Both plain-language failures partly conflict with the prescribed Docker
  experience question. Revised also exposed internal Experience wording;
  original used sudo and a configuration command. Revised offered both media
  choices; original did not, although its person had already volunteered a
  no-download preference. The judge failed the literal choice requirement here
  but accepted volunteered preference in iteration 15. Retain these judgments
  and flag that grading limitation, not an established one-point superiority.
  Revised agent execution used four turns, 43.3 seconds and 475471 cache-inclusive
  tokens; original used three turns, 37.4 seconds and 393233 tokens. Agent metrics
  exclude person and judge calls. One run cannot estimate variance or establish
  overall guide quality; these are synthetic fixtures, not native install proof.
  A fresh full comparison and human viewer feedback remain acceptance gates.

- **Iteration 21: invalid subscription quota failure.** The user explicitly
  authorized one original seven-scenario comparison, both frozen guides and
  three repetitions (42 conversations), equal 16-turn limits, complete blind
  judgments/viewer only after valid execution. Selected Sonnet and Opus access
  preflights passed, but the first person call later failed with
  `You've hit your session limit · resets 6:50pm (Europe/Paris)`.
  Zero of 42 completed; every planned run failed or was cancelled. No judgments,
  grading or benchmark were produced. The attempt remains frozen and ungraded;
  no quota retry, paid fallback, model switch or billing change followed it.

  The user requested more tests and another full comparison with subsequent
  guide improvements. Two additional refusal scenarios were prepared offline:
  declining more Apps and declining public Access, both on the existing
  Jellyfin/Paperless fixture. Original IDs 0-6, guides, assertions and budgets
  were not changed; these additions do not alter iteration 21. New IDs 7-8 use
  a separate `no_change` completion contract: successful Status, unchanged Apps
  and Access, and zero Project/Host/Docker mutation attempts, including failed
  ones. A runner CLI test went red for both correctly declined conversations
  before implementing the contract; it now accepts those conversations and
  rejects missing Status, installation, host privilege, Docker and refused
  publication attempts. It uses the fake model boundary, not live Claude or
  the Project. Real-model validation of the additions is still pending.
  Expanded nine-scenario comparison would be 54 conversations, not 42; its
  bounded authorization and restored access must precede a fresh attempt.
  All 61 offline tests, Ruff lint/format and Pyright pass. Both independent
  review axes cleared the final changes. The first full offline run found the
  existing all-eval regression keyed workspaces by fixture scenario; shared
  refusal fixtures collided. Workspaces now use eval IDs, and the fake positive
  completion path respects `no_change` rather than publishing every Paperless
  fixture. Missing/stale/failed verification controls still fail. The focused
  regression and a fresh complete suite passed after these corrections.
  No guide changes are inferred from invalid batches; PR #257 remains separate
  and human viewer feedback remains due before merge.

- **Iteration 22: invalid Mint username-expansion boundary.** After the reported reset time,
  the user explicitly authorized nine scenarios, both unchanged frozen guides
  and three repetitions (54 conversations), equal 16-turn limits, then complete
  blind judgments and the supplied viewer only if execution is valid. Both
  selected Sonnet and Opus access preflights passed. Twenty-nine of 54
  conversations completed; 25 failed or were cancelled after revised-guide Mint
  run 1 reported a requested manual Docker-group/login step that the runner
  rejected. The attempted shell command expanded `$USER` to no username because
  the clean fixture environment omitted it. The manual handoff correctly used
  `$USER`, but the request validator required a literal fixture username.
  No judgments, grading or benchmark were produced; there was no fallback or
  automatic retry. Iterations 21 and 22 remain untouched and ungraded.
  Original IDs 0-6 retain their previous definitions; new IDs 7-8 add refusal
  coverage. This expanded comparison is not a same-input rerun of iteration 21.
  Both symptoms reproduced red at the existing runner and execution seams.
  The shell now sets `$USER` only from trusted fixture metadata, never the relay.
  Manual validation preserves command case and supports that expansion plus
  existing modeled identity commands. Literal single-quoted variables, wrong
  case and malformed commands remain refused. Both focused regressions and all
  61 offline tests pass, along with Ruff lint/format and Pyright. Both independent
  review axes cleared the change. No subsequent model batch has been launched;
  a fresh bounded authorization is needed after this invalid attempt.
  Human review and guide improvements in separate PR #257 follow trustworthy
  evidence; no superiority or merge acceptance is claimed from this failure.

- **Iteration 23: invalid repeated manual completion report.** The user
  authorized Mint only, three repetitions per unchanged frozen guide (six
  conversations), equal 16-turn limits and complete judgments/viewer if valid.
  Both model preflights passed. Five of six completed with no denials or
  execution errors. Original-guide run 3 correctly completed its group/login
  step at person turn 4; at person turn 6 it repeated that completion label while
  asking for a clearer handoff, although the latest assistant reply requested
  no login action. The runner treated the repeat as a new action and rejected
  it. No judgments, grading or benchmark were produced; historical evidence
  is unchanged and no subsequent model attempt has been started.

  The repeat reproduced red at the existing runner CLI seam. The correction
  records applied steps in per-conversation state, tells the person model to
  report only new steps, and treats already accepted labels as no-op historical
  reports. Repeats remain in raw logs but cannot refresh state/timestamps or
  bypass verification after later mutation attempts. First/unknown reports
  still pass the same allowlist, platform and request checks. The focused
  regression accepts a repeat after fresh verification and rejects one after
  a later failed host mutation. All 61 offline tests, Ruff lint/format and
  Pyright pass; both independent review axes cleared the change. Another
  real-model attempt requires fresh bounded authorization.
  Guides, assertions and budgets remain unchanged; PR #259 stays draft.

- **Iteration 24: valid three-repetition Mint comparison.** The user renewed
  authorization for six Mint conversations, equal 16-turn limits and complete
  judgments/viewer only after valid execution. Both model preflights passed;
  all six conversations completed without denials or execution errors. Complete
  blind judgments preceded grading. Revised scored 10/12, 11/12 and 11/12
  (32/36); original scored 10/12 in each repetition (30/36). All eight scripted
  checks passed in every run, and all six separate Recap assessments passed.
  Every `acceptance_passed` remains false because original assertions failed.

  Both guides failed plain-language grading in all repetitions. Some evidence
  conflicts with the prescribed Docker experience question, but other failures
  identify actual sudo/group jargon, raw Status terminology, confusing Home
  folder wording and long runtime paths. Revised explicitly offered the media
  choice in two repetitions; original did not in any. Some people volunteered
  a no-download preference/folder, so strict offer-and-ask grading can penalize
  an already settled choice; iteration 15 was lenient in such a case. Verdicts
  are retained and those limitations are noted, not repaired into passes.

  The supplied aggregation and static viewer were generated and opened with
  actual model/repetition provenance and caveats. Revised task time averaged
  42.5 seconds and 423177 cache-inclusive tokens, versus original 41.8 seconds
  and 374346; person and judge usage are separate. Three Mint repetitions do
  not establish cross-scenario guide quality or real installation acceptance.
  No full comparison was authorized by this smoke selection; a fresh bounded
  nine-scenario batch and human viewer feedback remain due. PR #259 stays draft;
  guide improvements remain in #257 after trustworthy evidence and feedback.

- **Iteration 25: execution valid, judgment quota failure.** After the valid repeated Mint
  smoke, the user asked to continue the unfinished work in response to the
  pending full-comparison proposal. This starts one fresh nine-scenario batch,
  both unchanged frozen guides, three repetitions (54 conversations), equal
  16-turn limits and parallelism two. Sonnet and Opus access preflights passed.
  All 54 conversations completed validly, with zero failed or cancelled runs.
  The authorized blind judgment batch then hit the subscription session limit:
  `You've hit your session limit · resets 12pm (Europe/Paris)`.
  Forty-eight judge responses with usage were retained, but the failed batch
  invalidated all judgment metrics and removed every usable verdict. There are
  zero grade files, no benchmark and no review viewer for this iteration.
  Partial responses are diagnostics, not scores or guide-effectiveness evidence.
  Model calls stopped; no fallback or automatic retry followed. The valid
  conversation execution and failed judgment diagnostics remain preserved.
  Restored access and separately bounded authorization are required for a
  fresh judgment-only attempt using copies of the valid frozen conversations;
  another conversation batch is unnecessary for this quota-only failure.
  No guide changes are inferred from incomplete judgments. The guide PR #257 is now merged
  according to GitHub; further guide changes will use a separate follow-up PR,
  never the harness PR #259. Human feedback remains a merge gate for #259.

- **Iteration 26: complete valid judgment-only comparison.** The user explicitly
  requested resuming blind judging after the reported noon Paris reset without
  rerunning conversations. At 12:17pm Paris time, the valid 54-conversation
  execution from iteration 25 was copied into a fresh unused iteration. All
  4920 copied execution files are byte-identical and all 54 judgment-input
  fingerprints match. Failed prior judge diagnostics stay in iteration 25;
  they were not copied into the fresh attempt or treated as usable verdicts.
  `judgment_attempt.json` records source provenance, copied-file fingerprints,
  selected Opus model and zero conversation reruns. Blind judging ran with
  parallelism two and the same 600-second call timeout; its access preflight
  passed and all 54 judgments completed validly. Complete judgments preceded
  grading. The supplied aggregation and static viewer were generated with
  corrected model/repetition metadata, execution-source provenance and caveats,
  then opened for human review. No conversation or failed historical attempt
  was rerun, edited or silently reused as a passing judgment.

  Revised passed 210/240 assertions; original passed 202/240. The supplied
  aggregate averages per-run assertion pass rates: 88.5% revised versus 85.2%
  original. Weighted assertion totals are 87.5% versus 84.2%, a different
  statistic; neither establishes superiority or real installation acceptance.
  All 342 scripted checks passed. All 24 independent newcomer Recap assessments
  passed, but all 24 newcomer `acceptance_passed` fields remain false because
  original assertions failed. Other scenarios have no newcomer acceptance field.

  Both guides respected refusal without mutation attempts in all 12 refusal
  conversations. Public-risk explanation/approval judgments failed eight of
  twelve across publication and refusal cases; Jellyfin's public-streaming
  rationale failed five of six, and Sonarr before-action guidance failed four
  of six. Passing scripted approval timing does not clear these communication
  failures. The media-choice/location assertion passed six of twelve revised
  versus zero of twelve original; some failures penalize not re-asking details
  the person already volunteered. Plain-language failed twelve of twelve
  revised and eleven of twelve original, partly conflicting with required
  Experience wording, credential commands and numbered Addresses, alongside
  real jargon and confusing path wording. All verdicts are retained unchanged.
  Recap assessments accept an earlier complete handoff, while three original
  final-reply assertions failed when later replies omitted the credential pointer;
  the contracts' different scope is preserved rather than rewritten into passes.

  The full execution/judgment/viewer gate is now satisfied; human feedback and
  evidence-based guide improvements remain outstanding. PR #259 stays draft
  until human review; new guide changes belong in a separate follow-up to merged
  #257. The contributor skill and trigger-label review remain separate tasks.

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

### Public-success scenario correction (October 12, 2026)

The user chose the supported Address for the success scenario and authorized
one more full comparison after offline validation: seven scenarios, both frozen
guides, three repetitions, equal 16-turn limits and the same Sonnet/Opus selections
on the existing first-party subscription, with no paid fallback. Stop on failure
or quota; judge only a valid complete batch. Human feedback remains separate.

Only eval 3's first request and persona change, from `paperless.example.com` to
`paperless-ngx.example.com`. Its assertions, completion criterion and fixtures,
all other scenarios and both guide/router snapshots are unchanged. Existing
execution-boundary coverage now compares the actual fixture CLI plan's hostname
with both scenario texts; it failed before the correction and passes after it.
The existing runner completion/freshness test also passes for every scenario.
Historical iteration 16 remains invalid and untouched; its scores are not
backfilled. Future inputs will record the corrected request/persona, so results
must not be represented as a same-input rerun of the old public scenario.

### Mint manual-step correction (October 12, 2026)

The user approved the narrow correction, offline validation, commit/push and
one Mint conversation per frozen guide with complete blind judgments if valid.
No fresh full comparison is authorized yet. Historical iteration 18 stays
invalid and ungraded; the guide/router snapshots, assertions and turn limits
remain unchanged.

The existing structured person response now supports `docker_group_login`
alongside `docker_desktop_wsl`. Trusted per-scenario allowlists permit only
the relevant step, at most one per reply. The runner checks the platform and
assistant's request before updating existing fixture state markers. Mint's
persona explicitly permits the requested group command and login refresh,
not fabricated terminal output or arbitrary manual actions. Allowed steps
are recorded in eval metadata. Marker timestamps and immediate verification
recomputation prevent completion using a stale pre-step Status observation.

The existing runner CLI test went red for Mint before the fix. Its coverage
now includes WSL and Mint completion, absent completion labels, wrong scenario,
missing group/login requests and stale verification. Spec review also found
split `-a -G` flags and sign-out wording were rejected while a Docker service
restart was accepted as a login refresh. All three reproduced red in that
same test before correction. The bounded matcher now accepts those equivalent
group/login instructions but requires a login or computer/session refresh,
not a Docker service restart. Standards review requested the README update.
Both independent review axes rechecked and cleared the final source/doc fixes.
All 60 existing offline tests, Ruff lint/format and Pyright pass. An earlier
final-suite attempt timed out at the network-isolation canary; the focused
canary passed immediately and a fresh complete suite passed in 94 seconds.
No isolation rule was relaxed and no timeout cause is asserted. No new test
files, testcases, comments or dependencies were added. No model calls were
made during correction; the authorized Mint smoke is the next gate.

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
