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

## New shared project (default)

Turn the user's outcome into one configured capability, with Homarr as the
basic user's front door. Recommend catalog defaults; accept explicit app
choices or Homarr opt-out. Ask only for missing plan-changing choices, not
one setup interview per app. Keep routine technical choices and command output
in working evidence; show a short plan, required approvals, progress and a plain
recap. The CLI still has separate exact mutation gates: one outcome request
does not authorize unseen actions.

1. **Resolve.** Read the [conversation contract](../selfhost/references/conversation.md).
   Use the supplied root, or disclose the proposed root before writing.
   Inspect for an existing owner first; route it to upkeep. Locate the installed
   CLI and run its planning doctor and recipe discovery. Resolve the full goal
   through the catalog, reuse shared services, and select frontend recipes
   rather than separately installing their bundled databases/cache services.
   The legacy planner's stage graph is discovery guidance here, not authority
   to create independent owners. Done: every requested outcome maps to selected
   recipes, dependencies and explicit support gaps.
2. **Plan and apply.** Read [shared-project CLI usage](references/shared-project-cli.md).
   Use `app shared plan` with the exact root, project ID, app selection and
   declared install inputs. Derived recipes use the same fresh/add contract.
   Present purposes, pinned images, paths, exact ports/binds, credential-input
   requirements, first-run coverage and acceptance gaps. Loopback is local to
   the Docker host, not the user's other devices. After exact approval, use
   `app shared apply` with the unchanged selection and returned token.
   Done: one saved Compose owner exists for all selected units. Preserve partial
   checkpoints and inspect before recovery; another project cannot conceal an
   unsupported recipe or failed apply.
3. **Configure and connect.** Review `app shared setup` without approval,
   including installed-peer effects and declared non-secret inputs. Apply its
   reviewed setup token and exact step tokens; independently reviewed actions
   may use repeated `--approve-step`. Continue saved checkpoints and refresh
   the review after changed state or adapter code. The CLI generates/reuses
   private passwords and keys; external secrets use declared owner-only file
   or stdin boundaries. Users never copy integration values between apps.
   Finish required app accounts, dependency wiring and first-account closure;
   closure uses separate `transition-plan`/`transition-apply`, followed by
   setup verification. Done: each required relationship has direct readback,
   or is explicitly unfinished. A root folder, downloader category, account
   or API key alone does not prove the services are connected.
4. **Publish Homarr.** When selected, complete its administrator/key checkpoint,
   review `app shared homarr-plan`, and separately approve `homarr-apply`.
   Reuse saved credentials for supported integrations, widgets, tiles and the
   private stack recap. Read `homarr-status --live` for board/recap structure,
   Homarr-origin pings, stored-integration tests and supported widget queries. Done: selected resources
   read back correctly; tile-only apps, missing inputs and omitted widgets
   remain named gaps. A missing integration-test endpoint stays unverified;
   these checks do not prove rendered content.
5. **Accept and hand off.** Refresh `app shared status --live`. Use only checks
   that support this exact shared owner to verify login, app function, required
   relationships, intended client access and restart persistence. The bounded
   shared `acceptance-begin`/`acceptance-finish` route covers only apps with a
   packaged result contract; discover coverage from the CLI and review its
   app-specific canary, scoped restart and exact approvals separately. Other apps
   need available owner-compatible checks; standalone `app` acceptance commands
   are not shared-owner aliases. Read back the private recap and board before
   presenting **View dashboard** as the primary link. Finish with changed
   capabilities and purposes, verified access scope, private handoff paths,
   recovery status and remaining blockers. Direct URLs are available when
   requested; Homarr links do not proxy the services.

### Fallback and completion

Use deterministic API, CLI, config-file or environment paths first. For an
unsupported or failed step, inspect its saved checkpoint and load the owning
adapter's documented fallback. Use agent-browser only after its prerequisite
check and live core instructions, with protected credential helpers and the
same app identity, project and desired state. Reconcile uncertain writes before
retrying; verify the same completion criterion after fallback. Keep mechanism
changes out of the basic user's workflow, but report actual gaps. If this shared
owner has no safe fallback or private credential transport, stop at that named
boundary. An API failure is not a request for the user to copy keys or configure
every service manually, nor permission for an ad-hoc browser repair.

