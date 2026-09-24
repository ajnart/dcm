# Command-first self-host: north star and path

Status: implemented in source, 2026-09-24; client UI behavior and live service
acceptance still require their own evidence. Informed by the
[seven-repository comparison](../research/skill-command-comparison-2026-09-24.md).
This records the product contract, implementation path, and evidence boundary.

## North star

`self-host` is a **user-invoked operator command**. The Agent Skill remains the
portable implementation of that command: it routes one request to one bundled
workflow, which uses bounded scripts and returns evidence. Users should be able
to discover the command, understand its effects, and resume a project without
knowing the internal workflow IDs.

```text
user invocation → client entry point → self-host SKILL.md
                                      ├─ plan: selfhost/GUIDE.md
                                      ├─ setup: selfhost-setup/GUIDE.md
                                      └─ upkeep: selfhost-upkeep/GUIDE.md
                                                    ↓
                                     owned helpers, project state, evidence
```

The command is an instruction entry point. The bundled `selfhost.ts` and other
helpers perform deterministic work. Invoking the command expresses intent; an
apply, public exposure, restore, VPN change, or destructive operation still
needs its existing concrete approval and verification gate.

The first-use path should fit on one screen:

```text
install self-host → invoke self-host plan "replace Google Photos"
→ receive app choices, host facts, open decisions, and a proposed project
→ approve a specific apply step → receive working links and evidence
```

