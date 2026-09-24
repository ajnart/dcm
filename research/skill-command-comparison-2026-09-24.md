# Skill repositories and slash commands

Checked 2026-09-24. Six GPT-6 Luna read-only reviews covered the seven
repositories named below, the current `selfhost-skills` checkout, and the
official Codex, Pi, and OpenCode invocation docs. This report compares
architecture and supported entry points; popularity is not evidence of quality.

## The main distinction

An Agent Skill is a portable `SKILL.md` plus optional bundled resources. A
slash command is registered by an agent host. Installing a skill with the
[Vercel Skills CLI](https://github.com/vercel-labs/skills#install-a-skill) copies
the skill, but does not install every host's separate command resource. There
is no portable syntax that guarantees bare `/self-host` in Codex, Pi, and
OpenCode.

## Repository comparison

| Repository | Skill and architecture | Command and distribution pattern | What it does better than this repo |
| --- | --- | --- | --- |
| [Ponytail](https://github.com/DietrichGebert/ponytail) | A canonical coding skill with focused full/lite/ultra modes, examples, and related review/audit skills. | Separate [commands](https://github.com/DietrichGebert/ponytail/tree/main/commands) and client adapters for Codex, Pi, and OpenCode; its [README](https://github.com/DietrichGebert/ponytail#install) states host-specific invocation instead of promising one syntax. | It treats command registration as a product surface and explains install, use, update, and evidence by host. Its command suite is broader than this repo needs. |
| [Anthropic skills](https://github.com/anthropics/skills) | Independent skill directories, conditional scripts/references/assets, starter template, and Claude plugin packaging. Its [skill creator](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md) emphasizes trigger descriptions, examples, progressive disclosure, and realistic evaluation. | Skill and Claude plugin distribution; no generic `/name` guarantee across the requested hosts. | Clear authoring examples and activation evaluation. Our single public router already follows its progressive-disclosure pattern. |
| [OpenDesign](https://github.com/nexu-io/open-design) | A wider app/CLI/MCP system with a [skill protocol](https://github.com/nexu-io/open-design/blob/main/docs/skills-protocol.md) for metadata, registry precedence, conditional resources, and runtime staging. | [Agent installation](https://github.com/nexu-io/open-design#install-into-your-coding-agent-no-ui) configures MCP or other integrations; an MCP install is not itself a `/open-design` command. | A clear client capability map and a defined resource-staging contract. Its UI and MCP architecture are outside our command requirement. |
| [Archify](https://github.com/tt-a1i/archify) | One focused [skill](https://github.com/tt-a1i/archify/blob/main/archify/SKILL.md) routes to schemas, examples, typed diagram data, validators, and a deterministic delivery CLI. | [Skills CLI installation](https://github.com/tt-a1i/archify#quick-start) and natural-language use. Its shell CLI is artifact tooling, not an agent slash alias. | A very short first-use path, concrete examples, and separate validation receipts and browser proof. |
| [Matt Pocock skills](https://github.com/mattpocock/skills) | A curated collection grouped by engineering job. The [README](https://github.com/mattpocock/skills#reference) labels user-invoked workflows separately from model-invoked practices. | Managed Claude plugin and editable Skills CLI installation, with a named setup invocation and a duplicate-install warning. | Users can see which entry they should call and how installation mode affects updates. |
| [Vercel Skills CLI](https://github.com/vercel-labs/skills) | A distributor, not a domain skill. Its [CLI](https://github.com/vercel-labs/skills#options) covers discovery, list, add, use, update, remove, agents, scope, copy, and symlinks. | `skills add` installs skill directories; `skills use` launches or prepares a skill prompt. Neither registers every host's bare slash alias. | Predictable install/upgrade controls and broad host support, which this repo already uses. |
| [Superpowers](https://github.com/obra/superpowers) | A composable skill library with an activation skill, host adapters, sequential workflows, and platform-specific [install guidance](https://github.com/obra/superpowers#installation). | Codex plugin, Pi package/extension, and [OpenCode plugin](https://github.com/obra/superpowers/blob/main/.opencode/INSTALL.md) register or bootstrap skills in host-specific ways. They do not yield one universal `/superpowers` command. | Host adapters, explicit update/troubleshooting guidance, and separate infrastructure tests and behavior evaluations. |

## Our current position

The canonical [self-host skill](../.agents/skills/self-host/SKILL.md) is already
short and routes one request to one internal `GUIDE.md`; the
[invocation contract](../.agents/invocation.md) and
[install guide](../.agents/install.md) keep workflows and client paths
separate. The catalog, approval boundaries, secret handling, packaging, and
repository checks are more developed than a typical single-skill example.
The gap was command registration: the skill package and plugin manifests did
not make bare `/self-host` available in Pi or OpenCode, and Codex's direct
skill syntax is `$self-host`.

The resulting implementation adds a single bundled
[command template](../.agents/skills/self-host/commands/self-host.md) and an
[installer](../.agents/skills/self-host/scripts/install-command.ts), with a
root installer that registers it alongside the copied skill. They register a
thin prompt entry without copying the operational workflow.

| Host | Supported skill invocation | Optional command adapter | Limitation |
| --- | --- | --- | --- |
| Codex CLI / IDE | `$self-host` or `/skills` picker | `/prompts:self-host` via a global custom prompt | [Custom prompts are deprecated](https://developers.openai.com/codex/custom-prompts). No documented repository-scoped bare `/self-host` command. Desktop support for this prompt route is not documented. |
| Pi | `/skill:self-host` | `/self-host` from a [prompt template](https://pi.dev/docs/latest/prompt-templates) | Project templates require project trust; reload an active session. |
| OpenCode | Load the `self-host` skill | `/self-host` from a [custom command](https://opencode.ai/v2/docs/commands) | The command and skill are separate registered resources. |

## Patterns to keep and next work

1. Keep one operational source: the public skill, selected workflow guide, and
   owned scripts. Host commands should only load that source. Ponytail and
   Superpowers show how adapters can stay shallow.
2. Keep the short install → command → plan/approval → result example current.
   Archify and Matt Pocock make first use clearer with concrete examples.
3. Keep skill compatibility, command availability, and live setup acceptance
   as separate claims. A copied file proves packaging; a client menu check
   proves discovery; a real agent run proves routing; a real host run proves
   service acceptance.
4. Validate the command file and package membership in the existing release
   gate, then run focused Pi/OpenCode/Codex client smoke checks before calling
   the slash experience verified on those clients.
5. Maintain the support matrix against [Codex skills](https://developers.openai.com/codex/skills/),
   [Codex custom prompts](https://developers.openai.com/codex/custom-prompts),
   [Pi commands](https://pi.dev/docs/latest/slash-commands), and
   [OpenCode commands](https://opencode.ai/v2/docs/commands); these are host
   behaviors and may change independently of our skill.

The earlier [Agent Skills ecosystem review](skills-repo-patterns.md) covers
portable skill format, progressive disclosure, and first-party repositories
in more depth. This report focuses on the seven requested repositories and
the command boundary.
