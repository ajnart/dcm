---
name: selfhost-homarr
description: Media pack adapter. Add Homarr v2 as an optional private dashboard and read-only agent gateway when directly requested or delegated by a selected stack. Use for Homarr onboarding, integration graphs, API-key profiles, `/api/mcp`, client setup, generated-dashboard evidence, or Seerr title search that stops before requesting.
license: Apache-2.0; see LICENSE.txt
compatibility: Requires Bun 1.4.0 or newer; live API checks need an explicitly identified private Homarr endpoint and secret reference.
---

# Self-host Homarr

Resolve `SKILL_DIR` to this skill directory and invoke every bundled script through its absolute path. The scripts require Bun 1.4.0 or newer and have no repository-root or sibling-skill dependency.

Homarr is a recommended bonus layer, never a prerequisite for the services it
connects. Use it as a private dashboard and agent-facing integration surface
without transferring ownership of the underlying apps to this skill. A stack
without Homarr remains valid.

## Contract

- Keep app tiles, integrations, and widgets as separate resources and acceptance claims.
- Use `ghcr.io/homarr-labs/homarr-test:v2` when the requested image policy applies.
- Keep the default bridge, generated client fragments, integration plan, and verifier strictly read-only. The bridge hides and rejects every known mutating tool.
- A remote-access plan may expose Homarr's dashboard and consumer apps such as Jellyfin while keeping Sonarr, Radarr, Prowlarr, qBittorrent, and native `/api/mcp` access private. Delegate every public route to `selfhost-ingress`; selecting Homarr is not exposure approval.
- For `add Spider-Man` or equivalent mutation wording, search the one configured Seerr integration, present exact matches, and stop pending confirmation. After confirmation, report that the mutation path is intentionally unavailable; never claim a request was submitted.
- Merge a generated client fragment only after the user supplies the exact approval `INSTALL-MCP:<profile>`. Fragment generation is not installation.
- Keep credentials on stdin and in the private profile. Keep them out of arguments, environment variables, output, screenshots, logs, config fragments, and repository files.

## Workflow

1. Read [onboarding-and-integrations.md](references/onboarding-and-integrations.md) when selecting apps, classifying coverage, onboarding, or accepting a generated dashboard.
2. Confirm that the user selected Homarr as an optional layer. Do not add it merely because selected apps have integrations.
3. Initialize a project profile:

   ```text
   bun <skill-dir>/scripts/profile.ts init <profile> --base-url <homarr-origin> --project-root <absolute-project-root>
   ```

4. Read [api-and-mcp.md](references/api-and-mcp.md) before API or MCP work. Create the key in Homarr only when requested, then use the one-time browser-to-stdin pipeline in [client-installation.md](references/client-installation.md).
5. Run `profile.ts doctor <absolute-profile-path>` before starting the bridge, generating a fragment, or verifying.
6. Generate a secret-free client fragment with `generate-client-config.ts <claude-code|codex|generic-json|generic-toml> <absolute-profile-path>`.
7. Run `verify-homarr.ts <absolute-profile-path>`. Add `--media-search` for the read-only default search `Spider-Man: No Way Home`, or append a different title. Require one usable Seerr integration and an exact structured result.
8. Read [safety-and-acceptance.md](references/safety-and-acceptance.md) and report only the PASS lines actually observed. Keep compatibility and curated-catalog fallback modes explicit.

## Planning utility

Run `integration-plan.ts <selection.json|-> [--coverage <catalog-homarr.json|-> | --mapping <mapping.json>]`. Prefer the direct catalog coverage handoff; the utility never imports sibling catalogs. See the onboarding reference for schemas and provenance.

## Client bridge

Start `homarr-mcp-bridge.ts` with exactly one argument: the absolute profile path. The bridge privately loads the key, prefers canonical `/api/mcp`, and exposes a read-only projection of a valid native catalog. It tries compatibility only after a definitive canonical 404/405 and uses the curated fallback only for exact RPC `-32603` message `Date cannot be represented in JSON Schema`.

This bridge is the current shipped agent gateway, but it is not a write proxy.
Inspection and Seerr search are available; requests, approvals, and connected-
app configuration are not. Any future write capability needs its own narrow
authorization, tool allowlist, confirmation, and acceptance evidence.
