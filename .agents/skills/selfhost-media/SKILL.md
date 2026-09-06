---
name: selfhost-media
description: Plan, initialize, synchronize, and verify the private owned-content media harness for Seerr, Sonarr, Radarr, Prowlarr, qBittorrent, Jellyfin, and Homarr. Use for isolated evaluation, safe harness installation, service wiring, secret-free evidence, or read-only Homarr API/MCP checks.
license: Apache-2.0; see LICENSE.txt
compatibility: Planning requires Bun 1.4.0 or newer and Bash; approved harness runs require Docker Compose and browser evidence requires agent-browser.
---

# Self-hosted media

Use the packaged harness as immutable input. Set `MEDIA_SKILL_ROOT` to the
absolute directory containing this `SKILL.md`, then install into the current
project before running any harness command:

```bash
MEDIA_SKILL_ROOT="/absolute/path/to/selfhost-media"
bun "$MEDIA_SKILL_ROOT/scripts/media-runtime.ts" init
bun "$MEDIA_SKILL_ROOT/scripts/media-runtime.ts" verify
```

Pass `--project /absolute/project/path` before `--` to select another project.
Use `sync` to refresh an existing installation. The runtime preserves every
existing `.sessions` tree and rejects other unrecognized runtime content.

## Workflow

1. Read [safety.md](references/safety.md) and
   [legal-owned-content.md](references/legal-owned-content.md).
2. Read [graph.md](references/graph.md) when choosing or explaining service
   relationships.
3. Read [runtime.md](references/runtime.md) before initializing or executing the
   harness.
4. Initialize and verify the private copy. Treat a failed verification as a stop
   condition.
5. Render the runbook or forward a session command explicitly:

   ```bash
   bun "$MEDIA_SKILL_ROOT/scripts/media-runtime.ts" exec -- render-prompt RUN_ID
   bun "$MEDIA_SKILL_ROOT/scripts/media-runtime.ts" exec -- session create RUN_ID
   ```

6. Follow the installed `PROMPT.md`, ordered prompt modules, and per-service
   notes. Resolve assigned ports through the session helper; keep every action
   scoped to one run identifier.
7. Read [acceptance.md](references/acceptance.md) before reporting completion.
   Mark indirect or absent evidence unproven.

Run `bun "$MEDIA_SKILL_ROOT/scripts/verify-bundle.ts"` to verify the packaged
asset. Add `--source-root /path/to/source` only when auditing source drift.
Neither verifier uses Docker or reads runtime sessions.
