# Auto-Stack service notes

These are the short operational references for intentional setup sessions. Read the
service note before configuring that service; the root-level historical guides
are evidence from an older, non-isolated run and may have stale ports or UI refs.
Start with `docs/headless-setup.md` in the installed media harness; the browser instructions
below are targeted fallback and visual-proof procedures.

Compose publishes assigned run-scoped ports on `127.0.0.1` by default. The
allocator spreads independent checkouts across the port range and checks
listeners visible to the process; a sandbox can still hide another checkout's
rootless Docker listener. If `up` reports a bind collision, create a new run
identifier rather than touching the other project. Use
the local host URLs or an explicitly selected private access route. See
[headless and remote access](headless-access.md) for the bounded Homarr wildcard
option, SSH forwarding, and private Caddy routes. Public ingress is a separate
decision.

Before any browser command:

1. Read the available `agent-browser` skill's `SKILL.md`.
2. Confirm `selfhost-setup` has installed and checked the agent-browser skill,
   runtime, and browser, then run `agent-browser skills get core`.
3. Load the run's non-secret environment with `scripts/session.sh env RUN_ID`.
4. Use the run's `AGENT_BROWSER_SESSION`; re-snapshot after every page change.
5. Resolve host URLs with `scripts/session.sh urls RUN_ID`. Never assume a port.

If a restricted Chromium runtime reports a Unix socket path-length error,
create one short, owner-only runtime directory under `/tmp` and set
`XDG_RUNTIME_DIR` to that **same** path for every agent-browser command and
`browser-key`/`browser-password` helper. Keep the manifest's
`AGENT_BROWSER_SESSION` unchanged: the secret-safe helpers reject a different
browser session, even if it opens Homarr successfully. Do not reuse another
run's runtime directory.

Authenticated browser diagnostics are secret-bearing. Setup agents must never
invoke, print, or persist agent-browser `console`, raw `network requests`, HAR
output, or another raw trace inside or outside their run; headers, cookies,
URLs, and payloads can contain access tokens. Setup uses only page-scoped
evaluation that returns approved fixed summaries or fixed harness summaries.
Only an authorized reviewer may use a raw trace, and only with explicit
authorization in a unique owner-only temporary directory outside setup
execution. The reviewer must never surface its contents or treat it as setup
evidence and must delete it immediately after deriving the fixed summary.

The media harness never installs agent-browser or its browser. `selfhost-setup`
owns that prerequisite. The password helper first tries the direct executable
and retries through `bunx --bun agent-browser` only when direct launch fails
with `ENOENT`; it never retries a launched nonzero browser action.

Ask once for the admin username before `create RUN_ID USERNAME`; reuse the
user’s explicit answer. The runtime exports it as `ADMIN_USERNAME`. The harness derives a bounded password from each
run's encryption key without reusing the key itself. The password is saved only by the explicitly requested private handoff. After bootstrap it stores the resolved URLs,
usernames, and available API keys in private mode-`0600`
`.sessions/RUN_ID/connections.env`. Fill one to four fresh
password-input refs with
`scripts/session.sh browser-password "$RUN_ID" @eN [@eN ...]`. This helper
accepts only snapshot refs, privately checks every ref in the run-scoped browser
session is an enabled, non-read-only `type=password` field before any fill, then sends the password to the run-scoped
agent-browser batch over stdin. It checks all refs before mutation, suppresses
child output, and returns only fixed PASS/FAIL text. The password must never
appear in command arguments, screenshots, or reports.

If the Homarr script fails, setup can fall back to the browser. For Sonarr, Radarr, and Prowlarr, open the
run-scoped `/settings/general` URL and use `scripts/session.sh browser-key
capture-field RUN_ID SERVICE` to verify the fixed readonly field against the
managed run without a snapshot or ref. Use `browser-key capture RUN_ID seerr
@eN` for Seerr. Return to Homarr, take a
fresh snapshot, and use `browser-key fill` on its key input. For the one-time
Homarr API key, use `browser-key capture-code RUN_ID homarr`. The helper emits
only fixed PASS/FAIL text and never puts a key in an argument or report.

