---
name: selfhost-setup
description: Base setup workflow. Intentionally install prerequisites and carry one selected self-hosted stack through plan, approval, apply, browser configuration, verification, metadata recording, and access handoff. Invoke this skill explicitly when you want the stack changed.
disable-model-invocation: true
license: Apache-2.0; see LICENSE.txt
compatibility: Requires Bun 1.4.0 or newer; apply needs the selected runtime, and browser setup uses agent-browser.
metadata:
  selfhost-activation: explicit
---

# Selfhost setup

Activation gate: proceed only when the current user request explicitly invokes
`selfhost-setup` or asks to set up or change a self-hosted stack. Otherwise
return read-only guidance. Continue an authorized setup until it is verified or
a concrete blocker prevents the next safe action.

## Workflow

1. Read [install-profiles.json](references/install-profiles.json). Explain the
   selected base, packs, and extensions in plain language. `basic` is always
   the eight-skill setup/upkeep and Homarr base. Every pack or extension extends `basic`;
   multiple selections form a union and never select another optional profile.
   Use `basic` alone unless the user explicitly chooses more.
2. Read [coding-agents.json](references/coding-agents.json), then run `bun
   scripts/stack.ts prerequisites` with every selected `--profile`, the active
   client ID, and the intended project/global scope. Project scope also
   requires the exact `--project-root`; run returned skill-install commands from
   the reported working directory. This first pass is
   non-mutating and always returns an idempotent browser-install command until
   browser verification is approved. Tell the user what will be installed and
   that the verified pass uses the official browser doctor, which may clean
   stale agent-browser daemon sidecars. Execute the returned `bunx --bun
   skills@latest` and browser commands through the normal agent approval
   boundary, then repeat with `--verify-browser` until `ready` is true. Install
   the official `agent-browser` skill, runtime, and browser through this flow.
3. Run `agent-browser skills get core` after the browser check passes. Treat
   that live workflow as authoritative for browser commands.
4. Invoke `selfhost` to resolve the goal and choices. Invoke `selfhost-host` for
   fresh facts. Record confirmed intent with `selfhost state init`; show the
   exact private-first plan and resolve ownership, paths, ports, and gates.
5. After the user approves the exact apply, initialize `.selfhost/stack.json`
   with `bun scripts/stack.ts init`. Read [lifecycle.md](references/lifecycle.md)
   for the metadata contract and checkpoint rules. Record every selected
   profile's declared service, approval-evidence, and verification-evidence
   obligations; do not replace them with a generic success marker. Bind every
   consuming extension to each service it actually affects with repeated
   `--consume PROFILE=SERVICE`. For media, reserve the one run ID that the
   adapter will create in the next step.
6. Delegate mutation to the selected owner. Every stack invokes
   `selfhost-homarr` after its underlying services are ready, then uses
   agent-browser for onboarding, selected app links and integrations, private
   API-key capture, and UI evidence. The `media` pack instead invokes
   `selfhost-media`, which owns the complete embedded Homarr flow: install its
   harness into this exact project, create the exact recorded run, navigate the
   checked service settings paths, capture fresh API-key refs through the
   adapter's secret-safe helper, fill Homarr directly, and verify all seven
   services. Never deploy a second Homarr for media. Use deterministic API
   setup where the adapter supports it; never copy a key through chat,
   clipboard files, visible shell output, or command arguments.
7. Record `planned`, `applied`, and `verified` checkpoints only after their
   evidence exists. For media, store URLs, usernames, and API keys in the
   adapter-owned mode-`0600` `connections.env`; keep the initial admin password
   out of every file. Other adapters report only their documented private
   profile and handoff paths.
8. For initial media setup, end with the adapter's `handoff` command. Tell the
   user the displayed `admin` username and generated password, plus the stack
   metadata and connection-file paths. Do not retain the password or hide it
   behind a reveal command. Other stacks use only their owning adapter's
   documented credential handoff and never invent a generated password.

## Commands

Resolve this skill directory and use absolute script paths in real runs.

```text
bun scripts/stack.ts profiles [--json]
bun scripts/stack.ts prerequisites --profile basic [--profile media] --agent ID --scope project|global [--project-root ABSOLUTE] [--verify-browser] [--json]
bun scripts/stack.ts init --project-root ABSOLUTE --profile basic [--profile media] [--adapter selfhost-media --run-id ID] [--service ID=OWNER_SKILL] [--consume PROFILE=SERVICE] [--json]
bun scripts/stack.ts show --project-root ABSOLUTE [--json]
bun scripts/stack.ts resume --project-root ABSOLUTE [--json]
bun scripts/stack.ts checkpoint --project-root ABSOLUTE --stage planned|applied|verified [--evidence TYPE:ID] [--json]
bun scripts/stack.ts extend --project-root ABSOLUTE --profile PROFILE \
  [--adapter selfhost-media --run-id ID] [--service ID=OWNER_SKILL] \
  [--consume PROFILE=SERVICE] [--json]
```

Completion requires a passing prerequisite check, recorded selection, explicit
apply approval, direct acceptance evidence for every selected service and
Homarr, and a verified stack checkpoint. Media additionally requires
password-free connection storage and the generated admin password delivered to
the user during the final handoff.
