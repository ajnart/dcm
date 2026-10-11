# self-host skill evaluation progress

## What this is

A development harness for improving the operator skill, not another installer
and not the proposed Catalog contributor skill. It evaluates the complete path:

```text
person's request → skills/self-host/SKILL.md → self-host skill
                                               ↓
                                  internal/skill/guide.md
                                               ↓
                          inspect → plan → approval → apply → verify
```

All App operations run against fixtures. The harness uses Claude's `skill-creator`
workflow for a frozen baseline, repeated runs, scripted and blind grading, and
its supplied benchmark aggregator and review viewer. The skill-creator tools
are installed separately; this repository does not vendor them.

## Status: approximately 70%

`[███████░░░]` is a planning estimate, not a measured score or acceptance claim.

| Area                                                        | State                                          |
| ----------------------------------------------------------- | ---------------------------------------------- |
| Router-to-guide execution and command logs                  | Implemented                                    |
| Seven scenarios, including four simulated operating systems | Implemented                                    |
| Multi-turn questions and simulated person                   | Implemented; needs review in a valid batch     |
| Newcomer guide changes                                      | Implemented; effectiveness not yet established |
| Failure rejection and grading validity gates                | Offline replay checks passed                   |
| Local repository validation                                 | Passed before the initial commits              |
| Valid edited-guide versus frozen-guide comparison           | Pending                                        |
| Human review and another improvement pass                   | Pending                                        |
| Router description optimization                             | Query set drafted; not approved or run         |
| Disposable execution environment                            | Required; the hook is not sufficient isolation |
| Catalog contributor skill                                   | Design questions outstanding; not implemented  |

## Evidence ledger

- **Iteration 1: invalid.** Agents authored their own transcripts; approval and
  repetition accounting were wrong. Its apparent perfect scores are not evidence.
- **Iteration 2: historical fixture result.** Real CLI streams and command logs
  produced approximately 96% with the skill versus 34% without. This used four
  scenarios and scripted replies. It does not establish real installation success
  or validate the later guide edits.
- **Iteration 3: invalid.** All 42 task runs hit the five-hour Claude quota before
  generating output. The apparent 42.7% score came from grading empty runs and
  must not be used. The harness now rejects this captured failure at execution
  and grading, rather than counting safety checks on empty runs as passes.
- **Offline verification:** captured quota responses invalidate runs and block
  grading; a failed person call raises instead of silently ending; model preflight
  stops before starting a batch. Python syntax, fixture JSON, core Ruff lint,
  formatting and whitespace checks passed. The Go local gate also passed.

Iteration 2 and later persona-driven scenarios are not directly comparable:
the requests, assertions and conversation method changed.

The original guide snapshot matches commit `86246cfe` exactly. Its SHA-256 is
`b6f7e41a27aa706a00dc062c1166ccc7abea5874653f55bd84e3e9cb2fb195c1`.
Recover that baseline from Git rather than depending on another agent's local
cache. The router was unchanged by this PR.

## Changes prompted by review

- Corrected the metadata layout that made the viewer say "No prompt found".
- Added a real question-tool stand-in and clickable experience options.
- Offered Jellyfin alone or the fuller Media Recipe, and asked where files live.
- Removed unnecessary newcomer jargon while retaining prerequisite explanations.
- Added macOS, Debian, Linux Mint and WSL fixture coverage.
- Preserved actual conversations, command logs, questions, approval labels,
  timing, errors and input fingerprints; see the [log map](README.md#inspecting-what-happened).

## Next steps before calling this done

1. Use a disposable environment without a live Project or unrelated credentials.
2. Confirm model access, retain the original guide snapshot, and run a small
   new-guide versus old-guide smoke comparison into a fresh iteration.
3. Complete all seven scenarios, both configurations and three repetitions;
   require successful execution and complete judgments before aggregation.
4. Generate the supplied skill-creator viewer, review real replies and failure
   evidence with the user, then revise the guide only from valid findings.
5. Review trigger-query labels before running description optimization.
6. Confirm contributor-skill boundaries separately before implementing it.

Known limitations: the shell hook is not OS-level containment; fixtures do not
prove native-platform behavior; simulated approval labels do not verify the
scope of every later action; scenario fixtures are not frozen per batch; judge
usage and cost are not recorded. Raw artifacts require review before sharing.
