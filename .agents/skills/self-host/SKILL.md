---
name: self-host
description: "Conversational self-host control panel: turn a goal into one shared Compose project with Homarr, or maintain its saved apps."
disable-model-invocation: true
license: Apache-2.0; see LICENSE.txt
compatibility: Requires Git and Bun 1.4.0 or newer; deployment needs the selected runtime, and browser fallback needs agent-browser.
metadata:
  selfhost-activation: explicit
  opencode/autoinvoke: "false"
  opencode/slash: "false"
---

# Self-host

Use the private `self-host` CLI: bare `self-host` opens the terminal control
panel; agents use explicit JSON commands. This skill handles goals and approval;
the CLI owns recipes, state, credentials, and mutations.

With no goal, ask what to replace. `plan`/`compare` is read-only; new goals use
setup; existing-project requests use upkeep. Read the
[conversation contract](workflows/selfhost/references/conversation.md).
Recommend catalog defaults, one shared Compose project, and Homarr; accept
customization or opt-out. Ask only for missing plan-changing choices.

Use the supplied absolute root. Otherwise reuse the current project only with
a saved owner: `.selfhost/shared/*/state/revision-*.json`, `.selfhost/stack.json`,
`.selfhost/cli.json`, `.selfhost/bundles/*/household-bundle.json`,
`.selfhost/app-batch.json`, or `.selfhost/app-state/*.json`. A batch owns its
listed app records. Ask when distinct owners compete. Preserve legacy owners;
never create a competing project. For a new root, propose
`$HOME/.selfhostedskills` before writing. Pass the exact root and saved project
ID to every command.

[Locate the CLI](references/cli-install.md); run
`self-host doctor --scope plan --json` before setup and
`self-host catalog recipes --json` for discovery. Shared plan/setup reviews
determine actual coverage; pending work remains visible.

| Request | Read |
| --- | --- |
| New install or replacement | [Setup](workflows/selfhost-setup/GUIDE.md) |
| Existing project | [Upkeep](workflows/selfhost-upkeep/GUIDE.md) |
| Plan or compare | [Planning](workflows/selfhost/GUIDE.md) |

Read [service choices](references/choosing-services.md) for replacements and
[access choices](references/access.md) for local, LAN, or remote access.

Follow inspect → plan → approval → apply → verify. Generate new credentials
through recipes; reuse saved owner-only files. External credentials use declared
private input boundaries. Report paths, never secrets. `defaults` approves
neither deployment, public access, nor destruction.

Meet workflow completion criteria. Report changed services, purposes, verified
links, artifact paths, and blockers. When Homarr is selected, read back its
private recap and board before **View dashboard**; state verified access scope.
