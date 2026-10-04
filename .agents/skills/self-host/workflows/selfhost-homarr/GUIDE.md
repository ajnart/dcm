---
name: selfhost-homarr
description: Base control-plane adapter. Set up Homarr v2 as the standard private dashboard and read-only agent gateway for a selected stack, with separately approved scoped capabilities. Use for Homarr onboarding, integration graphs, API-key profiles, `/api/mcp`, client setup, generated-dashboard evidence, or Seerr title search and confirmed requests.
license: Apache-2.0; see LICENSE.txt
compatibility: Requires Bun 1.4.0 or newer; live API checks need an explicitly identified private Homarr endpoint and secret reference.
---

# Self-host Homarr

Resolve `SKILL_DIR` to this workflow directory and invoke every bundled script through its absolute path. The scripts require Bun 1.4.0 or newer and have no repository-root or sibling-skill dependency.

Recommend Homarr for new shared projects; honor an explicit opt-out. Preserve
saved legacy New/Advanced choices when maintaining those owners. Use Homarr as
a private dashboard and agent-facing integration surface without transferring
ownership of the underlying apps. Those apps remain independently operable
when Homarr is temporarily unavailable.

## Contract

- Keep app tiles, integrations, and widgets as separate resources and acceptance
  claims. Give every selected app tile a working browser URL and one-sentence
  purpose; a tile alone does not prove integration-backed widgets.
- For a saved server-only tile that later gets a private browser route, run
  `app homarr-input --route-revision --href URL` and use its returned immutable
  input with `homarr attach plan/apply/status --repair-existing-link`. Review
  the old/new link and exact approval; a partial API write needs a fresh plan.
  The TUI can reuse an already-applied route revision on resume. Never mark the
  route reachable until a browser on the intended device confirms it.
- Optional service suggestions follow
  [onboarding-and-integrations.md](references/onboarding-and-integrations.md).
  They are separate from the required installed-stack recap and acceptance.
- After verifying any selected Homarr stack, create or refresh a private
  stack recap with each installed service's purpose and access method,
  storage/recovery status, and remaining gaps. Keep the media instructions in
  the primary Notebook and use a companion Notebook for added services when a
  mobile layout would clip one long note. The media harness has a bounded
  `homarr-notebook` API helper; for other stacks, use the documented board API
  only after checking the running image's procedure/schema. Fall back to the
  checked browser workflow if that API route is unavailable; verify a read-back
  and mobile rendering.
  Never put passwords, keys, or private handoff contents on the board.
- Use `ghcr.io/homarr-labs/homarr:dev` for new Homarr setups. Existing owners
  change images only through a separately approved image transition.
- Keep the default bridge, generated client fragments, integration plan, and verifier strictly read-only. An explicitly selected profile may expose only policy-constrained authenticated integration requests under [api-and-mcp.md](references/api-and-mcp.md); every other mutating tool stays hidden.
- A remote-access plan may expose Homarr's dashboard and consumer apps such as Jellyfin while keeping Sonarr, Radarr, Prowlarr, qBittorrent, and native `/api/mcp` access private. Delegate every public route to `selfhost-ingress`; selecting Homarr is not exposure approval.
- For `add Spider-Man` or equivalent mutation wording, search the one configured Seerr integration, present exact matches, and stop pending confirmation. A default or generic integration-request profile remains unable to submit it. Only a separately installed `media-request` profile may forward the exact selected match after the user confirms it; pass `confirmed: true` only for that confirmed title and state that an accepted request can trigger downstream acquisition.
- Merge a generated client fragment only after the user supplies the exact approval `INSTALL-MCP:<profile>`. Fragment generation is not installation.
- Keep credentials on stdin and in the private profile. Keep them out of arguments, environment variables, output, screenshots, logs, config fragments, and repository files.

## Workflow

