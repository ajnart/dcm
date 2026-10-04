---
name: selfhost-upkeep
description: Resume, inspect, extend, repair, or re-verify one saved self-host project.
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

Use the user's exact project root, or the selected current project from
`SKILL.md`. A saved file is intent, not proof of a running service. Check that
root for `.selfhost/shared/<id>` revision state, `.selfhost/stack.json`, `.selfhost/cli.json`, one
`.selfhost/app-batch.json`, one `.selfhost/app-state/<id>.json`, or
`.selfhost/bundles/<id>/household-bundle.json`. Follow an exact owner named by
the user; otherwise use the sole owner. A batch ledger owns its listed app
records. If distinct owners could match, ask
which one to resume. Stop if none exists or owner-only validation fails.

### Shared Compose project

Read [shared-project CLI usage](../selfhost-setup/references/shared-project-cli.md).
Use its exact saved project ID and root for every command.

1. Read `self-host app shared status --project-root ROOT --project-id ID --json`.
   Add `--live` for owned-container observations. For status or information,
   report the observation limits and stop without setup, repair, or writes.
2. For another capability, resolve its full dependency graph through the
   catalog, reuse installed shared services, and review `app shared add`
   without approval for only the missing recipes. Repeat the exact selection
   with the fresh token. Existing apps, paths, ports and private credentials
   stay unchanged; users never merge Compose files or copy integration values.
   Review setup's installed-peer effects and separately approve required
   account/wiring changes and Homarr publication. A missing shared adapter is
   unfinished work, not permission to install an independent second project.
3. For start/stop, review `app shared start` or `stop` without approval for the
   exact `--app` selection, then repeat with its fresh approval. These commands
   operate saved units and retain data; they do not tear down the project.
   For deselection, use the shared CLI reference's `remove` review/apply route;
   retain data and credentials, and resolve named dependency/link blockers first.
4. Resume first-run work through `app shared setup`; reuse saved owner-only
   credentials and non-secret choices. For first-account environment closure,
   use `transition-plan`, approve `transition-apply`, then rerun setup to verify
   closure. For catalog recipe drift, review `recipe-migration-plan` for one
   app; only reviewed additive static settings have a scoped apply route.
   For image-only changes, use the shared CLI reference's
   `image-transition-plan`/`image-transition-apply` route for one running app.
   Review old/new digest pins and approve the fresh exact-owner token.
   Retain data and credentials, then verify the existing login and function.
   A create `resumeApproval` authorizes only the saved pre-Docker
   checkpoint; attempted or inspect-required work needs bounded inspection.
5. Recheck changed app function, required relationships, client access and
   persistence using checks compatible with this shared owner. Shared ntfy
   has separately approved `acceptance-begin`/`acceptance-finish` canary and
   restart checks; standalone `app` acceptance commands are not aliases for
   shared units. A saved link or adapter-ready outcome is not fresh acceptance.
   For an unsupported or failed step, follow setup's documented fallback
   boundary: protected browser helpers, the same saved owner and equivalent
   verification. Reconcile uncertain writes first. Without a safe fallback,
   report the exact gap instead of asking for manual configuration/key copying.
6. When Homarr is selected, refresh its separately approved publication after
   accepted changes, then use `homarr-status --live` for private board/recap
   structure, Homarr-origin pings, stored-integration tests and supported widget
   queries. A missing test endpoint stays unverified; these checks are not
   rendered acceptance. Read back the private
   recap before giving **View dashboard** as the primary link, with verified
   access scope. Keep individual app URLs discoverable on request. Finish with
   changed capabilities, purposes, direct evidence, recovery status and gaps.
   `app shared handoff` returns private credential references; export values
   only through an explicitly requested private handoff.

Preserve this owner. Legacy `app up|down`, batch, and bundle routes are not
aliases for shared units. Safe reinstallation of removed apps,
full owner retirement and unowned repairs remain named gaps. Start/stop is
data-preserving lifecycle, not capability removal.
For host-only private HTTPS, follow the shared CLI reference's separately
reviewed Caddy addition and TLS-proof routes. DNS changes, client trust and
public access remain separate decisions; reuse an existing route owner.
Dashboard checks do not create
compatibility receipts or raise a verified score. Completion requires direct
evidence for the requested change and its affected dependencies; disconnected
services remain unfinished even when containers and dashboard tiles exist.

### CLI-managed app-only project

