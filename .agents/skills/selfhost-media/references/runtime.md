# Runtime contract

The packaged harness lives below `assets/harness` and has no repository-root
dependency. Set `MEDIA_SKILL_ROOT` to the absolute directory containing the
skill's `SKILL.md`; its `scripts/media-runtime.mjs` copies the harness into the
selected project's `.selfhost/media-harness` directory.

## Installer commands

```bash
node "$MEDIA_SKILL_ROOT/scripts/media-runtime.mjs" init [--project PATH]
node "$MEDIA_SKILL_ROOT/scripts/media-runtime.mjs" sync [--project PATH]
node "$MEDIA_SKILL_ROOT/scripts/media-runtime.mjs" verify [--project PATH]
node "$MEDIA_SKILL_ROOT/scripts/media-runtime.mjs" exec [--project PATH] -- session ARGS...
node "$MEDIA_SKILL_ROOT/scripts/media-runtime.mjs" exec [--project PATH] -- render-prompt ARGS...
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
node "$MEDIA_SKILL_ROOT/scripts/verify-bundle.mjs"
node "$MEDIA_SKILL_ROOT/scripts/verify-bundle.mjs" --source-root /path/to/canonical/source
```

The first command validates the manifest, allowed paths, modes, SHA256 hashes,
prompt module list, and seven-image Compose contract. The optional source check
compares only `docker-compose.yml`, `PROMPT.md`, `prompts/**`, `docs/**`, and
`scripts/**`; excluded private/runtime paths are skipped.

## Session lifecycle

After installation, use one identifier matching
`[a-z0-9][a-z0-9_-]{0,39}`:

```bash
node "$MEDIA_SKILL_ROOT/scripts/media-runtime.mjs" exec -- session create RUN_ID
node "$MEDIA_SKILL_ROOT/scripts/media-runtime.mjs" exec -- session doctor RUN_ID
node "$MEDIA_SKILL_ROOT/scripts/media-runtime.mjs" exec -- session urls RUN_ID
node "$MEDIA_SKILL_ROOT/scripts/media-runtime.mjs" exec -- session up RUN_ID
node "$MEDIA_SKILL_ROOT/scripts/media-runtime.mjs" exec -- session bootstrap RUN_ID
node "$MEDIA_SKILL_ROOT/scripts/media-runtime.mjs" exec -- session verify RUN_ID
```

Run state belongs only to `.sessions/RUN_ID`. Use project-scoped status and logs;
never infer ports, container names, or another run's state.
