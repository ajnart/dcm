# Speedtest Tracker catalog research — 2026-09-29

## Official installation contract

- The [upstream Compose guide](https://docs.speedtest-tracker.dev/getting-started/installation/using-docker-compose) recommends Compose, says SQLite is adequate for most installations, and uses the LinuxServer image with `/config` persistence, container HTTP port 80, `PUID`, `PGID`, `APP_KEY`, `APP_URL`, and `DB_CONNECTION=sqlite`.
- The [LinuxServer image release](https://github.com/linuxserver/docker-speedtest-tracker/releases/tag/v1.14.7-ls165) identifies a fixed `v1.14.7-ls165` image tag. The [image documentation](https://docs.linuxserver.io/images/docker-speedtest-tracker/) documents `/config`, port 80, `FILE__` environment-from-file support, and a browser-visible default admin login.
- The [upstream environment reference](https://docs.speedtest-tracker.dev/getting-started/environment-variables) calls `APP_KEY` and `APP_URL` required. `ADMIN_EMAIL` and `ADMIN_PASSWORD` are supported only at initial setup. The [authentication guide](https://docs.speedtest-tracker.dev/security/authentication) documents the default account and profile-page password change. A fresh deployment must never leave the default password in place.

## Shared recipe boundary

The shared compiler now supports `base64-prefixed` private files and a loopback-origin-derived environment value. The current v2 recipe uses those primitives for `FILE__APP_KEY` and `APP_URL`, respectively. It binds a generated `ADMIN_PASSWORD` through an owner-only secret environment file, sets `ADMIN_EMAIL=admin@example.test`, keeps `PUBLIC_DASHBOARD=false`, and persists SQLite in a project-owned `/config` volume. This is an inspectable candidate, not a proven first-run deployment.

The recipe uses the selected host `PUID`/`PGID` and loopback HTTP port publication. No automatic speedtest schedule or external test mutation should be inferred from container start.

## First-run and API boundary

There is no documented first-admin creation HTTP endpoint. The documented first-run route is `ADMIN_EMAIL`/`ADMIN_PASSWORD` environment seeding. The [API authorization guide](https://docs.speedtest-tracker.dev/api/authorization) directs administrators to `/admin/api-tokens` in the UI. The [upstream OpenAPI document](https://raw.githubusercontent.com/alexjustesen/speedtest-tracker/1.x/openapi.json) documents results, stats, and speedtest endpoints, not token creation or account mutation. No supported, pinned headless login readback or token-creation/extraction contract was established. Thus `setup.ts` remains absent: shared setup must report pending, not claim verified credentials or an API key. Do not guess Filament/Livewire routes or silently retain the default account. Manual login and token creation remain acceptance gates.

## Unverified acceptance

No Docker deployment, first-run login, token creation, scheduled test, result readback, or restart-persistence check was run. The image tag is source-identified, not registry digest-verified. The existing Homarr integration label remains an independent catalog claim, not evidence that this image or an API token works.
