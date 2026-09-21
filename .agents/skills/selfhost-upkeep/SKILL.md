---
name: selfhost-upkeep
description: Base upkeep workflow. Intentionally resume, inspect, extend, upgrade, repair, or re-verify a stack recorded by selfhost-setup. Invoke this skill explicitly for continuing work on an existing `.selfhost/stack.json` project.
disable-model-invocation: true
license: Apache-2.0; see LICENSE.txt
compatibility: Requires Bun 1.4.0 or newer plus the setup skill and the runtime recorded by the stack.
metadata:
  selfhost-activation: explicit
---

# Selfhost upkeep

Activation gate: proceed only when the current user request explicitly invokes
`selfhost-upkeep`, invokes `self-host` for an existing stack, or asks to change
an existing recorded self-hosted stack.
Otherwise return read-only guidance. Treat saved state as intent, then refresh
real evidence before acting.

## Workflow

1. Confirm the exact project root. Resolve the sibling `selfhost-setup` skill
   and run its `scripts/stack.ts show`. Stop if stack metadata is missing or
   invalid; use its saved profiles only as desired state.
2. Run `scripts/stack.ts prerequisites` for every saved profile, the exact
   project root, active agent, and project scope. The first pass is
   non-mutating. Install missing selected skills from the returned working
   directory and install the official
   `agent-browser` skill, runtime, and browser through the returned commands and
   the active agent's normal approval flow. Disclose that the approved verified
   pass may clean stale agent-browser daemon sidecars, repeat with
   `--verify-browser` until ready, then load `agent-browser skills get core`.
3. Run `scripts/stack.ts resume`. Before `applied`, pending adapter runtime or
   connection state is expected; resume at the recorded checkpoint. At
   `applied` or `verified`, this delegates connection validation to the recorded
   adapter without exposing contents. Stop on missing, invalid, or unsafe state.
4. Invoke `selfhost-host` for fresh host evidence. Revalidate project ownership,
   the selected adapter, services, paths, ports, network, storage, and exposure.
5. Read [references/branches.md](references/branches.md). Choose exactly one
   bounded primary branch and use its named owner and completion evidence.
   Resolve that branch's gates before mutation and retain every previously
   selected service. If it adds a profile, record it with `extend`, rerun the
   expanded prerequisite check, bind every consuming profile to its actual
   service IDs with `--consume PROFILE=SERVICE`, and satisfy that profile's
   approval and verification obligations. Adding `media` must reserve one new
   run with `--adapter selfhost-media --run-id ID`; invoke `selfhost-media` to
   install its harness and create that exact recorded run before apply.
6. Advance `planned`, `applied`, and `verified` only from direct typed evidence.
   A failed verification leaves the prior checkpoint and reports the exact gap.
7. Finish with what changed, every selected service's purpose, evidence,
   blockers, metadata path, and next upkeep action. Display the admin password
   only when the user asks for a fresh access handoff.

Resolve the installed sibling `selfhost-setup` skill and follow its linked
stack lifecycle contract before changing metadata. Completion means the
recorded and observed stacks agree, the requested upkeep branch is verified,
and no unrelated project or secret-bearing output was touched.
