# Patterns in first-party agent-skill repositories

Checked: 2026-09-06
Scope: current first-party GitHub repositories and files only. This report does
not use stars as evidence of quality or adoption, and it does not change runtime
or skill code.

## Executive findings

- The portable core is deliberately small: one directory, one `SKILL.md`, YAML
  `name` and `description`, and Markdown instructions. `scripts/`, `references/`,
  and `assets/` are conventions, not mandatory runtime interfaces.
- Progressive disclosure is the strongest shared design pattern: metadata is
  cheap discovery context, `SKILL.md` is the activated workflow, and supporting
  files load or execute only when needed.
- The description is a routing contract, but authoring advice differs.
  Anthropic, OpenAI, Vercel, and the Agent Skills specification say to describe
  both capability and trigger. Superpowers deliberately uses trigger-only
  descriptions because its testing found workflow summaries can become a
  shortcut that causes agents to skip the body.
- Mature repositories move repeatable or fragile work into deterministic
  scripts and validate it. The strongest examples add behavioral evals,
  fixture tests, generated-artifact checks, hashes, or immutable releases.
- Safety, approval, tool availability, dependency graphs, workflow state, and
  resume behavior are not portable skill-standard concepts. Successful
  collections encode them in prose, scripts, plugin manifests, lock files, or
  repository-specific registries.
- `openai/skills` exists but is deprecated. Its current README directs authors
  to `openai/plugins`, which is now the relevant first-party Codex distribution
  collection. The older skill-creator remains useful evidence of OpenAI's
  authoring conventions, but it is not the current publication surface.

## Repositories verified

The comparison uses the following `main` snapshots:

