---
name: selfhost-setup
description: Base setup workflow. Install selected prerequisites and carry one self-hosted stack through plan, approval, script-first apply, verification, metadata recording, and access handoff. Internal workflow loaded for requested setup.
disable-model-invocation: true
license: Apache-2.0; see LICENSE.txt
compatibility: Requires Bun 1.4.0 or newer; apply needs the selected runtime, and browser setup uses agent-browser.
metadata:
  selfhost-activation: explicit
---

# Selfhost setup

Activation gate: proceed for explicit `selfhost-setup`, `self-host` setup
intent, or a request to change a self-hosted stack. Continue until verified or
concretely blocked.

Start with the [conversation contract](../selfhost/references/conversation.md).
Preserve the requested service while loading or asking for the **New** or
**Advanced** setup path. Ask only for choices that path leaves open. Let
`defaults` accept its non-secret defaults; collect a credential policy, never a
password in chat. Confirm the exact selection before the apply gate.

Every initial installation is loopback-only. **New** includes Homarr in that
installation. **Advanced** installs and verifies the requested service without
optional Homarr or Vaultwarden first, then offers each addition separately.

## Workflow

1. Read [install-profiles.json](references/install-profiles.json). Explain the
   selection plainly. Start with the internal `basic` capability profile, which
   is unrelated to the user-facing **New** path; add only selected
   packs/extensions. Their union retains basic setup, upkeep, and Homarr
   capability without deploying Homarr unless selected. If the user declines
   Homarr, omit its service and verification rows; use the focused app owner or
   Compose recipe. The fixed seven-service media adapter still has a Homarr
   requirement, so select another owner or report that adapter gap for an
   app-only media plan.
2. Read [coding-agents.json](references/coding-agents.json), then run `bun
   scripts/stack.ts prerequisites` with every selected `--profile`, the active
   client ID, and the intended project/global scope. Project scope also
   requires the exact `--project-root`; run returned installation commands from
   the reported working directory. This first pass is
   non-mutating and checks only selected skill files by default. Install any
   missing skill through the normal approval boundary, then repeat until
   `ready` is true. Do not install a browser for a script-first path.
   If a service script fails or visual proof is requested, repeat with
   `--verify-browser`, explain that the official doctor may clean stale
   agent-browser daemon sidecars, and install/verify its skill, runtime, and
   browser through the returned commands.
3. Only for browser fallback, run `agent-browser skills get core` after the
   browser check passes. Treat that live workflow as authoritative.
4. Resolve choices with `selfhost`. For **New**, keep default Homarr selection.
   For the initial **Advanced** plan, pass `--select control-plane=none` unless
   Homarr was explicitly requested. Confirm the username (`admin` for managed
   media if the user accepted defaults); the adapter generates its password.
   Inspect with `selfhost-host`, record `selfhost state init`, and resolve
   ownership, paths, and ports. Bind every initial published port to loopback;
   do not ask for another exposure mode yet.
5. After the user approves the exact apply, initialize `.selfhost/stack.json`
   with `bun scripts/stack.ts init`. Read [lifecycle.md](references/lifecycle.md)
   for the metadata contract and checkpoint rules. Record every selected
   profile's declared service, approval-evidence, and verification-evidence
   obligations; do not replace them with a generic success marker. Bind every
   consuming extension to each service it actually affects with repeated
   `--consume PROFILE=SERVICE`. For media, reserve the one run ID that the
   adapter will create in the next step.
6. Delegate mutation to the selected owner. For `full`, execute the stages in
   [lifecycle.md](references/lifecycle.md#full-stack-stages) and reuse one Homarr.
   A stack with Homarr invokes
   `selfhost-homarr` after its underlying services are ready, then uses
   its bounded API paths for integrations and MCP where supported; use
   agent-browser only for a failed path or requested UI evidence. The `media`
   pack instead invokes
   `selfhost-media`, which owns the complete embedded Homarr flow: install its
   harness into this exact project, create the exact recorded run, use the
   script-first setup paths, and verify all seven services. Never deploy a
   second Homarr for media. Use checked browser paths and private credential
   helpers only as fallback; never copy a key through chat,
   clipboard files, visible shell output, or command arguments.
7. For **New**, after Homarr and the requested service pass verification, use
   the checked `agent-browser` fallback to create or update the two private
   onboarding Notebook widgets defined by `selfhost-homarr`; no bounded
   `selfhost-homarr` API path creates them. Run the prerequisite check with
   `--verify-browser` first, then capture evidence for their kind, exact content,
   and private board placement. Do not place credentials in either widget.
8. Record `planned`, `applied`, and `verified` checkpoints only after their
   evidence exists. For media, store URLs, usernames, and API keys in the
   adapter-owned mode-`0600` `connections.env`, which stays password-free.
   Other adapters report only their documented private profile and handoff paths.
9. If saved media credentials were requested, run the adapter's `handoff`:
   `.sessions/<run>/artifacts/private-handoff.json` (0600) contains the generated
   password, usernames, available API keys, URLs and storage paths. Return only
   its path and the separate redacted report. Never print its contents. For
   `full`, follow [the combined handoff](references/household/full-handoff.md)
   after binding the household credentials; its partial status must stay visible
   until every selected service is accepted. Other stacks use their owning
   adapter's documented private handoff.

## Helpers

Run `scripts/stack.ts --help` by absolute path for command syntax. Read
[lifecycle.md](references/lifecycle.md) for profile consumption, checkpoints,
and continuation. Prerequisites check one installed `self-host` package and
its selected workflow files; profiles do not require separate skill installs.

Completion requires a passing prerequisite check, recorded selection, explicit
apply approval, direct acceptance evidence for every selected service (and
Homarr when selected), and a verified stack checkpoint. **New** also requires
both private Homarr onboarding Notebook widgets. Media additionally requires
password-free connection storage and, when requested, the owner-only private
credential export with its path delivered to the user.

After the initial **Advanced** completion summary, ask separately whether to add
Homarr and Vaultwarden. Apply each accepted addition through a new exact plan
and approval. When both choices finish, ask whether phone access away from home
is wanted; a yes starts a separate Tailscale plan and approval flow.
