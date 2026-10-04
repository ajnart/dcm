# Dashdot first-run: host-observation authority remains gated

Checked 2026-10-03. Reused the monitoring and remaining-installability audits,
then fetched pinned upstream source, Context7 `/mauricenino/dashdot` deployment
docs, and publisher tag metadata. Context7 indexes `main`; v6.3.4 source is the
implementation contract. No Docker, browser, deployment, runtime-state reads,
credentials, CI or live acceptance.

## Image and minimum useful role

The [publisher tag API](https://hub.docker.com/v2/repositories/mauricenino/dashdot/tags/6.3.4)
reports `mauricenino/dashdot:6.3.4` active, index
`sha256:434a54d2937411a06b09c50e55709cc7d3b092c0fe173a9e5c986f9b5a33c7c6`,
Linux amd64 `sha256:f2d369deb4e53c0b2071fa598e665a9ecd5c619d5244e555dc11bcc06c3db79a`
and arm64 `sha256:56ff46b380e8a8b5886bdb37a8c572140beb98adc90cadec0a1b61b162c5182f`.
These are registry observations, not installed-image provenance.

The [pinned Compose example](https://raw.githubusercontent.com/MauriceNino/dashdot/v6.3.4/apps/docs/content/docs/installation/docker-compose.mdx)
uses port 3001, privileged mode and read-only host root. However, the
[pinned FAQ](https://raw.githubusercontent.com/MauriceNino/dashdot/v6.3.4/apps/docs/content/docs/faq.mdx)
explicitly permits selected read-only mounts instead: host OS-release,
`/proc/1/ns/net`, and exact drive mountpoints mirrored under `/mnt/host`.
Blanket host root is **not** an inherent requirement. The app purpose remains
host monitoring; container-only metrics are not an equivalent replacement.

## Exact missing shared primitive

The [startup entrypoint](https://raw.githubusercontent.com/MauriceNino/dashdot/v6.3.4/apps/server/src/index.ts)
always calls networking and OS setup before loading widgets. The
[setup source](https://raw.githubusercontent.com/MauriceNino/dashdot/v6.3.4/apps/server/src/setup.ts)
can invoke `nsenter --net=/mnt/host/proc/1/ns/net` and, if necessary, mount sysfs
inside that namespace. Selecting only CPU/RAM widgets does not skip these calls.
An explicit network-interface setting skips interface discovery, not necessarily
the mount fallback. No minimum capability set was proven here.

`packages/cli/src/lib/multi-service-recipe.ts:selectedHostPaths` rejects
`/proc`, `/sys`, host root and other protected host paths; the recipe schema has
no separately approved namespace/capability grant. Needed: a reviewed
host-observation profile binding exact owner, service, image, selected read-only
paths and **proved minimum** permissions, with independent host identity and
metric checks. Do not relax generic selected paths, infer privileged mode,
mount a socket, or substitute host networking. No recipe or discoverable
`setup.ts` is added while this authority is absent.

## Safe app-side preparation

`apps/dashdot/inspection.ts:inspectDashdotApi` reuses the existing exact-owner
status assertion and read-only shared HTTP surface. It checks pinned version and
CPU/RAM configuration through `/config`, non-placeholder static information
through `/info`, and numeric payloads through `/load/cpu` and `/load/ram`.
Those endpoints are in the
[API docs](https://raw.githubusercontent.com/MauriceNino/dashdot/v6.3.4/apps/docs/content/docs/integration/api.mdx);
the response shape is grounded in
[static information](https://raw.githubusercontent.com/MauriceNino/dashdot/v6.3.4/apps/server/src/static-info.ts),
[CPU data](https://raw.githubusercontent.com/MauriceNino/dashdot/v6.3.4/apps/server/src/data/cpu.ts)
and [RAM data](https://raw.githubusercontent.com/MauriceNino/dashdot/v6.3.4/apps/server/src/data/ram.ts).
The helper returns no raw host inventory, credentials or readiness claim;
`hostMetricsVerified` and `homarrVerified` remain false. No administrator or API
key bootstrap is invented for this unauthenticated API.

The existing `homarr.json` declares native `dashDot`, no required secrets, and
health/resources/disks widgets. It is retained, not claimed deployed. Homarr's
canonical image remains `ghcr.io/homarr-labs/homarr:dev`; no test image is used.
API observation does not prove the host namespace, metric accuracy/freshness,
disk/network coverage, Homarr connection/widgets or restart persistence.

Validation: only `packages/cli/tests/dashdot-inspection.test.ts` (synthetic
exact-owner/read-only/invalid-payload/replay fixture) and Bun syntax builds of
that fixture and `inspection.ts`. These are source checks, not live acceptance.