1. Run `self-host app status --id ID --project-root ROOT --json` and
   `self-host app info --id ID --project-root ROOT --json`. With one saved app
   and no competing record, top-level `self-host status|info --project-root
   ROOT --json` finds the same owner. Saved stage, URL, paths, and recipe
   purposes are not live health or application acceptance.
   For a saved mixed-app ledger, run top-level `self-host status|info
   --project-root ROOT --json` first. It reads `app batch status|info`, reports
   jobs and any additional app checkpoints, and never replays them. Choose an
   exact app ID for subsequent acceptance or lifecycle work; there is no
   whole-batch up, down, or resume alias.
   For a version-3 batch job still marked `pending`, run `self-host app batch
   resume-plan --project-root ROOT --job ID --json`, review its fresh app plan,
   then use `self-host app batch resume --project-root ROOT --job ID --approve
   FRESH_TOKEN` only after exact approval. The exclusive batch lock and fresh
   plan protect that one never-dispatched job. A per-app lock also excludes a
   direct CLI mutation of the selected app until its batch child finishes.
   Attempted or blocked jobs use
   separately reviewed per-app recovery, not batch replay.
2. For a requested restart, stop, or partial-apply retry, refresh host evidence
   with `self-host inspect-host`. Use the exact approval from app status with
   `self-host app up|down|resume --id ID --project-root ROOT --approve TOKEN`;
   never infer a token from a prior run. The top-level lifecycle aliases use
   the same approval when the owner is unambiguous. Stop on changed recipe,
   ambiguous Docker resources, or failed ownership checks.
3. Run the recipe's separate acceptance checkpoints as relevant. A prepared
   credential file is not proof of an app account; show its owner-only path,
   and use `app handoff --show` only for an explicitly requested private
   credential export. Finish with service purposes, observed access, pending
   acceptance, and the next exact command.

### CLI-managed household bundle

1. Run the installed `self-host bundle plan`, `bundle status`, and `bundle info`
   with `--project-root ROOT`; pass `--input EXACT_BUNDLE_INPUT` when more than
   one bundle exists or the request names one. The CLI validates the owner-only
   input and referenced files; keep credential files private. Mark
   host observations stale and run `self-host inspect-host` for fresh paths,
   ports, networks, and exposure before any mutation.
2. Use read-only `self-host bundle next` with the same resolved input to find the
   first pending checkpoint. Review the bundle approval from `bundle plan`,
   then supply that token to `next`; supply an adapter token only after its
   exact stage plan. `bundle run` advances only approved safe CLI stages. A
   stopped bundle may need both an applied `--local-https-input` and matching
   `--local-https-run-id` to include Caddy; verify those against the route
   owner, origin, and network reported by `bundle status` before passing them.
   For a status or information request, report these observations and the
   exact next command, then stop without choosing a repair or changing state.
3. Select one bounded repair, extension, or re-verification. Keep the existing
   four service IDs, bind paths, and one Homarr board. Use the returned exact
   adapter command and approval; browser signup, application acceptance,
   Homarr attachment, and restore checks remain explicit checkpoints. Treat
   container and HTTP observations as narrow evidence, not acceptance.
4. Read back every changed service and Homarr resource, including desktop and
   mobile Notebook rendering when the board changes. Report purposes, current
   links, private handoff path, unverified gates, and the next exact command.
   Use `bundle finalize scaffold` to create the exact bound, blocked evidence
   manifest without opening credential references, then edit its empty slots.
   `bundle finalize` records supplied observations; it does not perform a live
   check or prove the ten-minute target by itself. Keep this CLI-owned bundle
   under its bundle input instead of creating a parallel `.selfhost/stack.json`.

### Legacy stack record

1. Read `../selfhost-setup/GUIDE.md` and run its `scripts/stack.ts show`
   against the selected root. Stop if stack metadata is invalid; use its saved
   profiles only as desired state.
2. Run `scripts/stack.ts prerequisites` for every saved profile, the exact
   project root, active agent, and project scope. The first pass is
   non-mutating. Repair an incomplete self-host installation from the returned
   working directory through the active agent's normal approval flow. Install
   and verify the official browser skill/runtime only for fallback or required/
   requested visual evidence. Disclose that the approved `--verify-browser`
   pass may clean stale browser daemon sidecars; when ready, load
   `agent-browser skills get core` before using that fallback.
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
   blockers, metadata path, and next upkeep action. Export credentials privately
   only when the user asks for a fresh access handoff; report the file path.
   If selected, refresh Homarr's private stack-recap Notebook after a verified
   stack change, then give a **View dashboard** link with its actual access
   method. A saved local URL does not establish remote reachability.

For the legacy path, read `../selfhost-setup/GUIDE.md` and follow its linked
stack lifecycle contract before changing metadata. Completion on either path
means the recorded and observed services agree, the requested upkeep branch
has direct evidence, and no unrelated project or secret-bearing output was
touched. A CLI bundle remains incomplete while direct application, Homarr,
route, recovery, or timing gates are unverified.