Runs without `SESSION_PASSWORD_SCHEME=hmac-v1` are legacy and are never
migrated in place. Their command boundary is explicit:

| Legacy run behavior | Commands |
| --- | --- |
| Inspection and bounded cleanup allowed | `doctor`, `urls`, `env`, `status`, `mcp-verify`, `down`, `destroy` |
| Current scheme required | `up`, `keys`, `bootstrap`, `bootstrap-jellyfin`, `verify`, `browser-password`, `browser-form`, `browser-key`, `homarr-key`, `homarr-finalize`, `mcp-config`, `connections`, `handoff`, `access-proxy` |

Recreate a legacy run under a new `RUN_ID` before starting services,
configuring connections, writing client artifacts, or continuing acceptance
work. The read-only internal Compose-log helper remains marker-optional; there
is no standalone `session.sh logs` command.

After `scripts/session.sh up RUN_ID`, run `scripts/session.sh bootstrap RUN_ID`.
It replaces the repetitive qBittorrent/Arr/Prowlarr forms with idempotent,
secret-safe API configuration. It does not choose or create an indexer. Add and
test the user's selected authorized source before expecting full `verify` to
pass, then run it before Seerr and again during acceptance. Resume a failed
service with its individual `bun scripts/setup-SERVICE.ts RUN_ID` script.

After Homarr onboarding generates six linked apps and their widgets, follow
[homarr.md](homarr.md) to stream a newly created API key into the private run
store, finalize the generated app links, emit a secret-free MCP client fragment,
and perform the read-only MCP proof. `mcp-config` writes the run-scoped fragment
to `SESSION_ROOT/artifacts/mcp-client.json`. Do not install it without separate
user authorization.
Native `/api/mcp` with the `ApiKey` header remains authoritative;
`/api/mcp/mcp` is compatibility-only when the canonical route is unavailable.
The local stdio bridge keeps the key out of client configuration and exposes
only the three read-only tools used to verify integrations and search Seerr. It
projects those tools from a successful native catalog and uses the same curated
schemas only for exact RPC `-32603` message
`Date cannot be represented in JSON Schema`.

`.sessions/RUN_ID/secrets.env` is the harness source of truth for service API
keys and the Homarr encryption key. The five-entry schema is unchanged; the
password is derived from that source. `browser-key capture ... homarr` stores
the Homarr API/MCP key separately in the private run; `homarr-key` remains the
secret-safe stdin fallback. `bootstrap`, `keys`, `browser-key`, `homarr-key`, and the
explicit command below atomically refresh the user-facing connections file:

```bash
scripts/session.sh connections RUN_ID
```

Validate the existing file's ownership, mode, exact key schema, service URLs,
usernames, and API-key shapes without printing its values:

```bash
scripts/session.sh connections-check RUN_ID
```

The command prints a plain-language service summary, the exact file path, and a
local `cat` command. The file is mode `0600`, is not an acceptance artifact or
harness input, never includes password fields, and omits `HOMARR_API_KEY` until
the one-time key is captured. Seerr's admin username is the linked Jellyfin
account; qBittorrent and Jellyfin have no harness-managed API key. Run
`connections` again whenever keys change.
Applications also persist credentials inside their own untracked per-run config
databases/files. Harness automation consumes `secrets.env`; humans use the
private connections file. Never copy its values into reports, screenshots,
tracked files, or agent/browser commands.

After all acceptance checks pass, refresh the private connection file:

```bash
scripts/session.sh connections RUN_ID
```

For initial setup with a requested saved credential handoff, run
`scripts/session.sh handoff RUN_ID`. It writes owner-only (0600)
`SESSION_ROOT/artifacts/private-handoff.json` with the generated password,
usernames, available API keys, host/internal URLs and storage paths. It also
writes `handoff-report.md` with secrets redacted. Return these paths, never
print or open the private file. During upkeep, re-export only when requested.
The handoff lists topology and marks acceptance unverified; the separate setup
report records actual passed, failed and pending checks.

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