The exact invocation must be documented per host. Pi and OpenCode can expose
`/self-host`. Codex's supported shared-skill route is `$self-host` or the
`/skills` picker; its `/prompts:self-host` bridge is a deprecated, global
custom prompt. A bare `/self-host` in Codex is not a current release promise.
[Codex skills](https://developers.openai.com/codex/skills/),
[Codex custom prompts](https://developers.openai.com/codex/custom-prompts),
[Pi prompt templates](https://pi.dev/docs/latest/prompt-templates),
[OpenCode commands](https://opencode.ai/v2/docs/commands).

## Baseline at the comparison

- The [registry](../.agents/skills/self-host/workflows/selfhost/references/catalog/skills.json)
  called the public router `implicit`; [Codex metadata](../.agents/skills/self-host/agents/openai.yaml)
  allowed implicit invocation. Both are now explicit.
- The bundled [prompt template](../.agents/skills/self-host/commands/self-host.md)
  and [installer](../.agents/skills/self-host/scripts/install-command.ts) are
  initially required a second manual installation step. The root installer
  now registers the command alongside the skill. OpenCode's native skill
  slash entry is disabled so one command file owns `/self-host`.
- The generic release packager strips nonstandard `disable-model-invocation`
  frontmatter from `SKILL.md` entries. The source declares it now; the install
  helper restores it in the Pi copy after packaging. Agent Skills has no
  portable invocation policy, so host behavior still needs direct proof.
- README examples explain goals and installation, but do not yet show one
  complete plan → approval → result transcript with clearly labeled live evidence.

## Implementation evidence

The source and extracted release ZIP passed repository and package validation.
A disposable project installed the ZIP through the root installer using the
Skills CLI 1.7.0 and received Pi and OpenCode `/self-host` command files,
their installed skill paths, all fourteen bundled workflows, and Pi's explicit
invocation field. This proves package layout and argument template rendering.
It does not prove interactive command-menu discovery, model routing, or a
completed service deployment. The default Bun is 1.3.14. A cached Bun 1.4.0
binary reached `bunx`, but package resolution was blocked by DNS in this
environment, so the installer smoke used a temporary launcher for the cached
Skills CLI. The documented `bunx` path still needs a connected Bun 1.4.0 or
newer release check.

## Path

### 1. Lock the command contract

Record an ADR changing the public entry from model-invoked router to
user-invoked command. Define one command name and a small optional verb
grammar:

| Input | Route | Result |
| --- | --- | --- |
| `self-host` | Intake | Ask for an app or replacement goal. |
| `self-host plan <goal>` | Planning | Return choices and a redacted proposed plan. |
| `self-host install <app or goal>` | Setup | Inspect and propose an exact apply step, then continue through approval and verification. |
| `self-host status`, `verify`, `add`, `update`, or `repair` | Upkeep | Refresh facts for the supplied project and route to the owning workflow. |

Keep conversational goals valid after the command: `/self-host replace Google
Photos` should select the same setup route as `/self-host install immich`.
An empty command asks for intent. Ambiguous host, project, access, or service
choices remain explicit questions. Update the registry, source skill,
invocation docs, and validators together so they agree on the policy.

**Gate:** each command form maps to exactly one workflow; an unapproved
`install` invocation makes no host mutation.

### 2. Make explicit invocation real in each supported client

- Codex: set `agents/openai.yaml` to `allow_implicit_invocation: false`.
  Keep `$self-host` and `/skills` as the supported route. Treat the existing
  custom prompt installer as an optional compatibility bridge while it remains
  supported by Codex.
- Pi: use its `disable-model-invocation: true` policy for the Pi-distributed
  skill and a prompt template for `/self-host`. Preserve the single canonical
  skill source by generating any Pi-specific package from it at release.
- OpenCode: set `metadata.opencode/autoinvoke: false` for its distribution.
  First verify the native slash-enabled skill path for `/self-host`; keep the
  command file only if its argument behavior is needed. Expose one menu entry
  and confirm its arguments load the intended skill ID.
- Generic Agent Skills clients: keep the standard package valid and document
  which explicit-only behavior is enforced by a host and which is an
  in-skill request. Never treat a metadata marker as a security boundary.

**Gate:** a named request without explicit invocation does not start the
self-host workflow in each client claimed as command-first; explicit invocation
does. [Codex policy](https://developers.openai.com/codex/skills/),
[Pi policy](https://pi.dev/docs/latest/skills),
[OpenCode policy](https://opencode.ai/v2/docs/skills).

### 3. Ship the command with the skill

Make command registration part of each supported install or package path.
Use the canonical skill and only the host adapters it needs. The installer
should detect collisions, update its own files, and report exact installed
paths and invocations. Document update and uninstall alongside installation.
Keep the public skill plus the fourteen `GUIDE.md` modules as one installable
unit; command adapters contain no copied operational procedures.

**Gate:** a fresh copy or symlink install, with the source checkout removed,
exposes the documented command and can read every required bundled workflow.

### 4. Sharpen the skill as the command's execution contract

Keep the public `SKILL.md` short: accepted inputs, one-guide routing, the
approval boundary, and the required final result. Review the selected setup,
upkeep, and planning guides for checkable inputs and completion criteria.
Consolidate repeated rules at their owning guide; keep service-specific facts
behind catalog lookup. Preserve the existing fourteen internal guides and
their ownership boundaries.

Use deterministic helpers for facts and state transitions that a prompt should
not guess. Improve a helper's diagnostic only when a scenario shows a confusing
or unactionable result. Show one small example per route, including a returning
project, without loading those examples on every invocation. This takes the
focused fast path and evidence discipline from
[Archify](https://github.com/tt-a1i/archify) and the conditional loading from
[Anthropic skills](https://github.com/anthropics/skills).

**Gate:** a new user request reaches the right guide after reading only the
public entry, and each guide states when its work is complete.

### 5. Prove behavior, then improve the first-use story

Use a small scenario matrix at the appropriate boundary:

1. Command discovery and argument forwarding in Pi and OpenCode, plus Codex
   native skill selection and the optional prompt bridge.
2. Planning a named app, a replacement goal, and a composite request; assert
   the chosen workflow and selected services.
3. An unapproved setup request; assert a concrete proposed change and zero
   host mutations.
4. A returning project; assert saved intent is separated from fresh host facts.
5. A redacted completion; assert that links, evidence, limitations, and the
   private handoff path are accurate without credential values.

Keep fixture and package checks focused. Run detached client smoke checks when
adapters change and a real end-to-end self-host acceptance run for claims about
live service setup. Publish one short, credential-free example transcript
showing plan, approval, apply, and verified result. State which apps are
automated, guided, or discovery-only.

**Gate:** the README can say exactly which client commands were observed,
which workflow behaviors were evaluated, and which services were verified
live, with no claim upgraded by a narrower check.

### 6. Release as a recognizable command

Lead the README with the command's job, one install path per supported host,
the exact invocation, one example, and the result users receive. Move the
internal catalog and contributor details behind links. Include host/version
compatibility, update/removal steps, command ownership, changelog notes, and
the release archive's command files in the package manifest.

**Gate:** a new user can install, find, invoke, and update the command from the
published instructions without opening repository internals or manually
copying a prompt file.

## Definition of done

The command is discoverable and invocable with the documented syntax in each
claimed client. Its arguments reach the canonical skill; exactly one owning
workflow handles the request. An invocation alone never bypasses an approval
gate. Detached installs work after removing the source checkout. The user
receives an honest plan or evidence-backed result, and the release docs say
precisely what was verified.
