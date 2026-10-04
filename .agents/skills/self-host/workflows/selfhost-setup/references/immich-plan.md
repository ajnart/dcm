# Immich v3.2.2 manifest builder

`scripts/immich-plan.ts` maps the official four-service Immich v3.2.2 topology
to a generic `selfhost-compose` manifest for `linux/amd64`. The recorded image
references come from `research/selfhost-audit-2026-09-21/household-images.json`.
They are platform manifests, so resolve new digests before another architecture
or release.

The input explicitly supplies the project observation, loopback/private port
2283 bind, owned upload and model-cache paths, local-filesystem database path,
and an opaque database-password file reference below the project `secrets`
directory. The standalone CLI requires the fixed
`secrets/immich-database-password` path so it can materialize the managed
household credential only after exact-plan approval. The builder itself never
reads or creates that file. It passes the same
secret target to Immich through `DB_PASSWORD_FILE` and PostgreSQL through
`POSTGRES_PASSWORD_FILE`. Only `immich-server` joins the optional verified
existing integration network; this lets the existing Homarr reach Immich
without deploying another Homarr.

`allowSetup` is required. Use `true` only for a fresh, approved private first
administrator window. Use `false` for every resume after that account exists,
including the required post-onboarding Compose revision. The builder emits the
choice as `IMMICH_ALLOW_SETUP` instead of relying on an implicit default. The
private network's optional `ownership` defaults to `new` for compatibility;
the CLI records `verified-existing` only after its setup-closure inspection.

Copy [immich-plan.example.json](immich-plan.example.json), replace host facts,
then generate a read-only validated manifest:

```text
bun scripts/immich-plan.ts --input /absolute/path/immich-input.json > /absolute/path/immich-manifest.json
```

The output retains the server, machine-learning, Valkey, and VectorChord
PostgreSQL services; built-in health commands are made explicit, and the server
retains the release file's started-service dependencies on database and cache.
The named model cache is
represented as an explicitly owned bind source so Docker cannot create storage
implicitly.

The official v3.2.2 release Compose does not declare `init: true`. Its optional
read-only `/etc/localtime` bind is intentionally omitted because timezone is a
host preference and not part of the four-service dependency topology.

The database manifest includes the official 128 MiB shared-memory allocation.
Manifest validation is not a live apply, configuration, or acceptance result;
the recipe remains guided and unverified until those stages succeed.

The packaged CLI exposes `immich plan`, `apply`, `bootstrap`, `close-setup`,
`status`, `accept`, and `homarr-key plan|create`.
Plan approval tokens bind the manifest, Compose plan, run, and owner-only
account metadata file. Apply delegates render, preflight, and mutation to
`selfhost-compose`. Bootstrap reads the generated application password from
the private household handoff, checks setup state before posting the Stable
v3.2.2 admin signup body, verifies login, and falls back to the browser on an
uncertain result. It never retries signup blindly or turns off setup.
`close-setup` verifies the exact rendered Compose project, its healthy services,
mount, port and network evidence, initialization, and managed owner login before
atomically revising the owner-only input. It emits a new plan and approval but
never applies Docker. Disabling setup therefore remains a separately inspected
and approved Compose revision.

After applying that revision, run `immich accept` with the same project,
input, account file, and run ID, plus the internal Homarr integration origin
and an unused acceptance-file path. It checks the exact running Compose
server and `IMMICH_ALLOW_SETUP=false`, admin login, release version, and a
generated PNG's upload/original bytes. It moves only that test asset to
recoverable trash. A passing run writes a mode-`0600` acceptance file for
`homarr attach immich`; it does not prove backups or remote access.

`immich homarr-key plan|create` consumes that acceptance file. Create requires
its exact approval, creates one key named Homarr with the documented Immich
integration permissions, verifies the key against Immich, and saves the
one-time secret to an unused mode-`0600` file. The CLI prints only the file
path and key ID. Feed that file to `homarr attach immich`; keep the key out of
prompts and client configuration.

Sources:

- [v3.2.2 release Compose](https://github.com/immich-app/immich/releases/download/v3.2.2/docker-compose.yml)
- [v3.2.2 server image healthcheck](https://github.com/immich-app/immich/blob/v3.2.2/server/Dockerfile)
- [v3.2.2 machine-learning healthcheck](https://github.com/immich-app/immich/blob/v3.2.2/machine-learning/Dockerfile)
- [Immich installation requirements](https://docs.immich.app/install/requirements/)
