---
name: selfhost-homarr
description: Plan and verify standalone Homarr v2 onboarding, integrations, API-key profiles, read-only native MCP access, client configuration, and Seerr media search. Use for Homarr integration graphs, `/api/mcp`, Claude Code or Codex MCP setup, add/request wording that must stop after search, and scoped generated-dashboard evidence for any self-hosted stack.
---

# Self-host Homarr

Resolve `SKILL_DIR` to this skill directory and invoke every bundled script through its absolute path. The scripts require dependency-free Node.js 18 or newer and have no repository-root or sibling-skill dependency.

## Contract

- Keep app tiles, integrations, and widgets as separate resources and acceptance claims.
- Use `ghcr.io/homarr-labs/homarr-test:v2` when the requested image policy applies.
- Keep the default bridge, generated client fragments, integration plan, and verifier strictly read-only. The bridge hides and rejects every known mutating tool.
- For `add Spider-Man` or equivalent mutation wording, search the one configured Seerr integration, present exact matches, and stop pending confirmation. After confirmation, report that the mutation path is intentionally unavailable; never claim a request was submitted.
- Merge a generated client fragment only after the user supplies the exact approval `INSTALL-MCP:<profile>`. Fragment generation is not installation.
- Keep credentials on stdin and in the private profile. Keep them out of arguments, environment variables, output, screenshots, logs, config fragments, and repository files.

## Workflow

1. Read [onboarding-and-integrations.md](references/onboarding-and-integrations.md) when selecting apps, classifying coverage, onboarding, or accepting a generated dashboard.
2. Initialize a project profile:

   ```text
   node <skill-dir>/scripts/profile.mjs init <profile> --base-url <homarr-origin> --project-root <absolute-project-root>
   ```

3. Read [api-and-mcp.md](references/api-and-mcp.md) before API or MCP work. Create the key in Homarr only when requested, then use the one-time browser-to-stdin pipeline in [client-installation.md](references/client-installation.md).
4. Run `profile.mjs doctor <absolute-profile-path>` before starting the bridge, generating a fragment, or verifying.
5. Generate a secret-free client fragment with `generate-client-config.mjs <claude-code|codex|generic-json|generic-toml> <absolute-profile-path>`.
6. Run `verify-homarr.mjs <absolute-profile-path>`. Add `--media-search` for the read-only default search `Spider-Man: No Way Home`, or append a different title. Require one usable Seerr integration and an exact structured result.
7. Read [safety-and-acceptance.md](references/safety-and-acceptance.md) and report only the PASS lines actually observed. Keep compatibility and curated-catalog fallback modes explicit.

## Planning utility

Run `integration-plan.mjs <selection.json|-> [--coverage <catalog-homarr.json|-> | --mapping <mapping.json>]`. Prefer the direct catalog coverage handoff; the utility never imports sibling catalogs. See the onboarding reference for schemas and provenance.

## Client bridge

Start `homarr-mcp-bridge.mjs` with exactly one argument: the absolute profile path. The bridge privately loads the key, prefers canonical `/api/mcp`, and exposes a read-only projection of a valid native catalog. It tries compatibility only after a definitive canonical 404/405 and uses the curated fallback only for exact RPC `-32603` message `Date cannot be represented in JSON Schema`.
