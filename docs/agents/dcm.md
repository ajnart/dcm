# DCM (Docker Compose Maker)

`dcm/` is the source of Docker Compose Maker: React components, hooks, libraries, Container definitions, tests and generated data. It has no Astro app of its own. `site/` renders it at `https://self-host.fyi/compose`, and the same site build is published as `ghcr.io/ajnart/dcm`. DCM is AGPL-3.0 (`dcm/LICENSE`); the rest of the repository is Apache-2.0. Use `CONTEXT.md`'s words: DCM, Container, Template, DCM mode.

## Where things live

- Container definitions: `dcm/src/tools/<category>.ts`, collected by `dcm/src/tools/index.ts`. The `DockerTool` type is in `dcm/src/lib/docker-tools.ts`.
- Templates: `dcm/src/lib/template-definitions.ts`. The Catalog's Recipes become Templates automatically.
- Merge logic: `dcm/src/lib/catalog.ts` joins `dcm/src/tools` with `dcm/src/data/selfhost.json`.
- Export: `dcm/src/lib/export/` owns everything a selection turns into. `buildExport(ids, catalog, settings, { recipe? })` resolves the ids, splits out install-only Apps, dedupes services, fixes port conflicts, writes the compose and `.env`, and returns the notes and the `self-host install` command. Components render the result and call `track()`; they never assemble YAML or env. Settings and their defaults live in `dcm/src/lib/settings.ts`. Its tests are `dcm/tests/export.test.ts`.
- Pages: `site/src/pages/compose/` (`index.astro`, `templates.astro`, `template/[id].astro`) with the layout `site/src/layouts/Compose.astro`. Output follows the site's `build.format: "file"` (`compose.html`, `compose/templates.html`, `compose/template/<id>.html`), so Cloudflare Pages serves `/compose` and 308-redirects `/compose/` with the query kept.
- The `@/` alias: in `site/`, `@/` means `dcm/src` (`paths` in `site/tsconfig.json`). `dcm/tsconfig.json` maps `@/` to its own `src` for `tsc` and tests. TypeScript in `dcm/` never imports from `site/`; only `dcm/src/styles/global.css` reaches into it, for the theme tokens and the Tailwind `@source` globs.
- Links: the prefix is fixed. Use `routes` from `dcm/src/lib/routes.ts` (`routes.compose`, `routes.templates`, `routes.template(id)`); there is no base-path variable.
- Styling: Tailwind is scoped to `/compose`. `dcm/src/styles/global.css` starts with `@import "tailwindcss" source(none)` and lists its `@source` globs, and only `Compose.astro` imports it, so no Tailwind rule reaches `/`, `/apps` or `/docs`. Header and footer are the site's `SiteHeader` and `SiteFooter`; the layout fills the header slot with a link to `/compose/suggest`, the Suggest container page (`dcm/src/components/suggest-page.tsx`, prompt in `dcm/src/lib/suggest.ts`). Container requests go through an agent prompt or the `dcm-container-submission` issue template, which `.github/workflows/dcm-add-container.yml` consumes by its `container` and `accepted` labels.
- Stars: `dcm/src/data/stars.json` (Containers) and `site/src/data/stars.json` (Apps) are committed. `bun run stars` at the root refreshes both with `GITHUB_TOKEN` set; `.github/workflows/stars.yml` does it weekly and opens a pull request. Never fetch stars at build time.
- Tests: `dcm/tests`, run with `bun test`.
- Dev: root `bun run dev` starts one Astro server on http://localhost:4321 serving `/` and `/compose`. Edits in `dcm/src` hot-reload there. Astro 7 daemonizes `astro dev` without a TTY: start it with `bunx astro dev --background` in `site/` and stop strays with `bunx astro dev stop`.

## Content Security Policy

The site sets one CSP through Astro's `security.csp`, and `site/src/lib/csp.mjs` fails the build when an inline script, style or style attribute is not covered. `Compose.astro` widens it for `/compose` only:

