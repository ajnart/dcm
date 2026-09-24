# Onboarding and integration graph

## Default control-plane role

When selected, Homarr is the private front door for the stack. It can
collect navigation, health, widgets, and agent-readable integrations without
becoming a runtime dependency of those apps. A Homarr outage must not stop the
underlying services from operating independently.

A private-first topology can publish Homarr's dashboard and user-facing services such as
Jellyfin while keeping Sonarr, Radarr, Prowlarr, and qBittorrent administration
reachable only from the private network. Keep native `/api/mcp` access private
for the local bridge. This is a topology recommendation, not permission to
configure it. Public exposure requires a separate ingress and authentication
plan.

## New-path onboarding notes

After a **New** setup is verified, create exactly two private Homarr Notebook
note widgets. Match existing widgets by the marker in their content and update
them instead of creating duplicates.

1. Marker: `SELFHOST_ONBOARDING_VAULTWARDEN_V1`
   Title: `Add a password manager`
   Body: `Ask your self-hosting agent to install Vaultwarden when you want a private place for passwords.`
2. Marker: `SELFHOST_ONBOARDING_PHONE_ACCESS_V1`
   Title: `Use your services away from home`
   Body: `Ask your self-hosting agent to enable private phone access with Tailscale when you need it.`

Use Homarr item kind `notebook`. Place both on the user's private board, keep
the toolbar hidden, and include no URL, credential, token, API key, or automatic
action. Acceptance requires browser evidence that both widgets render with the
exact title and body and that the board is not public. These notes are not
approval to install Vaultwarden or Tailscale.

Do not create these notes for **Advanced**. Offer the same choices directly in
the setup conversation after the initial local installation.

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

Resolve `SELF_HOST_ROOT` to the absolute installed `self-host` directory, then
use the checked catalog handoff directly:

```text
bun "$SELF_HOST_ROOT/workflows/selfhost/scripts/selfhost.ts" catalog homarr --json | bun "$SELF_HOST_ROOT/workflows/selfhost-homarr/scripts/integration-plan.ts" selection.json --coverage -
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
