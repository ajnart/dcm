# ADR 0006: Make self-host an explicit operator command

Status: accepted on 2026-09-24

## Context

`self-host` can inspect a host and, after approval, install or change services.
The public registry and Codex metadata previously allowed implicit activation.
Pi and OpenCode expose named slash commands through different client resources;
Codex supports explicit `$self-host` or `/skills`, while custom prompts use a
deprecated global `/prompts:` path.

## Decision

Treat `self-host` as user-invoked. Keep one canonical public `SKILL.md` and its
internal `GUIDE.md` workflows. The skill defines routing, approval, and result
requirements; host command entries only supply arguments and load that skill.
Set native no-auto-invocation policy where each client supports it. Package
client adapters from the canonical skill; never copy operational instructions
into the adapters.

A command invocation conveys intent, not approval for host mutation. The
existing inspect → plan → approval → apply → verify boundary remains in force.
The public registry records `explicit` activation; the internal planning
router remains `implicit` only within the selected workflow.

Codex's supported route is `$self-host` or `/skills`. A global custom prompt
may be installed explicitly as a compatibility bridge. Pi and OpenCode may
offer `/self-host` with one owning command entry each.

## Consequences

- Installation, update, and removal must manage the command entry alongside
  the skill for clients that require one.
- A generic Agent Skills package cannot enforce invocation policy across all
  hosts. Client-specific metadata and command-discovery checks determine which
  clients can be called command-first.
- Release evidence distinguishes file installation, command discovery, skill
  routing, and live service acceptance.
