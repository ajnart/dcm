# Control-panel reuse map

Checked against the feature branch on 2026-09-29. This is an inventory, not a
claim that every catalog entry installs or that a prior trial proves a fresh
deployment. The root media harness is canonical; its copy in the installed
skill is generated.

| Existing asset | What it proves today | Target module | Decision | Freshness or validation gap |
| --- | --- | --- | --- | --- |
| `catalog/apps/*/manifest.json` (94 folders after the Compose-only prune and UniFi removal) and catalog schemas | Searchable app facts, goal routing, and support labels. A manifest is not an installer. | One canonical folder per Compose-deployable app, with an explicit installable/discovery-only capability | Keep; add install capability only when its recipe, CLI route, and setup adapter are verified | Catalog research is dated; review upstream lifecycle and image provenance before promoting an entry |
| Homarr, Immich, Paperless-ngx, Prowlarr, and Uptime Kuma `recipe.json` | Five bounded Compose candidates with declared ports, mounts, images, private files, and some upstream-sourced health checks | Same canonical app folders, consumed by one deployment engine | Keep and adapt; do not copy into a second recipe registry | Version-specific setup and health contracts still require a fresh check per target host; one local trial is not universal acceptance |
| `research/` (13 reports), `generations/` (7 reports plus index), `docs/setup-routes.md`, `docs/headless-setup.md` | Prior source research, failed routes, setup call sequences, and prompt-evolution evidence | App-folder source notes and a shared migration ledger | Keep as evidence; extract only verified facts into runtime recipes | Many reports are August/September 2026 snapshots; distinguish research, static proof, and live acceptance |
| `PROMPT.md`, `docker-compose.yml`, `prompts/`, `scripts/session.sh` | Isolated seven-service media run model, project-scoped Compose ownership, locking, and recovery | Media stack adapter plus shared project/Compose primitives | Adapt, preserving the canonical root harness; never edit only the generated skill bundle | The exact media acceptance contract is stronger than a generic app status; rerun a fresh isolated trial after migration |
| `scripts/setup-{qbittorrent,sonarr,radarr,prowlarr,jellyfin,seerr,homarr}.ts` and `setup-media-run.ts` | API-first service setup, connection wiring, per-stage retry, and a staged aggregate runner | Per-app setup adapters and a dependency-aware setup scheduler | Port proven sequences; keep existing scripts runnable until parity | Scripts are specialized to the media run and its current app versions; fresh installs must verify each migrated adapter |
| `scripts/lib/curl-http.ts`, `session-context.ts`, `setup-handoff.ts` | Private loopback HTTP transport with per-origin cookie jars, owner-only files, exact run context, and secrets-full private takeover artifact | Shared HTTP/session/credential module behind the per-app setup interface | Adapt; do not write a second ad hoc secret transport | Current transport is media-run/loopback-specific; general projects and remote targets need an explicit reviewed contract |
| `scripts/setup-homarr.ts`, `homarr-finalize.ts`, `homarr-notebook.ts`, `lib/homarr-mcp.ts` | Version-specific API onboarding, key storage, six media integration inputs, generated board checks, Notebook readback, and MCP discovery | Optional Homarr finalizer after app connections are ready | Keep and adapt into a reusable fan-in step | Image/API contracts are version-sensitive; generic app mappings and a fresh rendered-board proof are still missing |
| `scripts/browser-command-log.mjs`, `summarize-browser-log.mjs`, `research/browser-request-logging.md` | Private, sanitized agent-browser command and polled request-metadata evidence | Research harness for discovering new setup adapters, outside normal installs | Keep and improve only where a specific research gap requires it | It does not capture bodies, cookies, headers, or complete HAR; route metadata alone cannot generate replayable requests |
| `packages/cli/src/lib/selfhost-compose.ts`, canonical `selfhost-compose` scripts | Exact-project Compose validate/render/preflight/apply/stop ownership contract | Shared deployment engine | Keep; call it from app adapters rather than fork lifecycle logic | Needs an end-to-end project-selection reconciler; static validation is not deployment proof |
| `packages/cli/src/app.ts`, `app-batch.ts`, `lib/app-state-discovery.ts` | Owner-only app state, pinned-image plan/apply, live container inspection, and up to two independent batch applies with attempted-job recovery | Per-app adapter interface, project inventory, and selection reconciler | Adapt behind a smaller interface; retain old commands during migration | Batch currently handles fresh independent applies, not add/retain/remove against an existing selection; setup phases are not uniformly scheduled |
| `packages/cli/src/interactive.ts`, `interactive-catalog.ts` | Existing root choice, plan/install/resume flows, and an app search that adds one result per prompt | Status-first control panel and searchable multi-select | Adapt entry and reuse flows; retire duplicated prompts only after parity | No immediate project recap, editable multi-search selection, asynchronous update cards, or change diff |
| `packages/cli/src/command.ts`, `app image`, package builder | Saved media config, single-owner lifecycle routes, registry digest resolution, and a private standalone CLI package | Project home, image-update scanner, and checked CLI self-updater | Reuse image resolution and packaging; add update paths separately | No general asynchronous installed-image comparison or CLI self-update; multiple existing state owners need one read-only inventory |
| `packages/cli/src/lib/homarr-onboarding-api.ts`, `homarr-attach.ts`, `homarr-{uptime-kuma,immich}.ts`, `homarr-mcp.ts` | Standalone Homarr onboarding/key extraction, board tiles/Notebook, two specialized native integrations/widgets, and local MCP preparation | Optional Homarr adapter reading verified app connection records | Keep; sequence after app setup, not inside every app's deployment | Paths are separate commands, not one generic seeding pass; a tile, integration, widget, and rendered board remain different claims |
| `.agents/skills/self-host/SKILL.md` and internal `GUIDE.md` modules | One portable Agent Skill with catalog routing, host-choice guidance, and bounded browser fallback | Thin conversational wrapper over the same CLI project engine | Keep; simplify after the CLI journey is stable | It must not duplicate install logic or turn discovery-only apps into managed installers |

