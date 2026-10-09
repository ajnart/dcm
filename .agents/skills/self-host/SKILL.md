---
name: self-host
description: "Install, configure, back up and repair self-hosted apps with the `self-host` CLI, from a plain goal or exact choices."
disable-model-invocation: true
license: Apache-2.0; see LICENSE.txt
compatibility: Needs the self-host CLI and Docker with Compose to deploy; legacy workflows also need Git and Bun 1.4.0+, browser fallback agent-browser.
metadata:
  selfhost-activation: explicit
  opencode/autoinvoke: "false"
  opencode/slash: "false"
---

# Self-host

With no goal, ask what to replace.

## Route

[Locate the CLI](references/cli-install.md) and run `self-host skill`.

- **It prints the agent guide:** this is the Go CLI, the current product. Read
  the guide fully and follow it, including its New and Advanced paths. Use no
  other workflow unless a saved legacy owner exists.
- **It does not, but `self-host doctor --scope plan --json` succeeds:** this is
  the older CLI. Use the legacy workflows below.
- **A saved legacy owner exists** (`.selfhost/shared/*/state/revision-*.json`,
  `.selfhost/stack.json`, `.selfhost/cli.json`,
  `.selfhost/bundles/*/household-bundle.json`, `.selfhost/app-batch.json`, or
  `.selfhost/app-state/*.json`): preserve it, use upkeep, and never create a
  competing project. Ask when distinct owners compete.

## Legacy workflows

Read the [conversation contract](workflows/selfhost/references/conversation.md).
Use the supplied absolute root, or `$HOME/.selfhostedskills` for a new one after
saying so. Pass the exact root and saved project ID to every command.

| Request | Read |
| --- | --- |
| New install or replacement | [Setup](workflows/selfhost-setup/GUIDE.md) |
| Existing project | [Upkeep](workflows/selfhost-upkeep/GUIDE.md) |
| Plan or compare | [Planning](workflows/selfhost/GUIDE.md) |

Read [service choices](references/choosing-services.md) and
[access choices](references/access.md) when needed. When Homarr is selected, read
back its private recap and board before **View dashboard**.

## Rules

Follow inspect → plan → approval → apply → verify. Generate credentials through
the CLI; reuse saved owner-only files. Report paths, never secrets. `defaults`
approves neither deployment, public access, nor destruction.

Report changed services, purposes, verified links, and blockers. Never call a
running container or HTTP 200 proof that setup worked.
