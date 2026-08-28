# Onboarding and integration graph

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
node <selfhost-skill>/scripts/selfhost.mjs catalog homarr --json | node <homarr-skill>/scripts/integration-plan.mjs selection.json --coverage -
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
