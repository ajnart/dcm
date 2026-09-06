# Selfhost Skills architecture research

Date: 2026-08-28  
Repository: `ajnart/selfhost-skills` (currently private)  
Scope: architecture and migration research only. This report is the only file
created by this research pass. No implementation files, `.sessions` content,
secret values, Docker processes, or tests were touched.

> Historical snapshot: this report predates the portable skill packaging now
> shipped under `.agents/skills/`. Its checkout-bound installation proposal was
> superseded by [the current installation contract](../.agents/install.md),
> which installs complete global copies that need no source checkout at runtime.

## Recommendation in one page

Keep the existing repository as the operational source of truth and add a
small, flat, cross-agent skill layer under `.agents/skills/`. Use namespaced
skill names rather than nested category folders:

```text
.agents/skills/
  selfhost/                    # explicit user-facing router
  selfhost-core-bootstrap/     # reusable deterministic service capability
  selfhost-browser/            # unavoidable first-run/browser capability
  selfhost-homarr-mcp/         # private key, native MCP, bridge capability
  selfhost-verify/             # evidence and acceptance capability
```

`selfhost` should accept a scenario argument, so `/selfhost netflix` is a
natural Claude Code command and the same skill can be explicitly invoked as
`$selfhost` with `netflix` in Codex. `netflix` should initially be a scenario
reference, not a sixth skill. The router should select and sequence the
capabilities; it should not contain service implementation details.

Keep `docker-compose.yml`, `scripts/`, `prompts/`, and `docs/` at the project
root. Skills should point at those assets or call them through thin wrappers;
they should not copy `session.sh`, the bootstrap logic, MCP client, or service
instructions into several skill directories. This preserves one private
state/secret implementation and makes a fresh skill installation useful only
when run against the repository that owns the harness.

For broad agent compatibility, canonical `SKILL.md` files should use the
standard Agent Skills frontmatter only. Put Codex display and invocation
policy in each skill's `agents/openai.yaml`. If Claude-only human invocation
is later required, generate a Claude packaging overlay for
`disable-model-invocation: true`; do not put non-standard Claude keys in the
canonical file that is validated and installed for other agents.

The first implementation slice should be deliberately small: add the
`selfhost` router, one core-bootstrap capability, the verification capability,
their OpenAI metadata, and two reference files (`netflix` and
`harness-map`). Validate metadata and packaging before migrating every prompt
module.

## Evidence boundary and current repository

The current repository already has the important pieces of a skill-backed
application:

- [`PROMPT.md`](../PROMPT.md) is the controller contract. It defines unique
  run IDs, ordered modules, the seven-service acceptance target, Homarr API/MCP
  requirements, and the no-media-mutation boundary.
- [`prompts/`](../prompts/) is a replaceable orchestration genome. The modules
  split contract, isolation/start, deterministic bootstrap, browser-only
  onboarding, MCP finalization, acceptance, and evidence.
- [`scripts/session.sh`](../scripts/session.sh) owns per-run allocation,
  locks, private state, generated credentials, environment projection, status,
  teardown, and the command dispatch for the rest of the harness.
- [`scripts/lib/session-context.ts`](../scripts/lib/session-context.ts) owns
  strict session/secret validation and sanitized child environments.
- [`scripts/bootstrap-core.ts`](../scripts/bootstrap-core.ts) and
  [`scripts/verify-core.ts`](../scripts/verify-core.ts) provide deterministic
  service graph setup and independent checks.
- [`scripts/homarr-finalize.ts`](../scripts/homarr-finalize.ts),
  [`scripts/homarr-mcp-bridge.ts`](../scripts/homarr-mcp-bridge.ts),
  [`scripts/lib/homarr-mcp.ts`](../scripts/lib/homarr-mcp.ts), and
  [`scripts/verify-homarr-mcp.ts`](../scripts/verify-homarr-mcp.ts) already
  form a coherent private-key/native-MCP adapter.
