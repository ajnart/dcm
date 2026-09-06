# Runtime contract

The packaged harness lives below `assets/harness` and has no repository-root
dependency. Set `MEDIA_SKILL_ROOT` to the absolute directory containing the
skill's `SKILL.md`; its `scripts/media-runtime.ts` copies the harness into the
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
harness with per-run ports. Published ports omit a host
IP, so keep the host behind a trusted LAN or firewall. Production composition
must use `selfhost-compose`, whose contract rejects floating images. Do not pin
these setup references without verified remote multi-architecture index
digests.

## Browser runtime prerequisite

`selfhost-setup` installs and checks the agent-browser skill, runtime, and
browser before the media harness starts. The harness does not manage that
prerequisite. `browser-password` first invokes agent-browser directly. Only a
direct `ENOENT` retries `bunx --bun agent-browser`; a launched nonzero action is
never retried.

## Session lifecycle

After installation, use one identifier matching
`[a-z0-9][a-z0-9_-]{0,39}`:

```bash
bun "$MEDIA_SKILL_ROOT/scripts/media-runtime.ts" exec -- session create RUN_ID
bun "$MEDIA_SKILL_ROOT/scripts/media-runtime.ts" exec -- session doctor RUN_ID
bun "$MEDIA_SKILL_ROOT/scripts/media-runtime.ts" exec -- session urls RUN_ID
bun "$MEDIA_SKILL_ROOT/scripts/media-runtime.ts" exec -- session up RUN_ID
bun "$MEDIA_SKILL_ROOT/scripts/media-runtime.ts" exec -- session bootstrap RUN_ID
bun "$MEDIA_SKILL_ROOT/scripts/media-runtime.ts" exec -- session verify RUN_ID
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
`verify`, `browser-password`, `homarr-key`, `homarr-finalize`, `mcp-config`,
`connections-check`, `connections`, and `handoff`; recreate under a new run
identifier instead of migrating access state in place.
The internal read-only Compose-log helper remains marker-optional; there is no
standalone `session.sh logs` command.

Sessions created by the previous harness may contain both the current password
scheme and a private `credentials.env`. The harness accepts that file only as a
bounded migration artifact without reading it. `connections` or `handoff`
replaces it with `connections.env`; `destroy` removes it during cleanup.

Bootstrap creates mode-`0600` `SESSION_ROOT/connections.env`. `keys`,
`homarr-key`, and `connections` refresh it atomically. It contains `RUN_ID`,
service URLs, usernames, and only available API keys; it never contains a
password field or derived password. Its URLs use `localhost` and assigned
collision-free ports; use the host's private LAN name or address from another
device. After acceptance, `connections` refreshes that file without revealing a
password. Initial setup then uses `handoff` to display the admin username and
derived password without persisting it. Upkeep runs `handoff` only when the user
explicitly requests a fresh access handoff.
