# Onboarding and integration graph

## Default control-plane role

Homarr is the standard private front door for every selected stack. It can
collect navigation, health, widgets, and agent-readable integrations without
becoming a runtime dependency of those apps. A Homarr outage must not stop the
underlying services from operating independently.

A private-first topology can publish Homarr's dashboard and user-facing services such as
Jellyfin while keeping Sonarr, Radarr, Prowlarr, and qBittorrent administration
reachable only from the private network. Keep native `/api/mcp` access private
for the local bridge. This is a topology recommendation, not permission to
configure it. Public exposure requires a separate ingress and authentication
plan.

## Resource graph

```text
onboarding integration
  -> configured integration
  -> auto-populated app tile (navigation and health link)
  -> auto-populated widget (integration-backed content)
```

Each node needs separate evidence. An app tile does not prove an integration, a widget does not prove its app link, and successful onboarding does not prove rendered widget content.

## Coverage classifications

- `official-integration`: configure and verify the Homarr integration.
- `app-tile-only`: create or retain an app tile, and report the integration/widget gap.
- `unsupported`: report the gap without inventing an integration.

Use the plan utility with this strict selection shape:

```json
{
  "selectedApps": ["seerr", "immich"],
  "media": true,
  "connectedIntegrations": ["seerr", "sonarr", "radarr", "prowlarr", "qbittorrent", "jellyfin"],
  "generatedDashboard": true
}
```

Prefer the checked catalog handoff directly:

```text
bun <selfhost-skill>/scripts/selfhost.ts catalog homarr --json | bun <homarr-skill>/scripts/integration-plan.ts selection.json --coverage -
```

The handoff uses `checkedAt` plus `entries[]`. A `supported` entry becomes `official integration`; a `gap` entry becomes `app-tile-only gap`. Immich is an official integration.

For standalone use, an optional normalized mapping is a flat object whose values are `official-integration`, `app-tile-only`, or `unsupported`:

```json
{
  "grafana": "app-tile-only"
}
```

Unknown selections classify as unsupported. The conservative fallback contains only the six media integrations plus Immich; those official facts cannot be overridden. The utility records whether classifications came from catalog coverage, a normalized mapping, or the standalone fallback.

## Media dashboard gate

Before a generated media dashboard can reach a managed evidence check, observe all six connections: Seerr, Sonarr, Radarr, Prowlarr, qBittorrent, and Jellyfin. Keep these stages distinct in the report:

1. onboarding integrations;
2. auto-populated resources;
3. app navigation and health links;
4. widgets and rendered content;
5. API-key profile;
6. canonical MCP verification.

`ready-for-managed-evidence-check` is only a topology gate. The standalone verifier does not inspect generated app links, ping targets, or widgets; supply that evidence through `selfhost-media` and aggregate it with `selfhost-verify`.

The seven-service `selfhost-media` harness includes Homarr and its browser,
integration, widget, app-link, API, and MCP evidence. Other stacks still adapt
their acceptance to the selected apps and available Homarr integrations.