| Repository | Snapshot | Current role |
| --- | --- | --- |
| [`agentskills/agentskills`](https://github.com/agentskills/agentskills/tree/69ef37e9424c0a7ea9dd2293b559e43ec8176379) | `69ef37e`, 2026-08-09 | Portable format specification and reference validator. |
| [`anthropics/skills`](https://github.com/anthropics/skills/tree/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f) | `41bbe19`, 2026-09-03 | Anthropic's active example and production-derived skill collection. |
| [`openai/plugins`](https://github.com/openai/plugins/tree/1e285826e604f66f7208f7ac4dba0fe8341d1f57) | `1e28582`, 2026-08-28 | Current Codex plugin collection; plugins may bundle skills, apps, MCP, agents, commands, hooks, and assets. |
| [`openai/skills`](https://github.com/openai/skills/tree/49f948faa9258a0c61caceaf225e179651397431) | `49f948f`, 2026-06-23 | Existing but deprecated legacy skill collection and authoring helpers. |
| [`obra/superpowers`](https://github.com/obra/superpowers/tree/b36e0829c6d0140e93cfef2ca599b1b07d4a7797) | `b36e082`, 2026-08-12 | Active, composable software-development methodology distributed across many agent/plugin systems. |
| [`vercel-labs/agent-skills`](https://github.com/vercel-labs/agent-skills/tree/063bee94c3f4df8453406c830b0a7df0f2860278) | `063bee9`, 2026-08-28 | Active Vercel-authored skill collection and immutable discovery artifacts. |
| [`vercel-labs/skills`](https://github.com/vercel-labs/skills/tree/435076e78988e1e6ec40d00b0b1d76bdbbc5419a) | `435076e`, 2026-08-18 | Multi-agent discovery, install, update, and lockfile CLI (`skills` 1.5.23 in this snapshot). |

## Comparison matrix

| Collection | Discovery and disclosure | Supporting material | Workflow, safety, and composition | Validation, state, and distribution |
| --- | --- | --- | --- | --- |
| Agent Skills specification | Requires `SKILL.md` with `name` and `description`; defines metadata -> instructions -> resources progressive loading. | Recommends `scripts/`, `references/`, and `assets/`; relative, shallow links. | Optional `compatibility`; experimental `allowed-tools`; no dependency, approval, or resume schema. | Provides `skills-ref validate`; deliberately treats client behavior as separate from the format. |
| Anthropic | Self-contained skill folders; description is the primary trigger; recommends a body under 500 lines. | Standard three directories plus skill-creator agents, eval viewer, schemas, and packaging scripts. | Explicit workflows, output contracts, environment-specific branches, and a "lack of surprise" security rule. Optional prose `compatibility`. | Draft -> paired baseline/skill runs -> qualitative and quantitative review -> iteration; separate trigger eval optimization; Claude plugin/API install paths. |
| OpenAI | Legacy creator uses metadata -> body -> resources. Current distribution wraps skills in required Codex plugin manifests. | Legacy creator standardizes `scripts/`, `references/`, `assets/`, plus `agents/openai.yaml`; current plugins can also bundle MCP, apps, commands, hooks, and plugin assets. | Degree-of-freedom guidance; operational skills use narrow trigger/negative-trigger descriptions, authorization boundaries, preflights, canonical artifacts, and exact completion gates. | Legacy `init_skill.py` and `quick_validate.py`; current plugin manifests and marketplace policy are distribution metadata, not portable skill metadata. |
| Superpowers | Flat skill namespace; concise trigger-only descriptions; supporting files stay outside the main skill. | Supporting Markdown, prompts, scripts, examples, and platform adapters; directory names are less rigid than the standard trio. | Most explicit composition model: process skills precede implementation skills, required background/sub-skills are named, and user instructions outrank skills. Workflows contain stop conditions and checkpoints. | Treats skill authoring as red-green-refactor with baseline pressure tests. Saves designs/plans as execution handoffs; plugin behavior has a broad integration test suite. |
| Vercel agent-skills | Exact `SKILL.md`, kebab-case directories, on-demand loading, specific trigger phrases, body under 500 lines. | `scripts/`, `references/`, optional `lib/`; real skills also use `rules/`, `resources/`, and generated archives. | Collection guidance requires troubleshooting for network/permissions; individual skills contain concrete auth, scope, approval, and fallback boundaries. | CI validates skill builds. A deterministic builder validates frontmatter, emits sorted discovery metadata, content digests, and reproducible per-skill archives published as immutable releases. |
| Vercel skills CLI | Discovers root and known skill containers, bounded catalog nesting, plugin-manifest paths, and optional full-depth fallback; validates frontmatter types. | Installs the complete containing directory, preserving scripts and references. | Cross-agent feature support varies; `allowed-tools`, hooks, and forked context are not universally portable. Installer hardens path containment, archive limits, credentials, and terminal output. | `find`, `list`, `use`, `add`, `update`, `remove`, copy/symlink modes, agent auto-detection, extensive tests, project `skills-lock.json`, and global `.skill-lock.json`. |

## Common patterns and important differences

### 1. `SKILL.md` metadata is the portable discovery ABI

The specification requires a skill directory whose `SKILL.md` begins with YAML
frontmatter. `name` and `description` are required; `license`, `compatibility`,
string-valued `metadata`, and experimental `allowed-tools` are optional. It also
requires the skill name to match the parent directory. The body format is
intentionally unconstrained. [Specification: directory and frontmatter](https://github.com/agentskills/agentskills/blob/69ef37e9424c0a7ea9dd2293b559e43ec8176379/docs/specification.mdx#L6-L65)

Anthropic's basic template and Vercel's author guide repeat the same minimal
shape. [Anthropic basic skill](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/README.md#L63-L90),
[Vercel author guide](https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/AGENTS.md#L9-L44)

What is common but not universal is how to write `description`:

- The specification says what the skill does, when it applies, and relevant
  keywords. Anthropic and OpenAI say essentially the same.
  [Specification](https://github.com/agentskills/agentskills/blob/69ef37e9424c0a7ea9dd2293b559e43ec8176379/docs/specification.mdx#L91-L108),
  [Anthropic](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/skill-creator/SKILL.md#L45-L69),
  [OpenAI legacy creator](https://github.com/openai/skills/blob/49f948faa9258a0c61caceaf225e179651397431/skills/.system/skill-creator/SKILL.md#L67-L72)
- Superpowers says the description should contain only triggering conditions,
  because its tests found that summarizing the workflow can cause an agent to
  act from the summary without loading the full body.
  [Superpowers discovery optimization](https://github.com/obra/superpowers/blob/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/skills/writing-skills/SKILL.md#L93-L180)

The compatible synthesis is: identify the capability and concrete positive and
negative trigger boundaries, but keep workflow steps in the body.

### 2. Progressive disclosure is universal guidance

The standard defines three levels: always-visible metadata, activated
instructions, and on-demand resources. It recommends `SKILL.md` under 500 lines
and direct, one-level file references.
[Specification](https://github.com/agentskills/agentskills/blob/69ef37e9424c0a7ea9dd2293b559e43ec8176379/docs/specification.mdx#L176-L237)

Anthropic, OpenAI's legacy creator, and Vercel repeat the same three-layer model
and size target. [Anthropic](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/skill-creator/SKILL.md#L73-L109),
[OpenAI](https://github.com/openai/skills/blob/49f948faa9258a0c61caceaf225e179651397431/skills/.system/skill-creator/SKILL.md#L127-L213),
[Vercel](https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/AGENTS.md#L71-L79)

Superpowers implements the same economics without using the standard directory
names consistently: short core skills link to heavier references, scripts, and
other named skills. It sets even tighter word targets for frequently loaded
skills. [Superpowers token efficiency](https://github.com/obra/superpowers/blob/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/skills/writing-skills/SKILL.md#L213-L288)

### 3. Scripts carry deterministic or repetitive work

The standard says scripts should be self-contained, declare dependencies, give
helpful errors, and handle edge cases. OpenAI frames the choice as degree of
freedom: use precise scripts when a process is fragile and text when judgment
is useful. [Specification](https://github.com/agentskills/agentskills/blob/69ef37e9424c0a7ea9dd2293b559e43ec8176379/docs/specification.mdx#L187-L215),
[OpenAI](https://github.com/openai/skills/blob/49f948faa9258a0c61caceaf225e179651397431/skills/.system/skill-creator/SKILL.md#L26-L46)

Vercel's author guide adds a useful executable contract: status to stderr,
machine-readable JSON to stdout, cleanup traps for temporary files, and relative
script paths. Its `vercel-optimize` contribution rules additionally require
stable key order, sorting, indentation, and schema-coupled fixtures.
[Vercel script requirements](https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/AGENTS.md#L81-L88),
[Vercel deterministic output](https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/skills/vercel-optimize/CONTRIBUTING.md#L31-L41)

### 4. Explicit workflows, stop conditions, and evidence gates are common

Strong operational skills are not reference dumps. They state ordered steps,
prerequisites, branches, stop conditions, output shape, and proof required
before completion. Anthropic's creator makes draft/test/review/iterate an
explicit loop. Superpowers composes design, plans, implementation, reviews, and
branch completion, with checkpoints and stop-on-blocker rules. Vercel's
optimization skill gates source inspection on collected metrics and requires
fresh run directories. [Anthropic loop](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/skill-creator/SKILL.md#L6-L28),
[Superpowers workflow](https://github.com/obra/superpowers/blob/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/README.md#L261-L277),
[Superpowers stop rules](https://github.com/obra/superpowers/blob/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/skills/executing-plans/SKILL.md#L16-L63),
[Vercel metric gate](https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/skills/vercel-optimize/SKILL.md#L8-L28)

### 5. Safety is usually procedural, not declarative

Anthropic states a general lack-of-surprise rule and rejects malware,
exfiltration, and unauthorized access. Operational skills go further with
task-specific boundaries. Vercel's deployment skill defaults to previews,
requires approval before git push, and warns that some discovery commands can
link a project as a side effect. OpenAI's current security plugin preserves an
exact authorized scope and treats user context as untrusted analysis data.
[Anthropic safety](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/skill-creator/SKILL.md#L111-L117),
[Vercel deploy boundaries](https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/skills/deploy-to-vercel/SKILL.md#L45-L71),
[OpenAI security scope](https://github.com/openai/plugins/blob/1e285826e604f66f7208f7ac4dba0fe8341d1f57/plugins/codex-security/skills/security-scan/SKILL.md#L20-L29)

The portable spec has no approval or risk model. `allowed-tools` is experimental
and means pre-approved tools, not required capabilities or user authorization.
Vercel's compatibility table shows that clients implement even this field
unevenly. [Specification](https://github.com/agentskills/agentskills/blob/69ef37e9424c0a7ea9dd2293b559e43ec8176379/docs/specification.mdx#L123-L174),
[Vercel compatibility](https://github.com/vercel-labs/skills/blob/435076e78988e1e6ec40d00b0b1d76bdbbc5419a/README.md#L496-L506)

### 6. Testing is common, but no shared behavioral-eval format exists

Anthropic has the most complete skill-specific eval loop: realistic prompts,
with-skill and baseline runs, objective assertions where appropriate, human
review, benchmark aggregation, variance analysis, and separate should-trigger /
should-not-trigger optimization. [Anthropic eval workflow](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/skill-creator/SKILL.md#L141-L238),
[Anthropic trigger evals](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/skill-creator/SKILL.md#L333-L404)

Superpowers tests process documentation with red-green-refactor pressure
scenarios and records the agent's rationalizations. OpenAI's legacy creator
provides initializer and validator scripts. Vercel validates generated skill
artifacts in CI, while its installer has focused tests for malformed metadata,
discovery depth, path traversal, archives, symlinks, updates, and lockfiles.
[Superpowers skill TDD](https://github.com/obra/superpowers/blob/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/skills/writing-skills/SKILL.md#L374-L457),
[OpenAI validation workflow](https://github.com/openai/skills/blob/49f948faa9258a0c61caceaf225e179651397431/skills/.system/skill-creator/SKILL.md#L215-L325),
[Vercel CLI test scripts](https://github.com/vercel-labs/skills/blob/435076e78988e1e6ec40d00b0b1d76bdbbc5419a/package.json#L16-L27),
[Vercel traversal tests](https://github.com/vercel-labs/skills/blob/435076e78988e1e6ec40d00b0b1d76bdbbc5419a/tests/subpath-traversal.test.ts#L1-L111)

### 7. Composition and dependencies remain repository-specific

Superpowers is the clearest composition system: it orders process skills before
implementation skills and marks required background or sub-skills explicitly.
Its plans persist exact downstream skill choices for a later executor.
[Superpowers priority](https://github.com/obra/superpowers/blob/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/skills/using-superpowers/SKILL.md#L18-L31),
[Superpowers plan handoff](https://github.com/obra/superpowers/blob/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/skills/writing-plans/SKILL.md#L54-L80)

OpenAI's current model composes at a larger plugin boundary: a required
`.codex-plugin/plugin.json` can point to skills and companion apps, MCP servers,
agents, commands, hooks, and assets. This is a Codex distribution contract, not
an Agent Skills dependency mechanism. [OpenAI plugin layout](https://github.com/openai/plugins/blob/1e285826e604f66f7208f7ac4dba0fe8341d1f57/README.md#L1-L22),
[Codex Security manifest example](https://github.com/openai/plugins/blob/1e285826e604f66f7208f7ac4dba0fe8341d1f57/plugins/codex-security/.codex-plugin/plugin.json#L1-L44)

No verified collection exposes a portable machine-enforced skill dependency
graph. Dependencies are prose, plugin grouping, installer selection, or local
registry logic.

### 8. Installation metadata and workflow state are different concerns

The Vercel CLI offers the broadest discovery/install UX: multiple source forms,
project/global scope, agent selection, copy or symlink, use-without-install,
find/list/update/remove, and bounded archive downloads.
[CLI install and use](https://github.com/vercel-labs/skills/blob/435076e78988e1e6ec40d00b0b1d76bdbbc5419a/README.md#L1-L142)

It has two kinds of installer state:

- project `skills-lock.json`, intentionally timestamp-free, sorted, and
  content-hashed for reproducible team installs;
- global `.skill-lock.json`, which records source, ref, skill path, folder hash,
  install/update timestamps, dismissed prompts, and last-selected agents.

[Project lock](https://github.com/vercel-labs/skills/blob/435076e78988e1e6ec40d00b0b1d76bdbbc5419a/src/local-lock.ts#L5-L59),
[deterministic project hashing](https://github.com/vercel-labs/skills/blob/435076e78988e1e6ec40d00b0b1d76bdbbc5419a/src/local-lock.ts#L102-L159),
[global lock](https://github.com/vercel-labs/skills/blob/435076e78988e1e6ec40d00b0b1d76bdbbc5419a/src/skill-lock.ts#L6-L72)

That is installation/update provenance, not task continuation. Anthropic's eval
workspace, Superpowers' saved design/plan, and operational run directories are
workflow-specific artifacts. There is no shared state or resume schema.

### 9. Discovery UX is converging faster than publishing semantics

Anthropic supports its Claude plugin marketplace and API. Superpowers documents
separate installation for many harnesses. Vercel's CLI abstracts agent-specific
locations and plugin manifests, while Vercel's collection publishes a sorted
discovery index with SHA-256 digests and reproducible archives.
[Anthropic install surfaces](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/README.md#L31-L61),
[Superpowers installation](https://github.com/obra/superpowers/blob/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/README.md#L49-L118),
[Vercel discovery builder](https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/scripts/build-discovery-index.mjs#L13-L152),
[Vercel publish workflow](https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/.github/workflows/agent-skills-discovery.yml#L17-L49)

These mechanisms are interoperable at the `SKILL.md` level, but marketplaces,
plugin manifests, discovery indexes, signatures, and release channels are not
one universal publication standard.

## Meaningfully absent from the shared format

The verified repositories do **not** establish universal schemas for:

- skill-to-skill dependencies, ordering, profile closure, or conflict rules;
- explicit-only versus model-only invocation across clients;
- required tool availability versus permission to use a tool;
- approval gates, mutation risk, secret handling, or ownership boundaries;
- task checkpoints, resume tokens, runtime state, or evidence freshness;
- behavioral eval prompts, grading, benchmarks, or pass thresholds;
- immutable releases, signatures, content hashes, or update policy;
- plugin UI metadata, apps, MCP servers, hooks, or commands.

Those are legitimate product concerns, but they belong in repository-specific
contracts unless and until the portable specification adopts them.

## Concrete implications for this repository

This repository already aligns unusually well with the strongest patterns:
its current skill bodies are short (39-76 lines), each skill packages
`SKILL.md`, `agents/openai.yaml`, references and scripts as needed, the router
keeps catalog details out of startup context, and deterministic validators
enforce the packaged registry. Its explicit `inspect -> plan -> approval ->
apply -> verify` boundary is stronger than the generic collections' safety
model and should remain so.

Recommended decisions:

1. **Treat canonical frontmatter as a portability boundary.** Keep `name` and
   directory identity exact; make descriptions state capability plus concrete
   positive and negative triggers, not the workflow. Keep `license`,
   `compatibility`, and string metadata spec-compliant. Client-only activation
   fields such as `disable-model-invocation` need a catalog or packaging
   fallback because other clients may ignore them.
2. **Keep the current progressive-disclosure shape.** The short router and
   capability skills should select direct references rather than absorb catalog,
   platform, or service detail. Avoid reference-to-reference instruction chains;
   link required material from each owning `SKILL.md`.
3. **Retain the skill registry as a local product contract, not a claimed
   standard.** `kind`, `scope`, `risk`, `activation`, `delegatesTo`, install
   groups, and `requires` solve real orchestration problems that the external
   format does not. Generate indexes/profiles from one registry and validate
   identity equality, dependency closure, cycles, and valid delegation edges.
4. **Separate three states explicitly.** Installer `skills-lock.json` records
   what skill code is installed; `.selfhost/stack.json` records non-secret
   desired stack and continuation metadata; newly inspected host evidence
   records current reality. Never let either lock or saved intent stand in for
   fresh host inspection.
5. **Add behavior tests only at routing and safety seams.** Keep deterministic
   script fixtures for schemas and rendering. For skills, use a small set of
   realistic should-trigger, should-not-trigger, approval-pressure, stale-state,
   and secret-handling scenarios. Anthropic's paired baselines and Superpowers'
   pressure tests are useful methods; their large harnesses need not be copied.
6. **Preserve deterministic executable contracts.** Prefer JSON stdout and
   diagnostics on stderr, stable key ordering, schema versions, exact error
   classes, and focused fixtures. Scripts that can mutate must keep ownership,
   approval, and scope checks in code rather than relying only on prose.
7. **Use `vercel-labs/skills` for broad installation, but verify distribution
   artifacts independently.** Continue testing both link and copy modes. A
   release index with sorted names, whole-skill digests, and immutable artifacts
   would make drift visible without changing the canonical skill tree.
8. **Use `openai/plugins`, not `openai/skills`, for new Codex marketplace work.**
   Keep `.agents/skills/` as the portable source and project it into a plugin
   bundle only when marketplace distribution is desired. Plugin manifests and
   `agents/openai.yaml` should remain overlays, not second workflow sources.

## Source index

- [Agent Skills format specification](https://github.com/agentskills/agentskills/blob/69ef37e9424c0a7ea9dd2293b559e43ec8176379/docs/specification.mdx)
- [Agent Skills repository boundary guidance](https://github.com/agentskills/agentskills/blob/69ef37e9424c0a7ea9dd2293b559e43ec8176379/AGENTS.md)
- [Anthropic skills README](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/README.md)
- [Anthropic skill creator](https://github.com/anthropics/skills/blob/41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f/skills/skill-creator/SKILL.md)
- [OpenAI skills deprecation notice](https://github.com/openai/skills/blob/49f948faa9258a0c61caceaf225e179651397431/README.md#L1-L3)
- [OpenAI legacy skill creator](https://github.com/openai/skills/blob/49f948faa9258a0c61caceaf225e179651397431/skills/.system/skill-creator/SKILL.md)
- [OpenAI current plugins collection](https://github.com/openai/plugins/blob/1e285826e604f66f7208f7ac4dba0fe8341d1f57/README.md)
- [Superpowers README and workflow](https://github.com/obra/superpowers/blob/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/README.md)
- [Superpowers skill authoring](https://github.com/obra/superpowers/blob/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/skills/writing-skills/SKILL.md)
- [Vercel agent-skills author guide](https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/AGENTS.md)
- [Vercel agent-skills discovery builder](https://github.com/vercel-labs/agent-skills/blob/063bee94c3f4df8453406c830b0a7df0f2860278/scripts/build-discovery-index.mjs)
- [Vercel skills CLI README](https://github.com/vercel-labs/skills/blob/435076e78988e1e6ec40d00b0b1d76bdbbc5419a/README.md)
- [Vercel skills CLI project lock](https://github.com/vercel-labs/skills/blob/435076e78988e1e6ec40d00b0b1d76bdbbc5419a/src/local-lock.ts)
