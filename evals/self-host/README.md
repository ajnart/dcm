# self-host skill eval harness

Evaluates fixture conversations with and without the `self-host` skill, using
the `skill-creator` loop: run, grade, review in its viewer, improve, rerun.
A complete valid comparison is recorded in iterations 25 (execution) and 26
(fresh blind judgments). Human review is still pending; this is not real App
installation evidence.

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
- Evals 7 and 8 cover refusing additional App installation and refusing public
  Access on an existing Project. They reuse the existing two-App fixture and
  must preserve its Apps and Home network Access. Their `no_change` completion
  requires successful Status with unchanged Apps/Access and no Project, Host or
  Docker mutation attempts, even failed ones. Read-only plans are allowed; saving
  the non-secret Experience level remains outside Project/Host approval checks.
  Refusal wording and pressure are judged separately from CLI observations.
  Both cases completed real-model fixture conversations in iteration 25 and
  complete blind judgments in iteration 26. Refusal was respected in all runs;
  public-risk explanations still failed in five of six refusal conversations.
  The original comparison selects `--evals 0,1,2,3,4,5,6` (42 conversations at
  three repetitions and two guides); including 7 and 8 would be 54 and requires
  a separately bounded authorization. Defaults are not permission to expand.

## How a run works

`run.py` runs each eval as a real `claude -p` conversation:

- **Workspace separation.** Each run's working directory is an empty folder under the
  workspace (default `~/.cache/self-host-skill-evals`), outside the repository,
  so repository instructions are not discovered. `with_skill`
  copies the router into the sandbox's `.claude/skills/`; `without_skill` copies
  nothing. Only project settings load (`--setting-sources project`); strict MCP
  configuration loads only the harness's `ask_user` server. Built-in Claude
  tools are limited to Bash, Read and Skill; bundled skills are disabled.
- **Stubs.** `bin/self-host` replays `scenarios/<name>/`; `bin/docker` reports
  the same recorded Apps for read-only inspection. Single-App installs have
  matching event labels, Recipe selection and credentials. Credentials keep the
  real CLI's App-ID-keyed maps of secret names to strings; Debug reports keep
  the real health-check object. Retrying Sonarr Setup retains the other Apps
  and updates its Status and Debug report without changing the installed selection.
  The synthetic public-Access scenario remembers successful publication and
  reports the same selected App/domain in Status, Addresses and later plans;
  refused or failed publication does not change that state. Unsupported public
  selections remain refused, not a general Cloudflare emulator.
  The public-success scenario requests `paperless-ngx.example.com`, matching
  the production CLI's App-ID-based hostname rather than an unsupported alias.
  The reported Home folder exists only
  inside the run's sandbox. Both tools log every call with its turn.
  Runtime folders use random identifiers so paths in Recaps and commands do
  not reveal the guide configuration to the blind judge.
- **Guard.** Claude's Bash replays the tester's shell snapshot, so PATH and HOME
  would reach the real binary and `~/.self-host`. The runner passes external
  settings containing a fail-closed PreToolUse hook. It rewrites
  every Bash command to run under `env -i` and macOS `sandbox-exec`, with a fake
  HOME, fixture PATH, writable working folder and fixture state, read-only
  runtime/fixture files, and no network access.
  Fixture shebangs resolve Python directly from Command Line Tools, avoiding
  macOS's developer-selection launcher without widening metadata permissions.
  A trusted synchronous relay drains isolated stdout/stderr through pipes before
  forwarding to Claude's output files; it preserves exit status and never reopens
  agent-writable capture paths outside isolation. Fixture symlink roots and their
  canonical ancestors have literal metadata permission, not broad host access.
  Absolute host installer, remote shell and macOS automation tools are refused,
  not dispatched by the stubs.
  Read is limited to the working folder and the current session's tool-results
  folder; other tools and background Bash requests are refused. No
  `bypassPermissions` is used. The Claude transport itself is not OS-sandboxed:
  it still needs authentication and network access. This is a fixture evaluation
  boundary, not a general sandbox for hostile code; use a disposable account
  or machine when evaluating untrusted skills. Fixture state/logs remain writable
  by shell children, so this is not tamper-proof grading against a hostile agent.
  The only evaluated router is the trusted project-local `self-host` skill.