- [`scripts/render-prompt.sh`](../scripts/render-prompt.sh) is effectively a
  prompt compiler: it resolves the manifest and optional modules without
  mutating tracked files.
- [`docs/`](../docs/) contains service-level operational references, while
  [`generations/`](../generations/) records experiments and promotion criteria.

This is a good boundary: skills should expose the harness, not become a second
implementation of it. The existing generated-run acceptance model also gives
the future skill layer a concrete runtime contract.

## 1. Observed reference patterns

### Agent Skills standard

The [Agent Skills specification](https://agentskills.io/specification) defines
one required `SKILL.md` per skill directory, required `name` and `description`
metadata, and optional `license`, `compatibility`, `metadata`, and
experimental `allowed-tools`. Names are lowercase hyphenated identifiers that
match the containing directory. The description should say what the skill does
and when it applies.

The standard explicitly uses progressive disclosure: clients discover the
small metadata first, load the full body only after activation, and read
`references/`, `scripts/`, and `assets/` only as needed. It recommends keeping
the body under 500 lines and references shallow. The
[client implementation guidance](https://agentskills.io/client-implementation/adding-skills-support)
also treats `.agents/skills` as the widely adopted project convention, while
allowing clients to add native locations such as `.claude/skills`.

Implication: the trigger description must be precise and compact; all of the
current service matrices and troubleshooting history must remain references,
not be loaded into every context window.

### Codex

The [Codex skills documentation](https://developers.openai.com/codex/skills/)
describes repository skills in `.agents/skills`, user skills in
`~/.agents/skills`, and higher-priority administrative/system locations. Codex
walks from the current working directory toward the repository root, supports
symlinks, and does not merge colliding skills. It initially inventories names,
descriptions, and paths within a small context budget, then loads the full
skill on activation. Explicit invocation is `$skill-name`; implicit use is
driven by the description.

Codex's own guidance distinguishes direct skills for local/project authoring
from [plugins for distribution](https://developers.openai.com/codex/plugins/).
The plugin manifest lives in `.codex-plugin/plugin.json`; a plugin can expose
skills and other resources, and a marketplace can make a private repository
installable. A plugin is a useful later distribution surface, but it does not
replace the repository-local `.agents/skills` layout needed while this harness
is developed.

The OpenAI-specific [`agents/openai.yaml` reference](https://github.com/openai/skills/blob/main/skills/.system/skill-creator/references/openai_yaml.md)
describes UI metadata such as `display_name`, `short_description`, icons,
brand color, and `default_prompt`, plus the Codex invocation policy. The
default prompt should explicitly name the skill, for example `$selfhost`; all
YAML strings should be quoted. This file is product configuration, not the
portable skill contract.

### Claude Code

Claude Code discovers project skills in `.claude/skills/<name>/SKILL.md`,
personal skills in `~/.claude/skills`, and plugin skills under a plugin's
`skills/` directory. Its [slash-command and skill documentation](https://code.claude.com/docs/en/slash-commands)
supports `$ARGUMENTS`, so `/selfhost netflix` can pass `netflix` to one router.
It also defines `disable-model-invocation: true` for human-only skills and
`user-invocable: false` for model-only skills.

Those invocation keys, dynamic shell substitutions, `context: fork`, and other
fields are Claude Code extensions. The same documentation warns that
Claude-Code-only extensions do not apply to Claude.ai/API, while the portable
Agent Skills format has only the six standard frontmatter properties. That is
why the canonical file should stay standard and the product-specific policy
should live in `agents/openai.yaml` or a generated client overlay.

Claude plugins use `.claude-plugin/plugin.json`, namespaced commands, and a
`skills/` directory. The [plugin documentation](https://code.claude.com/docs/en/plugins)
and [marketplace documentation](https://code.claude.com/docs/en/plugin-marketplaces)
show local `--plugin-dir` testing, Git-backed marketplaces, project/user scopes,
and strict validation. Plugin caches copy the plugin; paths outside the plugin
are not a dependable way to share implementation files. This reinforces the
need to keep a project-local harness boundary explicit.

### Matt Pocock's `skills` repository

The [Matt Pocock skills README](https://raw.githubusercontent.com/mattpocock/skills/main/README.md)
shows a useful distinction between a managed Claude plugin and the universal
[`npx skills`](https://github.com/vercel-labs/skills) installer. It describes
skills as small, adaptable, and composable, and recommends choosing one
installation philosophy rather than installing both routes.

The repository's promoted buckets (`engineering`, `productivity`) are a
curation layer, not a reason for every consumer to reproduce the bucket tree.
Its [ADR on Codex packaging](https://raw.githubusercontent.com/mattpocock/skills/main/.agents/adr/0002-ship-as-a-claude-code-plugin.md)
records a practical, time-qualified constraint: Codex plugin manifests then
accepted one `skills` path rather than an array, and symlinks were dropped when
the plugin cache was copied. The ADR therefore retained the universal
`skills.sh` route and deferred native Codex packaging. This is a reference
repository observation, not a permanent claim about current Codex behavior;
validate the current plugin implementation before relying on it.

The [invocation guidance](https://raw.githubusercontent.com/mattpocock/skills/main/.agents/invocation.md)
uses user-invoked routers for explicit workflows and model-invoked skills for
reusable discipline. A router may invoke a model-invoked capability, but user
invoked skills should not form a chain of user-facing commands. Dependencies
are expressed through explicit skill calls rather than fragile `../` links.
That maps cleanly to `selfhost` plus the capability skills proposed here.

### Installers and validators

The [Vercel `skills` CLI README](https://raw.githubusercontent.com/vercel-labs/skills/main/README.md)
documents GitHub/GitLab/SSH/local sources, private-repository authentication
through the user's existing Git credentials, project/global installation,
agent selection, skill selection, copy versus symlink behavior, updates, and
support for Claude Code, Codex, Cursor, Gemini CLI, OpenCode, and many others.
It lists `.agents/skills` for Codex and several compatible agents, and
`.claude/skills` for Claude Code. This is the best universal one-command route
for the first release.

The [standard validator](https://github.com/agentskills/agentskills/blob/main/skills-ref/README.md)
is appropriate for every canonical skill. Anthropic's
[`quick_validate.py`](https://github.com/anthropics/skills/blob/main/skills/skill-creator/scripts/quick_validate.py)
and [skill packager](https://github.com/anthropics/skills/blob/main/skills/skill-creator/scripts/package_skill.py)
are useful additional checks or an archive distribution format, but they are
not a substitute for testing the target agent installers.

## 2. Proposed repository layout

Use a flat canonical skill directory. The `selfhost-` prefix gives the same
discoverability as categories without requiring a plugin to enumerate several
paths or preserve symlinks:

```text
ajnart/selfhost-skills/
├── .agents/
│   └── skills/
│       ├── selfhost/
│       │   ├── SKILL.md
│       │   ├── agents/openai.yaml
│       │   └── references/
│       │       ├── harness-map.md
│       │       ├── safety.md
│       │       └── scenarios/netflix.md
│       ├── selfhost-core-bootstrap/
│       │   ├── SKILL.md
│       │   └── references/arr-pipeline.md
│       ├── selfhost-browser/
│       │   ├── SKILL.md
│       │   └── references/{jellyfin,seerr,homarr}.md
│       ├── selfhost-homarr-mcp/
│       │   ├── SKILL.md
│       │   └── references/mcp-safety.md
│       └── selfhost-verify/
│           ├── SKILL.md
│           └── references/acceptance.md
├── .claude-plugin/plugin.json       # add when Claude packaging is ready
├── .codex-plugin/plugin.json        # add after current plugin path is verified
├── .agents/plugins/marketplace.json # optional private marketplace entry
├── PROMPT.md
├── prompts/
├── docs/
├── scripts/
├── docker-compose.yml
└── generations/
```

The canonical root is intentionally `.agents/skills`, not a second copy under
`.claude/skills`. The universal installer can create the agent-specific
symlinks or copies. A Claude plugin manifest can point to the canonical path if
the current plugin validator accepts a relative `.agents/skills` path; if it
does not, use a release-time packaging projection into a plugin `skills/`
directory. Do not commit two independently editable copies.

Skill boundaries:

| Boundary | Responsibility | Not responsible for |
| --- | --- | --- |
| `selfhost` router | Parse scenario/intent, state safety contract, select capabilities, ask for execution confirmation | qBittorrent fields, browser selectors, MCP JSON-RPC, long service docs |
| `selfhost-core-bootstrap` | Run or explain deterministic qBit/Arr/Prowlarr setup through existing scripts | first-run browser flows, Homarr key handling |
| `selfhost-browser` | Coordinate Jellyfin, Seerr, and Homarr flows where APIs cannot replace the browser | private key persistence, generic browser framework reimplementation |
| `selfhost-homarr-mcp` | Finalize generated apps, configure/verify native MCP and the private stdio bridge | arbitrary media requests or destructive tool calls |
| `selfhost-verify` | Run bounded verification and assemble secret-free evidence | changing service configuration to make a check pass |
| scenario reference | Declare the desired app graph and acceptance policy (`netflix` first) | a new executable implementation |

Do not create individual `sonarr`, `radarr`, or `jellyfin` skills merely to
hold facts. Keep those facts in the capability references. A service deserves
its own skill only if users independently request that workflow and it has a
stable contract distinct from the end-to-end scenario.

## 3. Installation options and tradeoffs

### Recommended universal route

After the private repository is accessible through the user's configured Git
credential helper, the intended one-command installation is:

```bash
bunx skills@latest add ajnart/selfhost-skills --skill '*' --agent '*' -y
```

The exact `--agent` set can be narrowed when desired, for example
`--agent codex --agent claude-code`. Use `--list` first when validating a new
release. The CLI's default project installation keeps a canonical source and
links compatible agent directories; `--copy` is the fallback for environments
that do not preserve symlinks. No access token, key, or password belongs in the
command. For this repository, installation should happen in the checkout that
contains `scripts/` and `docker-compose.yml`, because the skills intentionally
invoke that harness.

Advantages: one public workflow across many agents, no duplicate source tree,
straightforward updates, and existing private Git authentication. Tradeoffs:
the user must run it from the harness project (or separately package the
harness), and each agent may expose a slightly different invocation UX.

### Claude plugin

Once `.claude-plugin/plugin.json` and a marketplace entry exist, the supported
flow is to add the private Git marketplace and install the plugin at project or
user scope, for example:

```text
/plugin marketplace add ajnart/selfhost-skills
/plugin install selfhost@selfhost-skills
```

Use `claude --plugin-dir ./` for local development and
`claude plugin validate . --strict` before publishing. This gives namespaced
commands and managed Claude updates. It is not the universal route: plugin
cache boundaries mean the manifest must package every skill resource it needs,
and the current harness still has to be available to execute the commands.

### Codex plugin/marketplace

Add `.codex-plugin/plugin.json` with a single relative skills path and an
optional `.agents/plugins/marketplace.json`. The documented marketplace flow
starts with:

```text
codex plugin marketplace add ajnart/selfhost-skills --ref main
```

Then install through the Codex plugin browser (`/plugins`) in a new session.
This is a useful ChatGPT/Codex distribution surface, but the exact handling of
`.agents/skills` as the plugin's `skills` path and of symlinks must be verified
against the current Codex build. The Matt ADR documents why this path was
previously deferred. Keep `npx skills` as the fallback even after adding the
manifest.

### Direct repository-local use

Cloning the private repository and opening the agent from its root is the most
reliable development mode. Codex discovers `.agents/skills` directly, and the
root-relative harness paths are unambiguous. This route has no packaging
projection but is not a polished end-user installer.

### Archive packaging

`skills-ref validate` plus Anthropic's packager can produce a portable skill
archive, but an archive containing only `SKILL.md` files cannot run this
harness. Use archive packaging for capability text or references only, or
package the complete project as a deliberate application bundle. Never solve
the portability problem by copying secret-handling scripts into every skill.

## 4. Trigger and invocation design

### Router

`selfhost` is the single user-facing entry point. Its description should be
human-oriented and identify the explicit on-ramp rather than list every
trigger. The body should:

1. Read the scenario argument (`netflix` initially) and reject unknown
   scenarios without guessing.
2. Load the scenario reference and the safety contract.
3. Present the planned stages and whether they create a fresh local run.
4. Require explicit confirmation before `up`, browser changes, key creation,
   or any other state-changing stage.
5. Invoke model-invoked capability skills in order, passing only the minimum
   run context.
6. End with the existing evidence matrix and secret-free artifact locations.

Claude can express this as `/selfhost netflix` via `$ARGUMENTS`. Codex uses
`$selfhost` followed by `netflix`; the skill body should describe both forms
without depending on slash-command syntax. If no scenario is supplied, list
the supported scenarios and ask the user to choose one.

### Capabilities

Capability descriptions should be model-facing and precise:

- `selfhost-core-bootstrap`: use when a fresh run has been created and the
  deterministic qBit/Arr/Prowlarr graph must be configured or checked.
- `selfhost-browser`: use for the first-run Jellyfin, Seerr, or Homarr browser
  steps that the API bootstrap cannot safely replace.
- `selfhost-homarr-mcp`: use after Homarr onboarding to store the one-time key,
  finalize generated apps, and verify canonical native MCP plus the local
  bridge; never use it to request media.
- `selfhost-verify`: use for independent checks, acceptance, and evidence
  assembly after a stage or at the end of a run.

Capabilities should remain model-invocable where that helps composition, but
their descriptions must not imply permission to create a run or mutate media.
The router is the policy gate. A capability may be called directly for
diagnostics only when its description and body make the scope explicit.

### Standard metadata and product overlays

Canonical frontmatter should contain only standard fields, for example:

```yaml
---
name: selfhost-core-bootstrap
description: Configure and verify the isolated qBittorrent, Arr, and Prowlarr service graph through this repository's deterministic harness. Use after a run is created or when a bounded graph check is requested.
compatibility: Requires this repository, Bash, Node.js, and its existing harness dependencies.
metadata:
  domain: selfhost
  risk: local-state-change
---
```

Keep descriptions short enough for discovery and put the detailed sequence in
the body/references. `agents/openai.yaml` can mark the router explicit-only
with `policy.allow_implicit_invocation: false`, provide a display name, and
set a default prompt mentioning `$selfhost`. For Claude, a release projection
can add `disable-model-invocation: true` to the router if strict human-only
semantics are required. The shared source should not acquire that
Claude-specific field because the standard validator and non-Claude clients
may reject or ignore it.

Avoid `context: fork`, dynamic shell substitutions, or hooks in the canonical
skill. The installer compatibility table shows these are not broadly portable.
If a future client-specific feature is worth using, keep it in that client's
packaging overlay and make the standard body function without it.

## 5. Reusable harness assets

The following migration keeps one implementation and gives each skill a
stable seam:

| Existing asset | Package as | Reuse rule |
| --- | --- | --- |
| `docker-compose.yml` | harness runtime | Keep at repository root; never embed a second compose file in a skill |
| `scripts/session.sh` + `scripts/lib/session-context.ts` | run lifecycle/private-state capability | Skills invoke documented subcommands; secret values stay in the private store |
| `scripts/bootstrap-core.ts` | core-bootstrap implementation | Call it from `selfhost-core-bootstrap`; do not copy qBit/Arr field logic |
| `scripts/verify-core.ts` | core verification implementation | Expose bounded PASS/FAIL summaries only |
| `scripts/homarr-finalize.ts` + `scripts/lib/homarr-mcp.ts` | Homarr adapter | Keep native endpoint and fallback policy in this one adapter |
| `scripts/homarr-mcp-bridge.ts` + `scripts/write-mcp-config.ts` | client bridge/artifact support | Generate secret-free config; private key remains session-owned |
| `scripts/verify-homarr-mcp.ts` | MCP acceptance | Preserve search-only proof and the no-`integration_requestMedia` guard |
| `scripts/render-prompt.sh` | prompt/compiler compatibility | Use it to render a candidate prompt while the skill layer coexists with generations |
| `prompts/*.md` | orchestration references | Migrate by responsibility; keep module files as regression/spec evidence until replacement is proven |
| `docs/*.md` | on-demand references | Link/quote only the relevant service facts in capability references |
| `generations/*.md` | evolution/reference history | Do not load into normal execution; retain for design and regression context |

The only future helper worth adding inside a skill is a thin locator/exec
wrapper that checks the current project root and delegates to the existing
script. It must not implement lifecycle, credential, browser, or MCP behavior.
For a copied external install, fail clearly with “run from the
`selfhost-skills` checkout” rather than silently creating state in an unknown
directory.

## 6. Validation strategy

Validation should be layered and cheap before any live-stack run:

1. **Metadata:** run `skills-ref validate` against every skill; additionally
   run Anthropic's validator if the package is intended for Claude. Check name,
   description, frontmatter keys, directory matching, and body/reference size.
2. **Packaging:** run Claude strict plugin validation when its manifest exists.
   For Codex, inspect the manifest and exercise marketplace/local installation
   in a disposable non-secret checkout; verify whether a relative
   `.agents/skills` path and symlinks survive the current cache behavior.
3. **Universal installer:** use the CLI's list/dry inspection, install into a
   disposable checkout with `--copy` and default symlink mode, then enumerate
   skills from Codex, Claude Code, and one `.agents/skills`-compatible client.
4. **Progressive disclosure:** confirm initial descriptions do not contain the
   full service runbook, references are one level deep, and activation exposes
   only the selected capability's body.
5. **Trigger matrix:** check positive and negative prompts for each capability;
   verify `/selfhost netflix` and `$selfhost netflix` route to the same plan;
   ensure generic “I want a media app” does not autonomously start Docker or
   request a key.
6. **Harness contract:** when a live run is intentionally requested, use the
   existing `session.sh doctor`, status/URL checks, `verify-core`, and
   `verify-homarr-mcp`. The skill layer must not replace those checks with an
   HTTP-200-only assertion.
7. **Security:** scan skill text and generated artifacts for key/password/cookie
   literals, `.sessions` reads, broad filesystem deletion, and media mutation.
   Review that commands pass run IDs and sanitized environments rather than
   interpolated secret values.
8. **Evidence:** require the existing acceptance matrix, action/retry counts,
   screenshots where browser QA is part of the scenario, and a secret-free MCP
   client artifact. Do not make a packaging pass depend on Docker or E2E.

This separates skill packaging regressions from the already well-defined
runtime acceptance suite and respects the repository's focused-validation
discipline.

## 7. Migration map from current files

| Current source | Destination/role | Migration note |
| --- | --- | --- |
| `PROMPT.md` | `selfhost/SKILL.md` policy plus `references/safety.md` | Keep the concise contract in the router; move detailed acceptance to a reference |
| `prompts/00-contract.md` | router safety reference | Preserve unique run ID, no secret disclosure, run-scoped browser, and artifact rules |
| `prompts/10-isolation-and-start.md` | `selfhost-core-bootstrap` reference | The capability delegates to `session.sh create/up/bootstrap` |
| `prompts/20-bootstrap.md` and `30-connect-arr.md` | `selfhost-core-bootstrap` + `references/arr-pipeline.md` | API-first deterministic setup remains script-owned |
| `prompts/40-seerr.md` | `selfhost-browser/references/seerr.md` | Browser-only first-run/sync flow; service facts remain in `docs/seerr.md` |
| `prompts/50-homarr.md` | `selfhost-browser/references/homarr.md` | Preserve six integrations, generated tiles/widgets, and no manual placement |
| `prompts/60-homarr-api-mcp.md` | `selfhost-homarr-mcp/references/mcp-safety.md` | Preserve private one-time key, canonical `/api/mcp`, bridge fallback limits, and search-only proof |
| `prompts/80-acceptance.md` | `selfhost-verify/references/acceptance.md` | Keep the pass/fail matrix as the runtime contract |
| `prompts/90-evidence.md` | `selfhost-verify` body/reference | Keep artifact names and secret-free report rules |
| `docs/README.md` | `selfhost/references/harness-map.md` | Make pre-browser and session rules discoverable without loading all docs |
| `docs/{service}.md` | capability references | Link as source material; do not make each service a triggerable skill |
| `scripts/*` | unchanged executable harness | Add only thin skill delegation later |
| `generations/*` | project history | Keep out of normal skill context; use when evolving or reviewing the genome |
| historical root guides/screenshots | non-runtime evidence | Do not promote stale manual instructions into skills |

Keep the prompt modules during migration. A module can remain the executable
candidate contract while a skill reference is introduced and compared against
it. Remove or rename a module only after the equivalent skill path has passed
the same acceptance/evidence checks.

## 8. Concrete first implementation slice

The first slice should prove routing, composability, and packaging—not attempt
to rewrite the whole harness. Proposed future files:

```text
.agents/skills/selfhost/SKILL.md
.agents/skills/selfhost/agents/openai.yaml
.agents/skills/selfhost/references/harness-map.md
.agents/skills/selfhost/references/scenarios/netflix.md
.agents/skills/selfhost-core-bootstrap/SKILL.md
.agents/skills/selfhost-verify/SKILL.md
```

The router should accept `netflix`, show the existing seven-service plan,
delegate core setup to `selfhost-core-bootstrap`, delegate final checks to
`selfhost-verify`, and state that browser/MCP stages are subsequent
capabilities. The core capability should call the existing `session.sh` and
bootstrap/verifier implementations by documented subcommand, with no copied
credential or API logic. The verification capability should expose only
secret-free summaries and point to the existing evidence artifact rules.

Do not add a Claude or Codex manifest in this first slice until the flat path
has passed the standard validator and a disposable installer check. Then add
the two plugin manifests as packaging projections, retaining `npx skills` as
the universal install path. Migrate `selfhost-browser` and
`selfhost-homarr-mcp` in the next slice after the router/capability boundary
has been exercised once.

## Primary sources

- [Agent Skills specification](https://agentskills.io/specification)
- [Agent Skills client implementation guidance](https://agentskills.io/client-implementation/adding-skills-support)
- [OpenAI Codex skills](https://developers.openai.com/codex/skills/)
- [OpenAI Codex plugins](https://developers.openai.com/codex/plugins/)
- [OpenAI `agents/openai.yaml` reference](https://github.com/openai/skills/blob/main/skills/.system/skill-creator/references/openai_yaml.md)
- [Claude Code slash commands and skills](https://code.claude.com/docs/en/slash-commands)
- [Claude Code plugins](https://code.claude.com/docs/en/plugins)
- [Claude Code plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces)
- [Matt Pocock skills README](https://raw.githubusercontent.com/mattpocock/skills/main/README.md)
- [Matt Pocock invocation guidance](https://raw.githubusercontent.com/mattpocock/skills/main/.agents/invocation.md)
- [Matt Pocock Codex packaging ADR](https://raw.githubusercontent.com/mattpocock/skills/main/.agents/adr/0002-ship-as-a-claude-code-plugin.md)
- [Vercel `skills` CLI README](https://raw.githubusercontent.com/vercel-labs/skills/main/README.md)
- [Agent Skills validator](https://github.com/agentskills/agentskills/blob/main/skills-ref/README.md)
- [Anthropic skill validator](https://github.com/anthropics/skills/blob/main/skills/skill-creator/scripts/quick_validate.py)
- [Anthropic skill packager](https://github.com/anthropics/skills/blob/main/skills/skill-creator/scripts/package_skill.py)
