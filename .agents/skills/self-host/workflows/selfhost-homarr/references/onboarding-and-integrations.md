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

After a **New** setup is verified, these are optional suggestions, not required
widgets or acceptance gates. Include a note only when the user asks for it and
the capability is not already selected or installed. A household that includes
Vaultwarden needs its actual password-manager recap, not an invitation to
install it again. Phone access remains a separate choice and approval.
Match requested existing notes by their content marker to avoid duplicates;
leave other notes unchanged.

1. Marker: `SELFHOST_ONBOARDING_VAULTWARDEN_V1`
   Title: `Add a password manager`
   Body: `Ask your self-hosting agent to install Vaultwarden when you want a private place for passwords.`
2. Marker: `SELFHOST_ONBOARDING_PHONE_ACCESS_V1`
   Title: `Use your services away from home`
   Body: `Ask your self-hosting agent to enable private phone access with Tailscale when you need it.`

Use Homarr item kind `notebook`. Place each requested note on the user's private board, keep
the toolbar hidden, and include no URL, credential, token, API key, or automatic
action. If a note is requested, verify its exact content and that the board is not public.
There is no bounded suggestion-note API adapter; use
the checked browser fallback for this optional write. These notes are not
approval to install Vaultwarden or Tailscale, and their absence does not block
acceptance of the installed stack.

Do not create these notes for **Advanced**. Offer the same choices directly in
the setup conversation after the initial local installation.

## Stack recap Notebook

When Homarr is selected, maintain one primary private Notebook headed
`Your homelab at a glance`. Summarize only services actually installed and
verified, their plain-language roles, browser URLs and access method, storage,
whether a backup restore has been tested, and unresolved work. This is separate
from the two optional New-path onboarding notes. Never include a credential or
claim a backup, route, integration, or widget works without its own evidence.
If extra apps would clip the mobile recap, place their details in a second
private `More services in your homelab` Notebook and keep the primary media
instructions intact. Read back both items and check desktop and mobile rendering.
For a working Seerr integration, explain that Homarr's search bar or Ctrl+K
opens media-request search: choose the exact title, then request only authorized
content. If Seerr is absent, omit this instruction rather than promising a
search mode that is not available.

The media recap and CLI app-attachment adapter share a content-aware height
estimate. Media reconciliation grows only; attachment can compact under its
reviewed plan. Keep desktop/mobile rendering as the readability check.
For gaps left after compaction, review a separate CLI `board-polish
--reflow-all` plan; it moves all items while preserving their content and size.

The media adapter uses `homarr-notebook` after proving the onboarding-generated
widgets. It uses `board.getAllBoards`, `board.getBoardByName`, `board.addItem`,
and `widget.notebook.updateContent`, then reads the private board back. For other stacks,
inspect the running Homarr image's generated API specification and current
board before using these procedures; the public API overview does not publish
the exact Notebook input schema. If the route or schema differs, take over only
this step with the checked browser workflow. Match the recap marker and update
it rather than creating duplicates. Link **View dashboard** in the final user
summary only after the private board and recap have been read back, and label
the link's local, SSH, or private-ingress access method.

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
