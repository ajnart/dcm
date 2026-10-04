# Runtime contract

The packaged harness lives below `assets/harness` and has no repository-root
dependency. Set `MEDIA_SKILL_ROOT` to the absolute directory containing the
workflow's `GUIDE.md`; its `scripts/media-runtime.ts` copies the harness into the
selected project's `.selfhost/media-harness` directory.

## Installer commands

```bash
bun "$MEDIA_SKILL_ROOT/scripts/media-runtime.ts" init [--project PATH]
bun "$MEDIA_SKILL_ROOT/scripts/media-runtime.ts" sync [--project PATH]
bun "$MEDIA_SKILL_ROOT/scripts/media-runtime.ts" verify [--project PATH]
bun "$MEDIA_SKILL_ROOT/scripts/media-runtime.ts" exec [--project PATH] -- session ARGS...
bun "$MEDIA_SKILL_ROOT/scripts/media-runtime.ts" exec [--project PATH] -- render-prompt ARGS...
```

- `init` creates or resumes an allowlisted private copy.
- `sync` requires an existing copy, replaces changed files atomically, and is
  safe to retry after interruption.
- `verify` checks owners, modes, hashes, the installed manifest, and unexpected
  content.
- `exec` verifies first, then forwards without a shell to `session.sh` or
  `render-prompt.sh`.

All four commands reject the filesystem root, the user's home directory,
world-writable or wrong-owner projects, unsafe owners or modes, and symlinked
paths. They reserve `.sessions` for the harness and never inspect, replace,
chmod, or delete an existing tree with that name.

For an existing CLI-managed runtime, use the installed CLI's reviewed upgrade
transaction instead of the skill-runtime `sync` command:

```bash
self-host install media runtime-sync plan --project-root /absolute/project
self-host install media runtime-sync apply --project-root /absolute/project --approve sha256:REVIEWED_DIGEST
```

The plan verifies the packaged and installed manifests without Docker. Apply
holds the project runtime lock, requires the exact plan digest, preserves
`.sessions`, installs `runtime-manifest.json` last, and appends the approved
old-to-new hashes to the mode-`0600` transition ledger. It retains an
owner-only content-addressed rollback copy and can resume the same transaction
after interruption. Existing intent and deployment approvals remain pinned to
their original runtime hash and are accepted only through that exact transition
chain. Plan and apply require a current-owner project root without group/world
write access and real owner-only `.selfhost` and harness directories. Close
older CLI operations before the first sync; all current media CLI
commands use the same project lock and refuse an incomplete transaction.
The lock is fail-closed and is not reclaimed from a stale-looking PID. If an
interrupted invocation leaves `.selfhost-media-runtime.lock`, confirm the
recorded process is gone and no media CLI command is using the project, then
inspect the exact file's owner, mode, inode, and link count before removing only
that pathname. Link count two indicates an interrupted hardlink acquisition;
also inspect and remove only the uniquely named candidate pathname with the
same inode. Never use a wildcard or recursive removal for lock recovery.

## Bundle checks

```bash
bun "$MEDIA_SKILL_ROOT/scripts/verify-bundle.ts"
bun "$MEDIA_SKILL_ROOT/scripts/verify-bundle.ts" --source-root /path/to/canonical/source
```

The first command validates the manifest, allowed paths, modes, SHA256 hashes,
prompt module list, and seven-image Compose contract. The optional source check
compares only `docker-compose.yml`, `PROMPT.md`, `prompts/**`, `docs/**`, and
`scripts/**`; excluded private/runtime paths are skipped.

The `skills` installer may normalize packaged regular files from `0644`/`0755`
to `0664`/`0775`. Bundle verification accepts either the exact manifest mode or
that mode with only group write added, and only when every file is a regular
single-link file owned by the current user and group. World write, special mode
bits, symlinks, hard links, other mode changes, and wrong ownership still fail.
Do not use `chmod` to work around a verifier failure.

