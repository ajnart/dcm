# Install self-host

The package has one public `self-host` skill. Its internal workflows and service
recipes are included as ordinary files and loaded only for the current task.
Profiles select behavior and services, not separate packages to install.

## One-step Pi, OpenCode, and Codex install

Clone the repository, then run its installer for the project you use with your
agent:

```bash
git clone https://github.com/ajnart/selfhost-skills.git /tmp/selfhost-skills
bun /tmp/selfhost-skills/scripts/install.ts --agent pi --agent opencode --agent codex --scope project --project-root /path/to/project
```

The installer uses the Skills CLI to copy the whole skill and then registers
the Pi/OpenCode command adapters. Run the same command after pulling updates.
Use `--scope global` for a global install; `--codex-prompt` additionally
registers Codex's deprecated global `/prompts:self-host` adapter. Codex's
supported invocation is `$self-host` or `/skills` at either scope.

For an install from an extracted release ZIP, invoke its `scripts/install.ts`
the same way. Before removing the skill with your skill manager, remove managed
project commands from an installed skill copy:

```bash
bun /path/to/installed/self-host/scripts/install-command.ts --remove --agent pi --agent opencode --scope project --project-root /path/to/project
```

Use `--scope global` for global commands and add `--agent codex` if you also
installed the optional Codex prompt. Removal never touches project state or
deployed services.

## Skills CLI

Install Git and Bun 1.4.0 or newer. From the project that will own the stack:

```bash
bunx --bun skills@latest add ajnart/selfhost-skills --skill self-host
```

Choose the agent and scope interactively. For a complete global copy for the
six clients below:

```bash
bunx --bun skills@latest add ajnart/selfhost-skills --skill self-host --agent codex --agent claude-code --agent opencode --agent pi --agent openclaw --agent hermes-agent --global --copy --yes
```

Use only the desired `--agent` flags. Omit `--global` for project scope; omit
`--copy` for symlink installs. `--all` targets all agents supported by the CLI.
Read-only discovery: `bunx --bun skills@latest add ajnart/selfhost-skills --list`.
The upstream CLI also documents `npx skills add`; this repository uses Bun to
run both installation and its bundled TypeScript helpers.

## Native Pi package

After `v1.0.0` is published, install this repository through Pi's package manager:

```bash
pi install git:github.com/ajnart/selfhost-skills@v1.0.0
```

The root `package.json` exposes the canonical `.agents/skills` directory to Pi.
The skill is available as `/skill:self-host`. Pi saves this command to personal
settings by default; append `--local` to `pi install` to save it in the current
project's `.pi/settings.json`, which Pi loads after project trust is granted.
Move the Git ref to a newer released tag before `pi update --extensions`;
updating alone does not advance a pinned ref. See the [Pi package
docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)
and [Pi skills docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md).

## Native Claude Code plugin

After the matching release and `plugin-claude` ref are published:

```bash
claude plugin marketplace add ajnart/selfhost-skills@plugin-claude
claude plugin install selfhost-skills@selfhost-skills-claude
```

