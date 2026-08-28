# Auto-Stack service notes

These are the short operational references for fresh test sessions. Read the
service note before configuring that service; the root-level historical guides
are evidence from an older, non-isolated run and may have stale ports or UI refs.

Before any browser command:

1. Read `/home/habs/.agents/skills/agent-browser/SKILL.md`.
2. Run `npx agent-browser skills get core`.
3. Load the run's non-secret environment with `scripts/session.sh env RUN_ID`.
4. Use the run's `AGENT_BROWSER_SESSION`; re-snapshot after every page change.
5. Resolve host URLs with `scripts/session.sh urls RUN_ID`. Never assume a port.

After `scripts/session.sh up RUN_ID`, run `scripts/session.sh bootstrap RUN_ID`.
It replaces the repetitive qBittorrent/Arr/Prowlarr forms with idempotent,
secret-safe API configuration. Run `scripts/session.sh verify RUN_ID` before
Seerr and again during acceptance.

After Homarr onboarding generates six linked apps and their widgets, follow
[homarr.md](homarr.md) to stream a newly created API key into the private run
store, finalize the generated app links, emit a secret-free MCP client fragment,
and perform the read-only MCP proof. `mcp-config` writes the candidate fragment
to `SESSION_ROOT/artifacts/mcp-client.json`. Candidates do not install it; only
the promoted winner may change a local client configuration.
Native `/api/mcp` with the `ApiKey` header remains authoritative;
`/api/mcp/mcp` is compatibility-only when the canonical route is unavailable.
The local stdio bridge keeps the key out of client configuration. It normally
passes through Homarr's native catalog; only its curated catalog exists for the
current upstream `tools/list` Date JSON-Schema failure.

`.sessions/RUN_ID/secrets.env` is the harness source of truth for service API
keys and the Homarr encryption key. `homarr-key` stores the Homarr API/MCP key
separately in the private run and later harness commands consume it directly.
Applications also persist credentials inside their own untracked per-run config
databases/files. Source `secrets.env` when an API/UI command needs a service
key, but never print or copy its values into reports, screenshots, or tracked
files.

The session parent remains mode 0700. Its nested Seerr config and shared data
mounts are writable because rootless Docker remaps application UIDs; do not
tighten those nested modes or media imports and database startup will fail.

| Service | Note |
| --- | --- |
| Prowlarr | [prowlarr.md](prowlarr.md) |
| Radarr | [radarr.md](radarr.md) |
| Sonarr | [sonarr.md](sonarr.md) |
| qBittorrent | [qbittorrent.md](qbittorrent.md) |
| Jellyfin | [jellyfin.md](jellyfin.md) |
| Seerr | [seerr.md](seerr.md) |
| Homarr | [homarr.md](homarr.md) |

Official Homarr references: [API](https://homarr.dev/docs/management/api/) and
[MCP](https://homarr.dev/docs/management/mcp/).