The six non-Homarr `:latest` images are intentional only in this isolated setup
harness with per-run ports. Default published ports use all host interfaces;
approve a router or Docker-aware firewall policy before starting that mode.
`session create RUN_ID USERNAME --bind-mode host-only` explicitly publishes all
seven ports on 127.0.0.1 for a host-local private proxy. Production composition
must use `selfhost-compose`, whose contract rejects floating images. Do not pin
these setup references without verified remote multi-architecture index
digests.
For a preplanned range, `session create RUN_ID USERNAME --port-start FIRST`
reserves `FIRST` through `FIRST+6` or fails without creating the session.
`FIRST` must be 20000–44993. Check all seven ports in fresh host inspection
before bundle initialization; the default automatic allocator is unchanged.
When fresh read-only inspection shows no usable default Docker address pool,
`session create RUN_ID USERNAME --network-subnets DEFAULT_CIDR,WEB_CIDR`
selects two distinct, non-overlapping canonical RFC1918 IPv4 networks from
`/24` through `/28`. The run records `MEDIA_DEFAULT_SUBNET` and
`MEDIA_WEB_SUBNET` and creates a mode-`0600` `network-ipam.compose.yml` inside
that run only. Every Compose action validates and applies this project-owned
override. It does not edit daemon configuration, global address pools, or
unrelated Docker networks. Omitting the option preserves the existing default
allocation path. CLI setup also records the pair in its intent and approval
facts, so apply requires the exact reviewed digest.

## Browser fallback prerequisite

`selfhost-setup` installs and checks agent-browser only after an API script
fails or visual proof is requested. The harness does not manage that optional
prerequisite. `browser-password` and `browser-key` invoke agent-browser
directly. Only a direct `ENOENT` retries `bunx --bun agent-browser`; a launched
nonzero action is never retried. `browser-key capture` retrieves a fresh key
input without printing it, verifies Arr/Seerr keys against managed run state,
and privately stores the one-time Homarr key. `browser-key fill` sends the
selected managed key to one fresh Homarr input ref over browser stdin.

## Session lifecycle

After installation, use one identifier matching
`[a-z0-9][a-z0-9_-]{0,39}`:

```bash
bun "$MEDIA_SKILL_ROOT/scripts/media-runtime.ts" exec -- session create RUN_ID USERNAME
bun "$MEDIA_SKILL_ROOT/scripts/media-runtime.ts" exec -- session doctor RUN_ID
bun "$MEDIA_SKILL_ROOT/scripts/media-runtime.ts" exec -- session urls RUN_ID
bun "$MEDIA_SKILL_ROOT/scripts/media-runtime.ts" exec -- session up RUN_ID
bun "$MEDIA_SKILL_ROOT/scripts/media-runtime.ts" exec -- session bootstrap RUN_ID
bun "$MEDIA_SKILL_ROOT/scripts/media-runtime.ts" exec -- session verify RUN_ID
bun "$MEDIA_SKILL_ROOT/scripts/media-runtime.ts" exec -- session browser-key capture RUN_ID SERVICE @eN
bun "$MEDIA_SKILL_ROOT/scripts/media-runtime.ts" exec -- session browser-key fill RUN_ID SERVICE @eN
bun "$MEDIA_SKILL_ROOT/scripts/media-runtime.ts" exec -- session connections-check RUN_ID
bun "$MEDIA_SKILL_ROOT/scripts/media-runtime.ts" exec -- session connections RUN_ID
bun "$MEDIA_SKILL_ROOT/scripts/media-runtime.ts" exec -- session handoff RUN_ID
```

Run state belongs only to `.sessions/RUN_ID`. Use project-scoped status and logs;
never infer ports, container names, or another run's state.

New manifests carry `SESSION_PASSWORD_SCHEME=hmac-v1`. A missing marker denotes
a legacy run and is accepted only for inspection and bounded cleanup. Legacy
runs allow `doctor`, `urls`, `env`, `status`, `mcp-verify`, `down`, and
`destroy`. The exact current marker is required for `up`, `keys`, `bootstrap`,
`verify`, `browser-password`, `browser-key`, `homarr-key`, `homarr-finalize`, `mcp-config`,
`connections-check`, `connections`, and `handoff`; recreate under a new run
identifier instead of migrating access state in place.
The internal read-only Compose-log helper remains marker-optional; there is no
standalone `session.sh logs` command.

Sessions created by the previous harness may contain both the current password
scheme and a private `credentials.env`. The harness accepts that file only as a
bounded migration artifact without reading it. `connections` or `handoff`
replaces it with `connections.env`; `destroy` removes it during cleanup.

Bootstrap creates mode-`0600` `SESSION_ROOT/connections.env`. `keys`,
`browser-key`, `homarr-key`, and `connections` refresh it atomically. It contains `RUN_ID`,
service URLs, usernames, and only available API keys; it never contains a
password field or derived password. Its URLs use `localhost` and assigned
collision-free ports; use the host's private LAN name or address from another
device. After acceptance, `connections` refreshes that file without revealing a
password. When requested, `handoff` writes
`artifacts/private-handoff.json` (0600) with the generated password, usernames,
available API keys, URLs and storage paths, plus redacted `handoff-report.md`.
It prints only paths and fixed summaries. Upkeep exports only when explicitly
requested. Export does not prove that setup or acceptance succeeded.
