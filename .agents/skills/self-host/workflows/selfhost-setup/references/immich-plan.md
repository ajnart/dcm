# Immich v3.2.2 manifest builder

`scripts/immich-plan.ts` maps the official four-service Immich v3.2.2 topology
to a generic `selfhost-compose` manifest for `linux/amd64`. The recorded image
references come from `research/selfhost-audit-2026-09-21/household-images.json`.
They are platform manifests, so resolve new digests before another architecture
or release.

The input explicitly supplies the project observation, loopback/private port
2283 bind, owned upload and model-cache paths, local-filesystem database path,
and an opaque database-password file reference below the project `secrets`
directory. The builder never reads or creates that file. It passes the same
secret target to Immich through `DB_PASSWORD_FILE` and PostgreSQL through
`POSTGRES_PASSWORD_FILE`. Only `immich-server` joins the optional verified
existing integration network; this lets the existing Homarr reach Immich
without deploying another Homarr.

`allowSetup` is required. Use `true` only for a fresh, approved private first
administrator window. Use `false` for every resume after that account exists,
including the required post-onboarding Compose revision. The builder emits the
choice as `IMMICH_ALLOW_SETUP` instead of relying on an implicit default.

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

Sources:

- [v3.2.2 release Compose](https://github.com/immich-app/immich/releases/download/v3.2.2/docker-compose.yml)
- [v3.2.2 server image healthcheck](https://github.com/immich-app/immich/blob/v3.2.2/server/Dockerfile)
- [v3.2.2 machine-learning healthcheck](https://github.com/immich-app/immich/blob/v3.2.2/machine-learning/Dockerfile)
- [Immich installation requirements](https://docs.immich.app/install/requirements/)