1. Read [onboarding-and-integrations.md](references/onboarding-and-integrations.md) when selecting apps, classifying coverage, onboarding, or accepting a generated dashboard.
2. Confirm the exact selected owner and Homarr choice. For shared projects,
   follow [shared-project CLI usage](../selfhost-setup/references/shared-project-cli.md):
   reuse `app shared setup`, then separately review and approve `homarr-plan` /
   `homarr-apply` and read back `homarr-status`. Retain the same root, project ID
   and saved credentials. Public exposure and connected-app mutations remain
   separate approvals. Steps 3–7 apply when an agent/MCP profile is selected or
   already owned; shared dashboard publication needs no separate profile.
   For an explicitly selected standalone Homarr project on local Linux, use
   the CLI's exact
   `app plan --id homarr`, `app apply --id homarr`, and separately approved
   `app onboard --id homarr`. The last command creates or reverifies the first
   admin, submits the initial private `personal` board setup with zero
   integrations, and stores an API key privately. Read the current approval
   from `app status`; do not reuse a stale plan token. `app handoff --show`
   explicitly exports the secretful admin/key `.env`. An uncertain API attempt
   remains a saved checkpoint for inspection, not an instruction to recreate
   the project. This path does not attach apps, prove board content, create a
   Notebook, or verify integrations and widgets.
3. Initialize a project profile:

   ```text
   bun <skill-dir>/scripts/profile.ts init <profile> --base-url <homarr-origin> --project-root <absolute-project-root>
   ```

4. Read [api-and-mcp.md](references/api-and-mcp.md) before API or MCP work.
   Reuse the selected owner's verified key: shared `app shared handoff --app
   homarr` or standalone `app handoff --id homarr`. Use the private file-to-stdin
   handoff in [client-installation.md](references/client-installation.md).
   For an existing Homarr without that file, create the key only when requested
   and use the one-time browser-to-stdin pipeline there.
5. Run `profile.ts doctor <absolute-profile-path>` before starting the bridge, generating a fragment, or verifying.
6. Generate a secret-free client fragment with `generate-client-config.ts <claude-code|codex|pi|generic-json|generic-toml> <absolute-profile-path>`.
7. Run `verify-homarr.ts <absolute-profile-path>`. Add `--media-search` for the read-only default search `Spider-Man: No Way Home`, or append a different title. Require one usable Seerr integration and an exact structured result. For a `media-request` profile, this also verifies that its configured ID is the one live `seerr` integration; it never submits a request.
8. Offer optional next steps only when relevant to missing capabilities. Add
   suggestion notes only when requested; their absence does not block setup.
9. Create or refresh the private stack-recap Notebook after the app evidence
   exists. The media adapter runs its API helper after generated-widget proof;
   generic setups use the board API only when its exact live schema is known,
   otherwise browser fallback. Require a private-board and Notebook read-back
   before giving the user a **View dashboard** link. State if the link needs an
   SSH tunnel or private ingress.
10. Read [safety-and-acceptance.md](references/safety-and-acceptance.md) and report only the PASS lines actually observed. Keep compatibility and curated-catalog fallback modes explicit.

For a media-harness key already captured in its private run, follow [media-profile-handoff.md](references/media-profile-handoff.md). The setup orchestrator transfers the existing key file to owner stdin; neither capability imports the other's runtime code.

## Planning utility

Run `integration-plan.ts <selection.json|-> [--coverage <catalog-homarr.json|-> | --mapping <mapping.json>]`. Prefer the direct catalog coverage handoff; the utility never imports sibling catalogs. See the onboarding reference for schemas and provenance.

## Client bridge

Start `homarr-mcp-bridge.ts` with exactly one argument: the absolute profile path. The bridge privately loads the key and prefers canonical `/api/mcp`. By default it exposes a read-only projection. A profile policy may expose either native `integration_request` through exact service, method, and route rules or the wrapped native `integration_requestMedia` for one Seerr integration ID. The media wrapper requires `confirmed: true`, re-runs the scoped search, and forwards only an exact normalized title, media ID, and media-type match. It tries compatibility only after a definitive canonical 404/405 and uses the curated fallback only for exact RPC `-32603` message `Date cannot be represented in JSON Schema`.

The bridge is not a general write proxy. Each policy mode exposes only its one
mutation surface. App updates and request decisions remain hidden; the generic
integration-request mode does not expose media requests, and media-request mode
does not expose generic requests or bypass Homarr's interact-access check.
