# self-host skill eval harness

Measures whether the `self-host` skill makes an agent better at self-hosting,
using the `skill-creator` loop: run with and without the skill, grade, review in
its viewer, improve, rerun.

## What is under test

The path a real person takes: they describe a goal in their own words, the
router (`skills/self-host/SKILL.md`) has to trigger on it, and the guide it hands
off to (`internal/skill/guide.md`, printed by `self-host skill`) has to steer the
agent through inspect, plan, approval, apply, verify.

- Evals 0 and 4 to 6 never name `self-host`, so they test the router's trigger
  and the guide on macOS, Debian, Linux Mint and Windows with WSL.
- Evals 1 to 3 say the Apps were set up with `self-host` (the router's
  description covers "anything already set up with self-host"), so they mostly
  test the guide.

## How a run works

`run.py` runs each eval as a real `claude -p` conversation:

- **Workspace separation.** Each run's working directory is an empty folder under the
  workspace (default `~/.cache/self-host-skill-evals`), outside the repository,
  so no AGENTS.md, CLAUDE.md, guide file or fixture is in reach. `with_skill`
  copies the router into the sandbox's `.claude/skills/`; `without_skill` copies
  nothing. Only project settings load (`--setting-sources project`); strict MCP
  configuration loads only the harness's `ask_user` server. Built-in Claude
  tools, plugins and system context can still be present.
- **Stubs.** `bin/self-host` replays `scenarios/<name>/`; `bin/docker` pretends
  to be an empty engine. Both log every call with its turn.
- **Guard.** Claude's Bash replays the tester's shell snapshot, so PATH and HOME
  would reach the real binary and `~/.self-host`. The sandbox's project settings
  install `bin/guard.py` as a PreToolUse hook: it rewrites every Bash command to
  run under `env -i` with a fake HOME and a PATH of only the stubs and system
  directories, refuses commands naming the real home, and denies file tools
  outside the workspace. This is a hook, not OS-level isolation: system
  executables remain available and it does not guarantee filesystem or network
  containment. Run task evals only on a disposable machine without a live
  Project or credentials. Do not treat this harness as safe for a normal host.
- **Turns.** The first request is fixed. A separate, tool-free model then plays
  the person from recorded facts, answering the agent's actual questions. Its
  reply is sent with `--resume`, for up to eight turns. `raw/person.jsonl`
  records replies and approval flags; these are model-generated labels, not
  independently verified proof that each later action had appropriate approval.
- **Platforms.** Stub host tools simulate OS details and installer commands.
  Drive folders are mapped into the workspace. These are fixture scenarios,
  not installation proofs on those operating systems.
- **Validity.** Model access is checked before a batch. Failed, quota-limited
  or empty model calls invalidate the run; malformed person replies and judge
  verdicts are errors, not silent completion or failed assertions. The batch
  exits non-zero, cancels pending runs, and records `execution.json`. Both
  grading commands reject invalid or incomplete execution. `checks.py` also
  requires every judge assertion to have a complete verdict. Use a new
  iteration number for every attempt; existing evidence is not overwritten.
- **Ground truth.** Scripted checks read the stubs' logs and the agent's actual
  replies, never a transcript the agent wrote about itself. Judge checks see
  only the replies and the command list, blind to the configuration.

## Running an iteration

```bash
set -euo pipefail
cd evals/self-host
W=~/.cache/self-host-skill-evals/iteration-4
python3 run.py --iteration 4                  # 7 evals x 2 configs x 3 runs
python3 judge.py --iteration-dir "$W"
python3 checks.py --iteration-dir "$W"

SC=~/.claude/skills/synced/*/skill-creator    # needs Python 3.10+
(cd $SC && python3.12 -m scripts.aggregate_benchmark \
   "$W" --skill-name self-host)
python3.12 $SC/eval-viewer/generate_review.py "$W" \
  --skill-name self-host \
  --benchmark "$W/benchmark.json" \
  --static "$W/review.html"
```

To compare an edited skill or guide against the current one, snapshot first and
name both configurations; the first is the one under test:

```bash
cp -r ../../skills/self-host /tmp/self-host-old
cp ../../internal/skill/guide.md /tmp/guide-old.md
python3 run.py --iteration 3 --configs \
  new_skill=skills/self-host old_skill=/tmp/self-host-old:/tmp/guide-old.md
```

`--model` picks the agent under test (default `claude-sonnet-5-5`);
`--person-model` selects the simulated person (same default). `judge.py`
defaults to `claude-opus-5-5`. Agent timing and tokens exclude simulated-person
calls; their usage and cost are recorded separately in `raw/person.jsonl`.

## Inspecting what happened

Start with [PROGRESS.md](PROGRESS.md) for the current scope, evidence and remaining
work. At the iteration root, `run_config.json` records the agent and person
models, selected evals, repetitions, parallelism, timeout and start time;
`execution.json` says whether the entire batch is valid.

Each `eval-*/<configuration>/run-*` contains:

| File                                        | What to inspect                                                                           |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `eval_metadata.json`                        | Request, simulated-person facts, turn limit and assertions shown in the viewer            |
| `raw/inputs.json`                           | Scenario and SHA-256 fingerprints of the copied guide and router; absent router is `null` |
| `raw/turn-N.jsonl`                          | Actual Claude stream: tool calls, results, model usage and errors                         |
| `raw/invocations.jsonl`                     | Stub `self-host` calls with arguments, timestamps and turns                               |
| `raw/docker.jsonl`, `raw/host.jsonl`        | Stub engine and host-tool calls, when used                                                |
| `raw/ask.jsonl`                             | Questions and clickable options, when used                                                |
| `raw/person.jsonl`                          | Simulated replies, approval labels, usage and cost                                        |
| `raw/metrics.json`                          | Execution validity, errors, permission denials and agent usage                            |
| `outputs/conversation.md`                   | Readable conversation including tool calls and results; long tool output is truncated     |
| `outputs/replies.md`, `outputs/commands.md` | Material given to the blind judge                                                         |
| `judged.json`, `grading.json`               | Judge verdicts, scripted checks and their evidence                                        |
| `timing.json`                               | Agent-only duration, tokens including cache usage, and reported cost                      |

Follow a turn from the request to `raw/turn-N.jsonl`, then compare its tool call
with the timestamped stub log. Judge evidence is interpretation; command logs
only prove a simulated command ran, not that a real App works. Judge usage and
cost are not currently recorded. Fingerprints identify the inputs but do not
freeze the scenario fixtures, which remain linked to the checkout.

Raw logs are private development artifacts, not automatically redacted reports.
Keep them outside Git; inspect and redact before sharing. Only synthetic
credential sentinels belong in fixtures.

Iteration 3 is invalid: all 42 runs hit the five-hour quota before generating
output. Its benchmark and review are retained as failed-attempt artifacts,
not a comparison of the guides. Iteration 2 used different scenarios and
scripted replies, so its percentages are not directly comparable with later
persona-driven iterations.

## Triggering

The task evals above can't say how often the description fires across varied
wording. That is skill-creator's description loop (`scripts/run_loop.py`) with
the query set in `evals/trigger-queries.json`.

## Scenarios

- `newbie-install`: shared no-Project catalog fixtures.
- `newbie-macbook`: macOS, Docker missing.
- `newbie-debian`: Debian server, Docker missing.
- `newbie-mint`: Linux Mint, Docker socket permission denied.
- `newbie-wsl`: Windows with WSL, Docker missing.
- `cant-reach-tv`: Project exists, stored LAN IP is stale.
- `failed-setup`: install finished with a failed Setup step on Sonarr.
- `public-access`: expose a media App and a document App publicly.
