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

| Gate                                                                   | Status                                                             |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Runner CLI saves frozen inputs, streams and failure diagnostics        | Regression tests pass                                              |
| Grading rejects missing manifests, unknown checks and failed judgments | Regression tests pass                                              |
| Shell boundary blocks host reads/writes/execution and network access   | macOS canary tests pass                                            |
| Real CLI discovers the router in router-present configurations         | Observed; missing discovery now invalidates execution              |
| Claude transport and shell use no bypassPermissions                    | Implemented; fail-closed hooks require CLI 2.1.295+                |
| Local build, vet, tests, race checks and installer syntax              | Passed                                                             |
| Complete real-model batch with both guides and three repetitions       | Iteration 10 invalid; fresh smoke needed after fixture corrections |
| Complete blind judgments, aggregation and supplied review viewer       | Smoke complete; full batch and human feedback pending              |
| Independent Standards and Spec review                                  | Fixture fixes reviewed; combined release-audit review pending      |

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
59 regressions. A fresh smoke comparison and combined independent review are
required before the full batch can establish acceptance.

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
