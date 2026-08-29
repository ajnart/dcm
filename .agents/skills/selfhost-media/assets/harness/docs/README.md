# Auto-Stack service notes

These are the short operational references for fresh test sessions. Read the
service note before configuring that service; the root-level historical guides
are evidence from an older, non-isolated run and may have stale ports or UI refs.

Compose port mappings omit a host IP and provide service-specific fallback
ports. Session-created runs still assign collision-free ports. Docker may
publish them on every host interface, so keep the host behind a trusted LAN or
firewall; this harness does not configure public ingress or authentication.

Before any browser command:

1. Read the available `agent-browser` skill's `SKILL.md`.
2. With Node.js 22.20.0 or newer active, run the already installed
   `agent-browser skills get core`; Node.js 24 is recommended.
3. Load the run's non-secret environment with `scripts/session.sh env RUN_ID`.
4. Use the run's `AGENT_BROWSER_SESSION`; re-snapshot after every page change.
5. Resolve host URLs with `scripts/session.sh urls RUN_ID`. Never assume a port.

Authenticated browser diagnostics are secret-bearing. Candidates must never
invoke, print, or persist agent-browser `console`, raw `network requests`, HAR
output, or another raw trace inside or outside their run; headers, cookies,
URLs, and payloads can contain access tokens. Candidates use only page-scoped
evaluation that returns approved fixed summaries or fixed harness summaries.
Only the supervisor may use a raw trace, and only with explicit authorization
in a unique owner-only temporary directory outside candidate execution. The
supervisor must never surface its contents or treat it as candidate evidence and
must delete it immediately after deriving the approved fixed summary.

The harness never installs or downloads agent-browser. On a mise-managed host
where the direct executable is absent, load the core workflow with
`mise exec node@24 -- agent-browser skills get core`. The password helper first
tries the direct executable and retries that fixed mise Node.js 24 command only
when direct launch fails with `ENOENT`; it never retries a launched nonzero
browser action.

The local username is `admin`. The harness derives a bounded password from each
run's encryption key without reusing the key itself. After bootstrap it stores
that login, the resolved URLs, and available API keys in the private
`.sessions/RUN_ID/credentials.env` access sheet. Fill one to four fresh
password-input refs with
`scripts/session.sh browser-password "$RUN_ID" @eN [@eN ...]`. This helper
accepts only snapshot refs, sends the password to the run-scoped agent-browser
batch over stdin, suppresses child output, and returns only fixed PASS/FAIL
text. The password must never appear in command arguments, screenshots, or
reports.

Runs without `SESSION_PASSWORD_SCHEME=hmac-v1` are legacy and are never
migrated in place. Their command boundary is explicit:

| Legacy run behavior | Commands |
| --- | --- |
| Inspection and bounded cleanup allowed | `doctor`, `urls`, `env`, `status`, `mcp-verify`, `down`, `destroy` |
| Current scheme required | `up`, `keys`, `bootstrap`, `verify`, `browser-password`, `homarr-key`, `homarr-finalize`, `mcp-config`, `credentials` |

Recreate a legacy run under a new `RUN_ID` before starting services,
configuring credentials, writing client artifacts, or continuing acceptance
work. The read-only internal Compose-log helper remains marker-optional; there
is no standalone `session.sh logs` command.

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
The local stdio bridge keeps the key out of client configuration and exposes
only the three read-only tools used to verify integrations and search Seerr. It
projects those tools from a successful native catalog and uses the same curated
schemas only for exact RPC `-32603` message
`Date cannot be represented in JSON Schema`.

`.sessions/RUN_ID/secrets.env` is the harness source of truth for service API
keys and the Homarr encryption key. The five-entry schema is unchanged; the
password is derived from that source. `homarr-key` stores the Homarr API/MCP key
separately in the private run. `bootstrap`, `keys`, `homarr-key`, and the
explicit command below atomically refresh the user-facing access sheet:

```bash
scripts/session.sh credentials RUN_ID
```

The command prints a plain-language service summary, the exact file path, and a
local `cat` command. It does not copy any secret value into an agent transcript.
The access sheet is mode `0600`, is not an acceptance artifact or harness input,
and lists `HOMARR_API_KEY=` until the one-time key is captured. Seerr's admin
login is the linked Jellyfin account; qBittorrent and Jellyfin have no harness-
managed API key. Run `credentials` again whenever keys change.
Applications also persist credentials inside their own untracked per-run config
databases/files. Harness automation consumes `secrets.env`; humans use the
private access sheet. Never copy its values into reports, screenshots, tracked
files, or agent/browser commands.

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
