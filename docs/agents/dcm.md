# DCM (Docker Compose Maker)

`dcm/` is the source of Docker Compose Maker: React components, hooks, libraries, Container definitions, tests, the upvote Functions and generated data. It has no Astro app of its own. `site/` renders it at `https://self-host.fyi/compose`, and the same site build is published as `ghcr.io/ajnart/dcm`. DCM is AGPL-3.0 (`dcm/LICENSE`); the rest of the repository is Apache-2.0. Use `CONTEXT.md`'s words: DCM, Container, Template, DCM mode.

## Where things live

- Container definitions: `dcm/src/tools/<category>.ts`, collected by `dcm/src/tools/index.ts`. The `DockerTool` type is in `dcm/src/lib/docker-tools.ts`.
- Templates: `dcm/src/lib/template-definitions.ts`. The Catalog's Recipes become Templates automatically.
- Merge logic: `dcm/src/lib/catalog.ts` joins `dcm/src/tools` with `dcm/src/data/selfhost.json`.
- Pages: `site/src/pages/compose/` (`index.astro`, `templates.astro`, `template/[id].astro`) with the layout `site/src/layouts/Compose.astro`. Output follows the site's `build.format: "file"` (`compose.html`, `compose/templates.html`, `compose/template/<id>.html`), so Cloudflare Pages serves `/compose` and 308-redirects `/compose/` with the query kept.
- The `@/` alias: in `site/`, `@/` means `dcm/src` (`paths` in `site/tsconfig.json`). `dcm/tsconfig.json` maps `@/` to its own `src` for `tsc`, tests and the Pages Functions bundle. TypeScript in `dcm/` never imports from `site/`; only `dcm/src/styles/global.css` reaches into it, for the theme tokens and the Tailwind `@source` globs.
- Links: the prefix is fixed. Use `routes` from `dcm/src/lib/routes.ts` (`routes.compose`, `routes.templates`, `routes.template(id)`, `routes.api("stats" | "vote")`); there is no base-path variable.
- Styling: Tailwind is scoped to `/compose`. `dcm/src/styles/global.css` starts with `@import "tailwindcss" source(none)` and lists its `@source` globs, and only `Compose.astro` imports it, so no Tailwind rule reaches `/`, `/apps` or `/docs`. Header and footer are the site's `SiteHeader` and `SiteFooter`; the layout fills the header slot with the Suggest container button.
- Stars: `dcm/src/data/stars.json` (Containers) and `site/src/data/stars.json` (Apps) are committed. `bun run stars` at the root refreshes both with `GITHUB_TOKEN` set; `.github/workflows/stars.yml` does it weekly and opens a pull request. Never fetch stars at build time.
- Tests: `dcm/tests`, run with `bun test`.
- Dev: root `bun run dev` starts one Astro server on http://localhost:4321 serving `/` and `/compose`. Edits in `dcm/src` hot-reload there. Astro 7 daemonizes `astro dev` without a TTY: start it with `bunx astro dev --background` in `site/` and stop strays with `bunx astro dev stop`.

## Content Security Policy

The site sets one CSP through Astro's `security.csp`, and `site/src/lib/csp.mjs` fails the build when an inline script, style or style attribute is not covered. `Compose.astro` widens it for `/compose` only:

- `script-src` and `style-src-elem` allow `https://cdn.jsdelivr.net`, where `@monaco-editor/react` loads Monaco from, and `font-src` allows it plus `data:`.
- `worker-src blob:` lets Monaco start its workers.
- `style-src-elem` and `style-src-attr` allow `'unsafe-inline'` because Monaco injects `<style>` elements and sets `style` attributes at runtime, which hashes cannot cover. `cspCheck` skips the style-attribute hash check on pages whose policy allows it and still checks every inline script and `<style>`.

`/`, `/apps` and `/docs` keep the strict policy. Tighten `/compose` only together with self-hosting Monaco. `canvas-confetti` works under this policy: it draws with a canvas and needs no worker.

## Upvotes

`dcm/functions/api/{vote,stats}.ts` are Pages Functions, mounted at `/compose/api/*` by the re-exports in `functions/compose/api/`. `site/dist-pages/_routes.json` lets only `/compose/api/*` invoke Functions. When the API is unavailable (no KV binding, a static host, the image) the upvote control is hidden, not disabled. Setup of the KV binding and secret is in `docs/releasing.md`; the API and its limits are in `dcm/README.md`.

