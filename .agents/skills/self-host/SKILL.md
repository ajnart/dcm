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

With no goal, ask what the user wants to self-host or replace.

## Route

1. `command -v self-host`. If missing, follow
   [CLI install and troubleshooting](references/cli-install.md).
2. Run `self-host skill` and follow the guide it prints. It matches the
   installed binary and covers New and Advanced users.
3. No "Two kinds of users" section means an old binary: run
   `self-host self-update`, then `self-host skill` again. If it is still
   missing, follow the printed guide anyway: plain words for newcomers, exact
   flags for advanced users.
4. Docker with Compose v2 is needed to deploy; `self-host doctor` checks it.
   Fix failures with [troubleshooting](references/cli-install.md#troubleshooting).
5. `self-host skill` is an unknown command but
   `self-host doctor --scope plan --json` succeeds: this is the older
   TypeScript CLI. Use the legacy workflows below.
6. A saved legacy owner exists (`.selfhost/shared/*/state/revision-*.json`,
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