- `script-src` and `style-src-elem` allow `https://cdn.jsdelivr.net`, where `@monaco-editor/react` loads Monaco from, and `font-src` allows it plus `data:`.
- `worker-src blob:` lets Monaco start its workers.
- `style-src-elem` and `style-src-attr` allow `'unsafe-inline'` because Monaco injects `<style>` elements and sets `style` attributes at runtime, which hashes cannot cover. `cspCheck` skips the style-attribute hash check on pages whose policy allows it and still checks every inline script and `<style>`.

`/`, `/apps` and `/docs` keep the strict policy. Tighten `/compose` only together with self-hosting Monaco. `canvas-confetti` works under this policy: it draws with a canvas and needs no worker.

## How an App reaches DCM

`go run ./tools/sitegen` reads the Go Catalog (`internal/apps/`, `internal/catalog/`) and writes `dcm/src/data/selfhost.json`: per App a standalone compose, ports, env and notes, plus the Recipes. DCM's **self-host** mode (`/apps`) lists only those Apps, grouped by category; **docker compose** (`/compose`) adds the Containers defined in `dcm/src/tools`, with the settings and discovery panels. The mode comes from the URL (`dcm/src/lib/modes.ts`); `?mode=all` and `?mode=self-host` links redirect to the right page, and the selection is shared between the two in the browser. The template pages are docker compose only. A tool whose `id` equals an App's `id` (or an alias in `dcm/src/lib/selfhost.ts`) takes the App's compose, so a Container never competes with its App.

To change an App's compose or metadata in DCM, change the App under `internal/apps/<id>/` and rerun sitegen. Never hand-edit `dcm/src/data/selfhost.json`; CI fails on drift.

## Add or edit a Container

1. Pick the category file in `dcm/src/tools/`. Add a `DockerTool` with a lowercase hyphenated `id`, `composeContent` that starts with `services:` and uses `${PUID}`, `${PGID}`, `${TZ}`, `${CONFIG_PATH}`, `${DATA_PATH}`, `${CONTAINER_PREFIX}` and `${RESTART_POLICY}`, a `githubUrl` when the project has one, and no `stars` (`bun run stars` writes them).
2. If the Catalog already has the App, stop: the App's compose wins, so edit it in `internal/apps/` instead.
3. Cite the upstream image and ports from a current primary source (the project's own docs or registry page).
4. Run the files you touched: `bun test dcm/tests/validate-all-containers.test.ts`, `templates.test.ts`, `validate-networks.test.ts`. `validate-compose.test.ts` runs `docker compose config` and needs Docker, so leave it to CI.
5. Run `bunx turbo run build lint` from the root.

Issues with the `container` label and then `accepted` make `.github/workflows/dcm-add-container.yml` open the pull request into `dcm/src/tools/`.

## The image

`dcm/Dockerfile` packs the built site (`site/dist`, the named build context `site`) into busybox httpd on port 7576. Build and try it locally:

```bash
SELF_HOST_SITE_VERSION=0.0.0 bun run --cwd site build
docker buildx build --load --build-context site=site/dist --build-arg REVISION="$(git rev-parse HEAD)" -t dcm-test -f dcm/Dockerfile .
docker run --rm -p 7576:7576 dcm-test
```

What the image changes and how it is published: `docs/releasing.md` (Docker Compose Maker at /compose).

## Gate

The web gate in `AGENTS.md` applies to every change under `dcm/`. `ci.yml`'s `web` job runs it plus `test:compose`, and its `test` job runs the sitegen drift check.

## Ownership

- `tools/sitegen` owns `dcm/src/data/selfhost.json` and `site/src/data/`; `bun run stars` owns the two `stars.json` files. `dcm/src/tools` owns DCM-only Containers.
- `dcm/bun.lock` does not exist: dependencies go through the root `bun.lock`, installed with `bun install` at the root.
- Release and Pages steps: `docs/releasing.md` (Docker Compose Maker at /compose).