Test voting locally against the real artifact, from the repository root:

```bash
SELF_HOST_SITE_VERSION=0.0.0 bash scripts/build-site-pages.sh
bunx wrangler pages dev site/dist-pages --kv=UPVOTES --binding VOTE_IP_SECRET=local-development-only
```

`astro dev` serves no Functions, so voting only works through Wrangler's URL. `POST /compose/api/vote` needs a `CF-Connecting-IP` header and an `Origin` matching the Wrangler URL. `GET /compose/api/stats` is cached for 60 seconds (Cache API, `max-age=60`), so a count lags a vote by up to 60 seconds. Leave out `--kv` to check that the control disappears.

## How an App reaches DCM

`go run ./tools/sitegen` reads the Go Catalog (`internal/apps/`, `internal/catalog/`) and writes `dcm/src/data/selfhost.json`: per App a standalone compose, ports, env and notes, plus the Recipes. DCM's **self-host** mode lists only those Apps; **All** adds the Containers defined in `dcm/src/tools`. A tool whose `id` equals an App's `id` (or an alias in `dcm/src/lib/selfhost.ts`) takes the App's compose, so a Container never competes with its App.

To change an App's compose or metadata in DCM, change the App under `internal/apps/<id>/` and rerun sitegen. Never hand-edit `dcm/src/data/selfhost.json`; CI fails on drift.

## Add or edit a Container

1. Pick the category file in `dcm/src/tools/`. Add a `DockerTool` with a lowercase hyphenated `id`, `composeContent` that starts with `services:` and uses `${PUID}`, `${PGID}`, `${TZ}`, `${CONFIG_PATH}`, `${DATA_PATH}`, `${CONTAINER_PREFIX}` and `${RESTART_POLICY}`, a `githubUrl` when the project has one, and no `stars` (`bun run stars` writes them).
2. If the Catalog already has the App, stop: the App's compose wins, so edit it in `internal/apps/` instead.
3. Cite the upstream image and ports from a current primary source (the project's own docs or registry page).
4. Run the files you touched: `bun test dcm/tests/validate-all-containers.test.ts`, `templates.test.ts`, `validate-networks.test.ts`. `validate-compose.test.ts` runs `docker compose config` and needs Docker, so leave it to CI.
5. Run `bunx turbo run build lint` from the root.

Issues with the `container` label and then `accepted` make `.github/workflows/dcm-add-container.yml` open the pull request into `dcm/src/tools/`.

## The image

`dcm/Dockerfile` packs the built site (`site/dist`, passed as the named build context `site`) into busybox httpd on port 7576. busybox cannot map `/compose` to `compose.html`, so the first stage, which runs on the build platform and never under QEMU, moves every `X.html` to `X/index.html`, drops the heavy social images and reel, and writes a `/` page that forwards to `/compose` with the query kept. httpd then redirects `/compose` to `/compose/` and keeps the query. `dcm/httpd.conf` holds the MIME types and `E404:404.html` (the path must be relative; an absolute one is ignored). The image has no Functions, so the upvote control is hidden. Build and try it locally:

```bash
SELF_HOST_SITE_VERSION=0.0.0 bun run --cwd site build
docker buildx build --load --build-context site=site/dist -t dcm-test -f dcm/Dockerfile dcm
docker run --rm -p 7576:7576 dcm-test
```

## Gate

The web gate in `AGENTS.md` applies to every change under `dcm/`. `ci.yml`'s `web` job runs it plus `test:compose`, and its `test` job runs the sitegen drift check. `dcm-image.yml` tests, builds the site and pushes the image on pushes to `dcm/**`, `site/**` and `tools/sitegen/**`, and on `dcm-v*` tags.

## Ownership

- `tools/sitegen` owns `dcm/src/data/selfhost.json` and `site/src/data/`; `bun run stars` owns the two `stars.json` files. `dcm/src/tools` owns DCM-only Containers.
- `dcm/bun.lock` does not exist: dependencies go through the root `bun.lock`, installed with `bun install` at the root.
- Release and Pages steps: `docs/releasing.md` (Docker Compose Maker at /compose).