## Migration order

1. Add a read-only project inventory and status-first home without changing
   existing installers. Keep ambiguous project owners explicit.
2. Introduce one small per-app setup interface and one canonical app folder;
   port an existing API-first setup path before adding more catalog entries.
3. Add editable multi-select and an exact added/retained/removed diff. Keep
   removal data-preserving and separately confirmed.
4. Reuse the existing parallel Compose executor, then schedule independent
   setup adapters only after their own runtime prerequisites pass.
5. Feed verified connection records to optional Homarr onboarding, board
   seeding, integrations/widgets, Notebook, and MCP preparation.
6. Only then expand installable catalog coverage with isolated browser
   research and source/version checks. Preserve discovery-only labels.

The 2026-09-29 control-panel slice now implements items 1–4 for five bounded
recipes. A fresh isolated Paperless-ngx + Uptime Kuma project passed direct
admin, document/OCR, monitor, and scoped restart checks; repeating Uptime
onboarding on the existing project created no account or credential change.
Old Paperless bind-based states are preserved by an exact archived recipe,
not silently migrated to named volumes. The optional Homarr-after-apps path
has private-board local-only tiles and stack Notebook API read-back, without
retrofitting app networks. A separate Homarr-first project has connected
frontends, live native Paperless and Uptime widgets, and restart read-back.
Prowlarr was added from the media harness's config-key/API pattern as a separate
one-service, named-volume recipe; its private admin/API key and scoped restart
passed on a fresh rootless trial, but no indexer or downstream link was added.
Remote browser access, rendered board, and MCP client installation remain
separate proofs; an app-only batch is not automatically connected to Homarr.

Normal setup uses deterministic requests or scripts. Browser automation is a
research or targeted repair path, never evidence that an unimplemented app is
automatically installable. Preserve current commands until the new control
panel can resume their saved projects without losing credentials or data.
