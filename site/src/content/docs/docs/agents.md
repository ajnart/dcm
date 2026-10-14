---
title: Agents
description: Let Claude Code, Codex, OpenCode or any coding agent run self-host for you with self-host skill and the --json commands.
sidebar:
  order: 3
---

self-host is built to be driven by an agent through plain commands. Paste this one sentence into Claude Code, Codex, OpenCode, OpenClaw or any coding agent:

```text
Install the self-host skill from github.com/ajnart/self-host and help me run my own movie server.
```

Or add the skill yourself (needs Bun or Node.js):

```bash
bunx --bun skills@latest add ajnart/self-host --skill self-host
# or: npx --yes skills add ajnart/self-host --skill self-host
```

The one public skill only routes to the guide built into the binary; installing it deploys nothing. Invoke it with `/self-host` in Claude Code and OpenClaw, `$self-host` in Codex. Agents can also start from [llms.txt](/llms.txt).

## self-host skill

```bash
self-host skill
```

prints the agent guide that matches the installed binary: every command it registers, the JSON events, exit codes, Access procedures and the rules below. Run it again after `self-host self-update`.

## Inspect, plan, approval, apply, verify

Loading the skill conveys intent, never approval. Every change follows the same order:

1. **Inspect** with `self-host doctor --json`, `self-host apps info <app> --json` and `self-host status --json`.
2. **Plan**: show the person the one `self-host install` line and what it will do.
3. **Approval**: wait for an explicit yes. Anything reachable from the internet needs its own yes that names the risk.
4. **Apply** with `--yes`, which authorizes; it is never a preview flag.
5. **Verify** with `self-host status --json`. A running container or an HTTP 200 is not acceptance: check that the App does its job.

## Every conversation

1. Run `self-host status --json` first. It answers "where is X?": each App's `description`, `addresses` and `state`, plus `home`, `dashboard` and `profile`. With no Project yet it exits 1 with "no Project yet"; run `self-host profile --json` instead.
2. If the Profile's `experience` is empty, ask once: "Have you run your own server or used Docker before, or is this all new to you?" Save the answer with `self-host profile set experience new` or `self-host profile set experience advanced`. A skipped question means new.
3. **New**: one question at a time, plain words, a sentence before and after every change, and no talk of Docker, ports or Compose unless Docker must be installed. **Advanced**: terse, with the exact flags.
4. At the end of every setup, give the Recap from `self-host status --json`: each App in plain words with its Address, where the Home folder is, and how to sign in with `self-host credentials`, never quoting a secret. Then offer `self-host share`, which prints a postable install line and site link for the Catalog Apps only.

## The --json commands

```bash
self-host doctor --json
self-host apps list --json
self-host apps info ntfy --json
# only after approval:
self-host install ntfy --exposure local --yes --json
self-host status --json
```

- `install`, `setup`, `start`, `stop`, `restart`, `update`, `remove`, `config set`, `backup`, `restore` and `doctor` print one JSON event per line: `run.start`, `step.start`, `step.ok`, `step.skip`, `step.warn`, `step.fail`, `step.manual`, `command`, `info`, `pull.progress` and `run.end`.
- `status`, `profile`, `debug`, `credentials`, `apps list`, `apps info`, `logs` and `host report` print one JSON document.
- Existing keys are stable; new fields are additive.

A `step.fail` event carries what the agent needs to finish the step by hand:

```json
{
  "event": "step.fail",
  "app": "sonarr",
  "step": "download-client",
  "error": "qBittorrent refused login",
  "url": "http://192.168.1.20:8989",
  "credential": "admin",
  "hint": "Add qBittorrent under Settings › Download Clients."
}
```

## Exit codes

| Code | Meaning                                                                        |
| ---- | ------------------------------------------------------------------------------ |
| `0`  | Success.                                                                       |
| `1`  | Error. Read the `error` field of the last `run.end` or `step.fail`.            |
| `2`  | Setup incomplete: everything is installed, but at least one Setup step failed. |
| `3`  | Only Manual steps remain: finish them in the browser, then retry Setup.        |

After a failure, read `self-host debug <app> --json`, do what the `hint` says, then rerun `self-host setup <app>`. Finished steps are skipped, so reruns are safe.

## Inputs and secrets

- `--set app.key=value` (repeatable) answers non-secret inputs; `--set jellyfin.port=8097` picks a port.
- `--set-file app.key=/path` reads a private input from an owner-only file, and `=-` reads stdin. Never put a secret in a command line, a reply or a file you write. Values land only in the Project's `secrets.env`.
- `self-host credentials` reveals the shared Admin login and per-App API keys. Use it privately and keep its output out of chat, logs and screenshots.

## An isolated Project

Set `SELF_HOST_HOME` to an absolute directory and `SELF_HOST_COMPOSE_PROJECT` to a unique lowercase name, and keep both the same for every later command.

## Apps the Catalog lacks

When the person wants an App that `self-host apps list` does not have, offer the closest Catalog Apps, then tell the maintainers once:

```bash
self-host apps request "<name>" --url <homepage>
```

For software they want to run anyway, add an Unmanaged app: a Compose file under `~/.self-host/extra/<name>/compose.yml`. The CLI lists it with its Address, starts, stops, updates and backs it up, but runs no Setup for it.