- **Turns.** The first request is fixed. A separate, tool-free model then plays
  the person from recorded facts, answering the agent's actual questions. Its
  reply is sent with `--resume`, for up to the scenario's turn limit (eight by
  default). `--max-conversation-turns` overrides it equally for all configurations
  and records the budget in metadata. Reaching it unfinished invalidates the
  batch rather than silently completing. `raw/person.jsonl`
  records replies and approval flags; these are model-generated labels, not
  independently verified proof that each later action had appropriate approval.
  Question options retain both labels and descriptions in the conversation
  given to the simulated person and blind judge.
  Completion criteria are recorded per scenario and given to the person with
  the last successful CLI Status observation. A person's `done` cannot bypass
  missing, failed or stale verification after a change. It never passes an
  assertion: Recap quality, approval and guide failures still require grading.
  Freshness includes recorded host and Docker mutation attempts classified by
  the existing grading checks, even when they failed; a later successful Status
  observation is required. Read-only fixture observations do not stale it.
- **Platforms.** Stub host tools simulate OS details and installer commands.
  Drive folders are mapped into the workspace. These are fixture scenarios,
  not installation proofs on those operating systems. A schema-validated
  `completed_steps` label lets the simulated person finish a permitted manual
  action after the assistant requests it: Docker Desktop with WSL integration,
  or Mint's Docker-group command followed by logout/login or a computer/session
  restart. The scenario allowlist, platform and request must match; restarting
  the Docker service is not a login refresh. Saying yes alone changes nothing.
  If the agent already applied a validated group change, the person may finish
  only the requested logout/login. Mint's username is fixture metadata:
  `whoami` and `id -un` return it, never the relay identity.
  `$USER` is also set from that metadata inside the isolated shell. Manual
  instructions may use that variable or the supported identity commands;
  their case and quoting must preserve expansion, not a literal `$USER` name.
  Docker-group commands without that username or with unsupported arguments
  fail without changing fixture state; other identity/group observations remain
  unmodeled.
  Only fixture Docker state changes, never the relay machine. Marker timestamps
  require fresh CLI verification after completion; prior Status cannot finish
  the goal. These labels are synthetic person reports, not real host proof.
  Applied steps are tracked per conversation and supplied to the person model.
  An already recorded label is idempotent: it is retained in raw evidence but
  does not update state or marker timestamps again. A first report still needs
  the allowlist, platform and request checks; repeats cannot bypass later
  mutation/verification checks or make an unknown step valid.
  Newcomer media folders contain no pretend movie payloads. The existing
  platform fixtures declare metadata-only names and sizes; bounded `ls` and
  size-only `stat` calls report those values, explicitly labeled synthetic.
  File formats, scans, playback, capacity and device/network probes are not
  modeled and are refused, rather than answered from the relay machine.
  Absolute probe binaries are denied, broad `sysctl-read` is removed, and
  metadata reads outside the runtime/working paths and their literal ancestors
  are denied. This is still not a general machine emulator or hostile-code VM.
