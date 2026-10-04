# SearXNG install-contract candidate (2026-09-29)

Status: promising self-hosted search app, but **not installable through the
current bounded recipe**. Keep discovery-only until a small private-config
generation contract is implemented and proved on a fresh instance.

- The [official GHCR package](https://github.com/searxng/searxng/pkgs/container/searxng) lists `2026.9.25-12f8b6515` and a multi-platform index `sha256:5286edb35782454ab8a102c5eff6b54bff745853191b46aeead95f225aa6dfb6` for amd64/arm64 at review; re-resolve platform digests before apply.
- [Official Docker guidance](https://docs.searxng.org/admin/installation-docker) and [Compose example](https://github.com/searxng/searxng/blob/master/container/docker-compose.yml) use the app on port 8080, persistent `/etc/searxng` settings and `/var/cache/searxng` cache, plus Valkey `/data`. There is no first-admin account or password.
- [Server settings](https://docs.searxng.org/admin/settings/settings_server.html) require replacing the example secret with a generated private `SEARXNG_SECRET`. The current recipe/runtime can make random private files for `_FILE` environment variables but cannot render a generated owner-only `settings.yml` or inject that value safely. Guessing this from the route name is not enough.
- An official container install documents an HTTP HEAD 200 as a narrow transport check; do not promote an undocumented `/healthz` to Compose health. The [search API](https://docs.searxng.org/dev/search_api) can prove function via `/search?q=...&format=json` only if [JSON is enabled in settings](https://docs.searxng.org/admin/settings/settings_search.html), and results depend on external engines.
- The [limiter](https://docs.searxng.org/admin/searx.limiter.html) needs Valkey and correct client-IP handling through a proxy. Keep loopback/private by default and do not claim a production public search route from a local HTTP probe.
- [Homarr's integration catalog](https://homarr.dev/docs/category/integrations/) does not list SearXNG here; a bookmark tile is possible, but no native integration/widget is claimed.

Candidate next step: add a narrowly scoped, checked private-config template
capability to the shared engine, then a two-service SearXNG recipe and one
script-only readiness/function adapter. Verify on a fresh isolated instance
before changing the installable count.
