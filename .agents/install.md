# Installation contract

## Interactive install

Run the installer from the project that should receive the skills:

```bash
bunx --bun skills@latest add ajnart/selfhost-skills
```

The installer asks which skills and agents to target. With no scope flag it
installs project-locally; add `--global` when the choices should be available
from every project, and add `--copy` when direct copies are preferred. Select
the nine `basic` skill IDs below, starting with `self-host`, then only the pack or extension IDs needed
by this stack. Every portable description starts with `Base`, `Media pack`, or
`Optional`; clients that render `agents/openai.yaml` also receive numbered base
display names.

The profile manifest in
[`skills/selfhost-setup/references/install-profiles.json`](skills/selfhost-setup/references/install-profiles.json)
defines the exact sets and
their service, approval-evidence, and verification-evidence obligations:

- `basic` contains `self-host`, `selfhost-setup`, `selfhost-upkeep`, `selfhost`,
  `selfhost-host`, `selfhost-compose`, `selfhost-operations`,
  `selfhost-homarr`, and `selfhost-verify`.
- `media` extends `basic` with `selfhost-media`.
- `backup`, `ingress`, `observe`, `research`, and `vpn` each extend `basic`
  with the matching `selfhost-<id>` capability.
- Multiple packs and extensions form one union. They never select each other,
  and no optional pack or extension is selected by default.

Profiles marked for explicit service consumption must bind each affected
record with `--consume PROFILE=SERVICE` during stack initialization or
extension. An unrelated service record never satisfies that obligation.

Selecting a pack or extension during `$selfhost-setup` or
`$selfhost-upkeep` resolves its `basic` dependency. The prerequisite check
returns one exact install command for any missing members.

The common coding-agent IDs and their checked project/global skill targets are
defined once in
[`skills/selfhost-setup/references/coding-agents.json`](skills/selfhost-setup/references/coding-agents.json).
They cover Amp, Claude Code, Cline, Codex, Cursor, Gemini CLI, GitHub Copilot,
Kiro CLI, OpenCode, Pi, Roo Code, and Windsurf.

## Non-interactive install

Install every packaged skill globally for the checked common-agent set:

```bash
bunx --bun skills@latest add ajnart/selfhost-skills --skill '*' --agent codex --agent claude-code --agent kiro-cli --agent pi --agent roo --agent windsurf --global --copy --yes
```

For a project-local install, omit `--global`:

```bash
bunx --bun skills@latest add ajnart/selfhost-skills --skill '*' --agent codex --agent claude-code --agent kiro-cli --agent pi --agent roo --agent windsurf --yes
```

`--skill '*'` selects the complete repository, the repeated `--agent` flags
limit targets, `--copy` writes each distinct client directory, and `--yes`
accepts the resolved non-interactive selection. Codex represents the universal
`.agents/skills` target shared by Amp, Cline, Cursor, Gemini CLI, GitHub Copilot,
and OpenCode, so the command writes that directory once. Omit `--copy` to use
the installer's normal link mode.

For a named selection, repeat `--skill` and include the complete profile. This
example installs the base for Codex only:

```bash
bunx --bun skills@latest add ajnart/selfhost-skills \
  --skill self-host --skill selfhost-setup --skill selfhost-upkeep --skill selfhost \
  --skill selfhost-host --skill selfhost-compose \
  --skill selfhost-operations --skill selfhost-verify \
  --agent codex --global --copy --yes
```

Use `bunx --bun skills@latest add ajnart/selfhost-skills --list` for read-only
discovery. `--all` is broader than `--skill '*'`: it targets every supported
agent as well as every skill.

## First use

Invoke the public entry for every lifecycle: `$self-host` in Codex,
`/self-host` in Claude Code, or `/skill:self-host` in Pi. Other
clients expose skills through their own picker or invocation UI; Agent Skills
does not standardize that UI. Setup checks the selected profile closure and
installs missing skills plus the official `agent-browser` skill, runtime, and
browser through the active agent's normal approval flow.
The initial check is non-mutating. After approval, setup repeats it with
`--verify-browser`; the official doctor may clean stale agent-browser daemon
sidecars. Setup then creates `<project>/.selfhost/stack.json` and carries the
selected stack through apply and verification.

Run the same `self-host` command from the recorded project to resume, extend,
upgrade, repair, or re-verify it. Ask for plan-only behavior when no apply is wanted.

For the managed media pack, the private `connections.env` stores local URLs,
usernames, and API keys needed for later wiring. It never stores the generated
initial admin password. Final setup tells the user the `admin` username and
generated password directly, along with the metadata and connection-file paths.

## Packaging boundary

The installer discovers `.agents/skills/<name>/SKILL.md` and installs each
whole skill directory. Runtime behavior must not depend on arbitrary source
repository files. Both link and copy installs must work without a later clone
or checkout, so every skill packages its required `agents/`, `scripts/`,
`references/`, and `assets/` content.

The release ZIP projects the canonical `.agents/skills/` tree to one native
`skills/` directory with one immediate child per skill and adds the root
Agent Plugins 1.0 `plugin.json`. The manifest does not list skills because
component discovery is fixed by the specification. A `.claude-plugin/`
compatibility manifest remains for Claude Code. The generated, hash-checked
projection is not a second editable source tree.