- **Validity.** Model access is checked before a batch. Failed, quota-limited
  or empty model calls invalidate the run; malformed streams, person replies and judge
  verdicts are errors, not silent completion or failed assertions. The batch
  exits non-zero, cancels pending runs and active model calls, and records
  `execution.json`. Each model process owns a process group; its remaining
  children are killed before artifacts are collected, also on timeout. This
  includes SIGINT/KeyboardInterrupt and SIGTERM: cancellation is signaled and
  queued futures are cancelled before executor shutdown waits. Interrupted
  execution and judgments stay invalid, with partial stdout/stderr retained.
  Only process groups launched by this invocation are terminated.
  This does not establish containment of hostile code that deliberately detaches.
  Both
  grading commands reject invalid or incomplete execution, including positional
  run arguments belonging to a failed batch. `checks.py` also
  requires every judge assertion in the batch to have a complete verdict,
  even for positional run arguments. Regrading invalidates old score files
  before validation; a failed judge preflight cannot reuse old verdicts.
  Judgments are tied to hashes of their assertions and conversation inputs.
  New batches record `judgment_schema: 2`. All four newcomer scenarios require
  a separate blind `completion_assessment` of the Recap in the same judge call,
  including WSL. It checks every installed App's purpose and Address, the Home
  folder and the credential pointer without secrets, against a filtered verified
  CLI inventory. The criterion and inventory are part of the judgment fingerprint.
  Missing or malformed assessments, criteria or inventories invalidate grading;
  a negative assessment is a recorded failure, not an invalid model response.
  The original assertions, counts and assertion-only pass rates remain unchanged.
  `grading.json` adds the assessment and `acceptance_passed`; a failed Recap also
  appears in viewer review notes. Assertion-only aggregates do not establish
  completion acceptance. Historical batches without the new schema retain
  their previous judgment contract; this does not regrade historical evidence.
  Older judgments without these fingerprints must be judged again, not
  backfilled by hand. Use a new
  iteration number for every attempt; existing evidence is not overwritten.
  A router-present run must advertise `self-host` in the real CLI init event;
  a no-router baseline must not. Both configurations use batch-frozen guides,
  routers, fixtures and stubs, not live checkout links.
- **Ground truth.** Scripted checks read the stubs' logs and the agent's actual
  replies, never a transcript the agent wrote about itself. Judge checks see
  the replies and the command list, blind to the configuration. Newcomer Recap
  assessment also sees the verified App inventory and Home folder, not secrets
  or guide/configuration labels. Neither the person saying `done` nor the CLI
  inventory substitutes for an adequate handoff in the assistant's actual replies.

## Running an iteration

Requires macOS with `sandbox-exec` and Command Line Tools Python, Claude Code
2.1.295+ (fail-closed hooks), and access to both selected models. Other runtime
hosts are refused; Debian, Mint and WSL are simulated platforms, not native runs.

Offline regression gate (no model calls or Docker):

```bash
python3 -m unittest discover -s evals/self-host/tests -v
ruff check evals/self-host evals/self-host/bin/{docker,hosttool,self-host} --select E,F,I
ruff format --check evals/self-host evals/self-host/bin/{docker,hosttool,self-host}
uvx pyright evals/self-host evals/self-host/bin/{docker,hosttool,self-host}
```

The following commands consume model usage, including preflight. Obtain an
explicit bounded authorization for the selected scenarios, repetitions, turn
limits and spend before running them; the defaults are not approval.