Invoke `/selfhost-skills:self-host`. To refresh, run
`claude plugin marketplace update selfhost-skills-claude` and
`claude plugin update selfhost-skills@selfhost-skills-claude`; start a new
session or reload plugins if Claude asks. This route installs the published
archive into Claude's plugin cache. A direct Skills CLI install remains
`/self-host`; remove any duplicate entry from the same scope after checking
the plugin. See [Claude marketplace installation](https://code.claude.com/docs/en/discover-plugins)
and [archive sources](https://code.claude.com/docs/en/plugin-marketplaces).

## Native Codex plugin

After the matching release and `plugin-codex` ref are published:

```bash
codex plugin marketplace add ajnart/selfhost-skills --ref plugin-codex
codex plugin marketplace list
codex plugin add selfhost-skills@selfhost-skills-codex
```

Alternatively, select the `selfhost-skills-codex` marketplace in the ChatGPT
desktop Plugins Directory and install `selfhost-skills`. Start a new task and select its
`self-host` skill; record the picker label shown by your client. Refresh the
catalog with `codex plugin marketplace upgrade selfhost-skills-codex` before
installing a newer version. The Plugins Directory installs a cached copy;
the source checkout is not the runtime dependency. `codex plugin add` was
confirmed with Codex CLI 0.156.1; the [Codex marketplace and desktop install
guide](https://developers.openai.com/plugins/build/plugins) documents the
catalog and UI route.

For OpenCode, follow the [native skill discovery check](https://github.com/ajnart/selfhost-skills/blob/main/docs/opencode-install.md).
OpenCode loads the Agent Skill directly and does not require an executable
JS/TS plugin for this workflow. [OpenCode skills](https://opencode.ai/docs/skills/).

## Agent paths and invocation

These are the Skills CLI targets checked against its official source. Clients
may support additional paths; the setup helper uses
[coding-agents.json](skills/self-host/workflows/selfhost-setup/references/coding-agents.json).

| Agent ID | Project skill directory | Global skill directory | Invocation |
| --- | --- | --- | --- |
| `codex` | `.agents/skills` | `~/.codex/skills` (`CODEX_HOME` override) | `$self-host` |
| `claude-code` | `.claude/skills` | `~/.claude/skills` (`CLAUDE_CONFIG_DIR` override) | `/self-host` |
| `opencode` | `.agents/skills` | `~/.agents/skills` | Ask to use `self-host`; client also supports native `.opencode/skills` |
| `pi` | `.pi/skills` | `~/.pi/agent/skills` | `/skill:self-host` |
| `openclaw` | `skills` in the agent workspace | `~/.openclaw/skills` | `/skill self-host` |
| `hermes-agent` | `.hermes/skills` | `~/.hermes/skills` | `/self-host` |

## Named slash command

The Skills CLI installs the skill and its bundled files. It does not register
client command files. The repository installer above does both steps. The bundled
[`install-command.ts`](skills/self-host/scripts/install-command.ts) copies the
single [command template](skills/self-host/commands/self-host.md) to each
client's command directory:

```bash
bun ~/.codex/skills/self-host/scripts/install-command.ts --agent codex --agent pi --agent opencode --scope global
```

For a project-scoped Pi and OpenCode install, run the helper from either
installed `self-host` skill directory with
`--agent pi --agent opencode --scope project --project-root /absolute/project`.
The command file locations are:

| Client | Project | Global | Slash invocation |
| --- | --- | --- | --- |
| Pi | `.pi/prompts/self-host.md` | `~/.pi/agent/prompts/self-host.md` | `/self-host photos` |
| OpenCode | `.opencode/commands/self-host.md` | `~/.config/opencode/commands/self-host.md` | `/self-host photos` |
| Codex CLI / IDE | Unsupported | `$CODEX_HOME/prompts/self-host.md` | `/prompts:self-host photos` |

Pi reads project prompts after project trust; run `/reload` in an active
session. OpenCode reloads command files automatically. Restart Codex CLI or
the IDE extension after changing a custom prompt. Codex custom prompts are
deprecated and have no repository-scoped command directory. Its supported
shared invocation is `$self-host` or the `/skills` picker. The Codex desktop
app is not documented as supporting custom prompts.

The adapter asks the agent to load the installed skill. It grants no host
permissions and retains the skill's approval gates. Re-run the installer
after skill updates; it refuses to replace an unrelated command file.

OpenClaw's installer can recognize legacy `.clawdbot` or `.moltbot` homes;
its default path above is what this repository checks. Custom agent roots must
match the actual client configuration. Agent Skills specifies files, not a
universal slash-command UI. For another compatible client, copy the **whole**
`self-host/` folder into that client's skill directory, then ask it to use the
skill. Agents must have the shell/file capabilities required by the selected
workflow; skill discovery alone does not grant Docker or browser access.

Sources: [Skills CLI](https://github.com/vercel-labs/skills#readme),
[agent targets](https://github.com/vercel-labs/skills/blob/main/src/agents.ts),
[OpenCode skills](https://opencode.ai/docs/skills/),
[OpenClaw skills](https://docs.openclaw.ai/tools/skills),
[Hermes skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/).

## First use and upgrades

Ask for an app or a replacement goal. The agent confirms the target host,
project directory, username, and access needs, plans the change, then executes
approved setup and verifies the result. Run the same skill from the recorded
project to resume or maintain it.

The [profile manifest](skills/self-host/workflows/selfhost-setup/references/install-profiles.json)
retains `basic`, `media`, `full`, and optional extension choices. Installing the
skill does not select those services or grant their mutation permissions.
Setup checks the bundled workflow files and separately checks the official
`agent-browser` skill, runtime, and browser when required.

For an older multi-skill install, install/update `self-host` first. Remove the
old standalone `selfhost` and `selfhost-*` skill entries from the **same agent
and scope** through its installer or skill manager after confirming the new
entry works. Do not delete `.selfhost` project state, private credentials, or
service data. The saved owner/profile IDs are retained for continuation.
Old entries can remain visible until removed or the agent session refreshes;
the new skill never depends on them.

## Packaging and contributor instructions

Source and direct installs use `.agents/skills/self-host/SKILL.md`. The release
ZIP contains `skills/self-host/SKILL.md`, its entire `workflows/` tree, the
Agent Plugins 1.0 `plugin.json`, and Claude Code compatibility metadata.
Both copied and symlinked installs must work without a repository checkout.
Only the public entry uses `SKILL.md`; internal documents use `GUIDE.md` so
recursive skill scanners do not expose them as separate skills.

The source repository's `CLAUDE.md` is a relative symlink to `AGENTS.md`.
On a platform that does not preserve symlinks, enable Git symlink support or
create a local `CLAUDE.md` that imports `@AGENTS.md`. This contributor alias
is separate from installing the skill and is not required in the release ZIP.

Passwords and API keys are generated or captured through owning helpers.
Requested exports go to the documented private mode-0600 handoff file;
ordinary reports contain its path, not its contents.
