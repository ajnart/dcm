# OpenCode installation

OpenCode supports this repository as an Agent Skill. Install the single
`self-host` skill; the linked workflows, scripts, and references are part of
the same directory. OpenCode plugins are JavaScript or TypeScript modules for
hooks and custom tools, so an executable plugin is not needed for these
instructions. See [Agent Skills](https://opencode.ai/docs/skills/) and
[Plugins](https://opencode.ai/docs/plugins/).

## Install

Install Git and Bun, then run the Skills CLI from the project that should
receive the skill.

For this project only:

```sh
bunx --bun skills@latest add ajnart/selfhost-skills --skill self-host --agent opencode --copy --yes
```

For all projects under your user account:

```sh
bunx --bun skills@latest add ajnart/selfhost-skills --skill self-host --agent opencode --global --copy --yes
```

`--copy` keeps the installation usable after the source checkout is removed.
Omit it to use the Skills CLI's symlink layout. Omit `--global` for a
project-local install. OpenCode discovers project skills under
`.agents/skills/` and global skills under `~/.agents/skills/`.

To register a project `/self-host` command after a direct Skills CLI install,
run the adapter bundled with the installed skill:

```sh
bun .agents/skills/self-host/scripts/install-command.ts --agent opencode --scope project --project-root "$PWD"
```

The adapter checks for command name collisions. The repository's one-step
`bun scripts/install.ts` installs both the skill and command. See the
[command install contract](../.agents/install.md#named-slash-command).

## Update or remove

Update only this skill in the scope where it was installed:

```sh
bunx --bun skills@latest update self-host --project --yes
bunx --bun skills@latest update self-host --global --yes
```

The Skills CLI tracks the source and refreshes installed skills with
`skills update`. For a project-local copy, run the project command from that
project. For a global copy, use `--global`. To remove an installation, use
`bunx --bun skills@latest remove self-host --agent opencode --yes`, adding
`--global` for a global installation.

See the Skills CLI's [install and update options](https://github.com/vercel-labs/skills#readme).

## Use and verify

Start a fresh OpenCode session and ask it to use the `self-host` skill, for
example: “Use the self-host skill to plan a private photo service.” OpenCode
advertises available skills by name and description, then loads the full
`SKILL.md` on demand through its `skill` tool. `/self-host` works after the
optional command adapter is installed; skill discovery alone does not create
that command.

To check discovery locally, run `opencode debug skill` from the installed
project. Confirm the `self-host` entry points to the intended
`.agents/skills/self-host/SKILL.md`. The command also prints skill content.
If it is missing, check that `SKILL.md` is uppercase, the frontmatter contains
matching `name: self-host` and a `description`, the name is not duplicated in
another skill location, and the active agent permits the `skill` tool.

The skill itself requires Git and Bun 1.4.0 or newer. Its deployment workflows
also require Docker and `agent-browser`; installing the skill does not provide
those tools or approve a host change. Follow its inspect, plan, approval,
apply, and verify steps.