```bash
set -euo pipefail
cd evals/self-host
W=~/.cache/self-host-skill-evals/iteration-9
python3 run.py --iteration 9 --max-conversation-turns 16
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
These model families were listed as active in the connected model catalog on
October 11, 2026; that is not an account-access or quota check. Missing reported
cost stays `null`, not zero; malformed token, duration or cost values invalidate
the call. Total tool calls count stream tool-use events; fixture command calls
are reported separately.
`run.py --timeout` limits each task turn (900 seconds by default),
`--person-timeout` limits each person call (300 seconds), and `judge.py --timeout`
limits each judgment (600 seconds). All must be positive. Partial stdout/stderr
is retained if a call times out; the run or judgment remains invalid.

## Inspecting what happened

Start with [PROGRESS.md](PROGRESS.md) for the current scope, evidence and remaining
work. At the iteration root, `run_config.json` records the CLI version, agent and person
models, selected evals, repetitions, parallelism, timeout and start time;
`execution.json` says whether the entire batch is valid.

Each `eval-*/<configuration>/run-*` contains:

| File                                                                    | What to inspect                                                                               |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `eval_metadata.json`                                                    | Request, simulated-person facts, turn limit and assertions shown in the viewer                |
| `raw/inputs.json`                                                       | Scenario and SHA-256 fingerprints of the copied guide and router; absent router is `null`     |
| `raw/guide.md`, `raw/router/`, `raw/scenario/`                          | Actual frozen inputs used by this run; scenario symlinks are flattened                        |
| `raw/turn-N.jsonl`                                                      | Actual Claude stream: tool calls, results, model usage and errors                             |
| `raw/turn-N.stderr.txt`, `raw/person-N.json`, `raw/person-N.stderr.txt` | Raw diagnostics retained even when a model call fails                                         |
| `raw/invocations.jsonl`                                                 | Stub `self-host` calls with arguments, timestamps and turns                                   |
| `raw/docker.jsonl`, `raw/host.jsonl`                                    | Stub engine and host-tool calls, when used                                                    |
| `raw/ask.jsonl`                                                         | Questions and clickable options, when used                                                    |
| `raw/person.jsonl`                                                      | Simulated replies, approval labels, usage and cost                                            |
| `raw/metrics.json`                                                      | Execution validity, errors, permission denials, agent usage and verified completion inventory |
| `outputs/conversation.md`                                               | Readable conversation including tool calls and results; long tool output is truncated         |
| `outputs/replies.md`, `outputs/commands.md`                             | Material given to the blind judge                                                             |
| `judged.json`, `grading.json`                                           | Original verdicts/checks; new newcomer grades also carry independent Recap acceptance         |
| `raw/judge.json`, `raw/judge.stderr.txt`, `raw/judge-metrics.json`      | Judge response, diagnostics, model, usage, reported cost and validity                         |
| `timing.json`                                                           | Agent-only duration, tokens including cache usage, and reported cost                          |

Follow a turn from the request to `raw/turn-N.jsonl`, then compare its tool call
with the timestamped stub log. Judge evidence is interpretation; command logs
only prove a simulated command ran, not that a real App works. Judge usage and
cost are recorded separately from agent timing. A failed judge attempt cannot
reuse an older verdict. Approval checks establish order, not authorization scope;
the public-Access check additionally requires a yes after the latest public plan
and matching App/domain selections, including Paperless, for every publication.
Iteration-level `inputs/` retains the shared frozen stubs and source inputs.

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

Newcomer scenarios end at install, actual fixture-CLI verification, and an
adequate Recap: each selected App's purpose and Address, the Home folder and
the credential pointer without secrets. The person declines optional library
or browser follow-ups after that handoff. No browser/native success or failure
is inferred from CLI observations. Both guides retain the same authorized
16-turn conversation budget; unfinished conversations remain invalid.

The other goals have separate verification criteria: the changed Jellyfin
Address after a LAN fix; Sonarr's Setup result after its retry and the described
manual action; Paperless's public Address and Cloudflare Access with Jellyfin
kept private. A generic Recap cannot finish those goals. Manual steps may be
claimed only where the persona explicitly permits them. Original assertions,
guide/router snapshots and historical frozen attempts are unchanged. These
boundary/metadata corrections apply only to a new comparison; paid execution
still requires separate bounded authorization and an enforceable spend cap.

- `newbie-install`: shared no-Project catalog fixtures.
- `newbie-macbook`: macOS, Docker missing.
- `newbie-debian`: Debian server, Docker missing.
- `newbie-mint`: Linux Mint, Docker socket permission denied.
- `newbie-wsl`: Windows with WSL, Docker missing.
- `cant-reach-tv`: Project exists, stored LAN IP is stale.
- `failed-setup`: install finished with a failed Setup step on Sonarr.
- `public-access`: expose a media App and a document App publicly.