Completion requires one Compose owner, approved first-run changes, configured
dependencies and direct acceptance for every requested capability, plus Homarr
readbacks and verified client access when selected. `completed` Compose state,
`ready` setup, HTTP 200 and dashboard structure are narrower observations.
Keep missing adapters and acceptance routes unfinished. Shared HTTPS has
separate route-add, transport-proof and canonical-origin gates; DNS/trust and
intended-client verification remain separate. Shared removal preserves data
and blocks retained dependencies. Restore eligible standard apps through the
reviewed `reinstall` route in the shared-project reference, then reverify their
existing accounts and integrations; other restore cases remain unsupported. Image-only
updates use the reviewed transition in the shared-project reference. Dashboard
checks do not establish a compatibility score. VPN
protection needs tunnel-break fail-closed proof; backup protection needs an
isolated restore. No legacy stack, batch or bundle record is created here.

## Existing or explicitly selected legacy owner

Preserve matching stack, per-app, batch, media and household-bundle owners;
resume them through upkeep. Use this branch for an explicitly selected legacy
route, never as an automatic escape from missing shared coverage. Sharing a
filesystem root does not satisfy the new single-Compose contract.

Read the [conversation contract](../selfhost/references/conversation.md).
Retain a saved New/Advanced choice: New includes Homarr and resolves non-secret
defaults; Advanced installs the requested service first and offers optional
Homarr/Vaultwarden afterward. Never collect passwords in chat. Confirm the exact
root, disclose local artifacts and create only a confirmed absent root as mode
`0700`; existing ownership/permissions stay unchanged.

1. Read [install profiles](references/install-profiles.json) and
   [agent layouts](references/coding-agents.json). Select `basic` plus only
   requested extensions. Run the absolute `scripts/stack.ts prerequisites`
   command for those profiles, the active client and selected root/scope.
   Follow returned approved installation actions until ready. Browser checks
   are conditional on fallback or required/requested visual evidence; disclose
   that their verified pass may clean stale browser daemon sidecars.
2. Resolve the exact catalog plan and fresh host evidence through their owners.
   Present exposure, storage, services, support gaps and approval. Media's
   all-interface mode needs verified firewall scope; otherwise review its
   explicit host-only mode and any separate private route. Defaults do not
   approve apply, public access, migration or destruction.
3. Use the selected owner below, its exact plans and separately approved
   mutations. Preserve every selected stage and reuse one Homarr; historical
   state and exported credentials are not live acceptance.

   | Selected owner | Contract |
   | --- | --- |
   | Legacy profile stack or full preset | [Lifecycle and full-stage gates](references/lifecycle.md); initialize stack metadata after exact apply approval, bind consuming extensions and record typed evidence |
   | Explicit mixed independent app batch | [Batch graph, approvals and recovery](references/app-batch.md); retain its ledger, not a parallel stack record |
   | Docmost adapter | [Pinned owner, acceptance and protected fallback](references/docmost-cli.md) |
   | Media + Immich + Docmost + Vaultwarden bundle | [Household sequencing, routes, attachment and finalization](references/household-cli.md); retain its exact bundle input |

   Individual bounded recipes use the installed CLI's current recipe contract
   and help: image, identity and port choices must match plan and apply. Resume
   only their saved checkpoints. Media delegates to `selfhost-media`, which owns
   its harness, exact recorded run, all seven services and embedded Homarr.
   Unsupported catalog/out-of-catalog apps require a separately reviewed
   experimental plan with current official facts and a private credential
   boundary; this guide does not confer managed support.
4. Finish each owner's direct account, function, connection, client-access
   and persistence checks. Use protected browser fallback only under that
   owner's contract. When Homarr is selected, publish and read back its private
   recap and supported resources before the dashboard handoff. Advance legacy
   `planned`, `applied` and `verified` only with required typed evidence;
   bundle finalization records supplied observations, not independent checks
   or a measured speed claim by itself.
5. Report verified outcomes and unfinished gates. Credential export is opt-in:
   return only the owner-only handoff path and redacted report. Full profiles
   use [combined handoff](references/household/full-handoff.md), keeping partial
   status visible. Recovery stays unverified unless selected protection passes
   an isolated restore; real vault migration needs its recovery gate first.

Use absolute `scripts/stack.ts --help` for metadata syntax instead of duplicating
command tables. Completion follows the selected owner's contract, not a generic
success marker. Offer optional additions only after the requested scope is
accepted, with fresh plans and approvals.
