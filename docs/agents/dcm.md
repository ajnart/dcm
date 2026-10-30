# DCM (Docker Compose Maker)

`dcm/` is an Astro app with React islands, served at `https://self-host.fyi/compose` and published as `ghcr.io/ajnart/dcm`. It is AGPL-3.0 (`dcm/LICENSE`); the rest of the repository is Apache-2.0. Use `CONTEXT.md`'s words: DCM, Container, Template, DCM mode.

## Where things live

- Container definitions: `dcm/src/tools/<category>.ts`, collected by `dcm/src/tools/index.ts`. The `DockerTool` type is in `dcm/src/lib/docker-tools.ts`.
- Templates: `dcm/src/lib/template-definitions.ts`. The Catalog's Recipes become Templates automatically.
- Merge logic: `dcm/src/lib/catalog.ts` joins `dcm/src/tools` with `dcm/src/data/selfhost.json`.
- Pages: `dcm/src/pages/`. Prefix every internal link with `withBase()` from `dcm/src/lib/base.ts`: the same build serves `/compose` (`DCM_BASE=/compose`) and `/` (image, standalone Pages project).
- Upvotes: `dcm/functions/api/{vote,stats}.ts`, re-exported by `functions/compose/api/` for the self-host-fyi Pages project. Setup of the KV binding and secret is in `docs/releasing.md`.
- Tests: `dcm/tests`, run with `bun test`.
- Dev: root `bun run dev` starts the site on :4321 and DCM on :4322 at `/compose/`; in dev each links to the other's port. They cannot share one origin: Astro serves Vite's own paths (`/@vite/client`, `/src/…`, `/@fs/…`) outside `base`, so a proxy mixes both apps' modules. Astro 7 daemonizes `astro dev` without a TTY: stop strays with `bunx astro dev stop` in `site/` or `dcm/`.

## How an App reaches DCM

`go run ./tools/sitegen` reads the Go Catalog (`internal/apps/`, `internal/catalog/`) and writes `dcm/src/data/selfhost.json`: per App a standalone compose, ports, env and notes, plus the Recipes. DCM's **self-host** mode lists only those Apps; **All** adds the Containers defined in `dcm/src/tools`. A tool whose `id` equals an App's `id` (or an alias in `dcm/src/lib/selfhost.ts`) takes the App's compose, so a Container never competes with its App.

To change an App's compose or metadata in DCM, change the App under `internal/apps/<id>/` and rerun sitegen. Never hand-edit `dcm/src/data/selfhost.json`; CI fails on drift.

## Add or edit a Container

1. Pick the category file in `dcm/src/tools/`. Add a `DockerTool` with a lowercase hyphenated `id`, `composeContent` that starts with `services:` and uses `${PUID}`, `${PGID}`, `${TZ}`, `${CONFIG_PATH}`, `${DATA_PATH}`, `${CONTAINER_PREFIX}` and `${RESTART_POLICY}`, and no `stars` (fetched at runtime).
2. If the Catalog already has the App, stop: the App's compose wins, so edit it in `internal/apps/` instead.
3. Cite the upstream image and ports from a current primary source (the project's own docs or registry page).
4. Run the files you touched: `bun test dcm/tests/validate-all-containers.test.ts`, `templates.test.ts`, `validate-networks.test.ts`. `validate-compose.test.ts` runs `docker compose config` and needs Docker, so leave it to CI.
5. Run `bunx turbo run build lint` from the root.

Issues with the `container` label and then `accepted` make `.github/workflows/dcm-add-container.yml` open the pull request into `dcm/src/tools/`.

## Gate

The web gate in `AGENTS.md` applies to every change under `dcm/`. `ci.yml`'s `web` job runs it with `DCM_BASE=/compose` plus `test:compose`, and its `test` job runs the sitegen drift check; `dcm-image.yml` tests and builds the image at `/` on `dcm/**` pushes and `dcm-v*` tags. Standalone build: `bash scripts/build-dcm-pages.sh`.

## Ownership

- `tools/sitegen` owns `dcm/src/data/`. `dcm/src/tools` owns DCM-only Containers.
- `dcm/bun.lock` does not exist: dependencies go through the root `bun.lock`, installed with `bun install` at the root.
- Release and Pages steps: `docs/releasing.md` (Docker Compose Maker at /compose).
