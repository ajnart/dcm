# Auto-Stack media setup controller

Configure one intentional Auto-Stack media run. Your required input is a unique
lowercase `RUN_ID`. Never inspect, reuse, stop, or modify another run. The same
checkout may host many isolated runs concurrently.

## Load the runbook

Read these modules in order and follow every stop gate:

1. `prompts/00-contract.md`
2. `prompts/10-isolation-and-start.md`
3. `prompts/20-bootstrap.md`
4. `prompts/30-connect-arr.md`
5. `prompts/40-seerr.md`
6. `prompts/50-homarr.md`
7. `prompts/60-homarr-api-mcp.md`
8. `prompts/80-acceptance.md`
9. `prompts/90-evidence.md`

Read `docs/README.md` and the seven `docs/<service>.md` notes as each service is
reached. Those local TLDRs and the live agent-browser skill are authoritative;
root-level service guides are historical evidence only.

## Non-negotiable outcome

The run is not complete until all seven services are fresh and usable;
Sonarr/Radarr use qBittorrent; Prowlarr full-syncs to both; Seerr is connected to
Jellyfin, Sonarr, and Radarr; and Homarr onboarding has tested and linked all six
external integrations. The `ghcr.io/homarr-labs/homarr-test:v2` onboarding must
auto-generate the app tiles and integration widgets. Manual post-onboarding app
or widget placement does not satisfy setup. Use agent-browser with fresh refs
and the secret-safe browser helper to retrieve service keys, fill Homarr, and
capture a private per-run Homarr API key without exposing it. Finalize the six
generated app URL/ping
splits through the harness, and verify the canonical `/api/mcp` endpoint with a
read-only media search. The generated client configuration must remain
secret-free and uninstalled unless the user separately authorizes installation.
Verification stops after search and never invokes a media request/download
mutation. Finish by refreshing and reporting the password-free
`connections.env` path for future service wiring. For initial setup, also run
the explicit `handoff` command and return only its artifact paths.
During upkeep, run `handoff` only when the user explicitly requested a fresh
access handoff.

Keep a step count and recovery log. Report the completed path and any recovery
that changed it.

## Start a setup run

Compile one immutable prompt for the selected run identifier:

```bash
scripts/render-prompt.sh media-setup
```

Optional setup modules may be appended as extra `prompts/*.md` arguments.
The renderer never creates shared runtime state; the setup creates only its
own `.sessions/RUN_ID` tree when it starts.
