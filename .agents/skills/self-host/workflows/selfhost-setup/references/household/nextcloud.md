# Nextcloud household setup recipe

Use this recipe only after `selfhost-host` has supplied current host facts and
the user has approved the exact project, storage, port, and private access
plan. Facts were checked against the official Nextcloud Docker image and
administration documentation on 2026-09-21. Resolve supported versions again at
apply time.

## Plan

1. Resolve the current supported Nextcloud release and its compatible database
   release from the official system requirements. Record the source revision,
   exact image tags, and image digests. Do not approve `nextcloud`, `alpine`,
   `lts`, or `latest` as unresolved tags.
2. Plan the Apache application image, PostgreSQL or MariaDB, Redis, and a cron
   worker sharing the application storage. Publish only the application port 80
   on the approved loopback or private address. Keep database and Redis
   internal. Persist `/var/www/html` and the database; use the same application
   mounts for the cron worker. Set Nextcloud's background-job mode to cron after
   installation.
3. Use exactly one database family and its complete variable group. The manifest
   builder supplies the explicitly chosen non-secret `NEXTCLOUD_ADMIN_USER`,
   plus `NEXTCLOUD_ADMIN_PASSWORD_FILE` and `POSTGRES_PASSWORD_FILE` only for a
   new installation. The official root entrypoint reads these files before it
   runs installation as `www-data`; this does not prove arbitrary UID 33
   processes can read mode-0600 host secrets. Redis remains unauthenticated only
   on the isolated internal network, so no runtime Redis secret file is needed.
4. Ask for a Nextcloud admin username only when no previously approved household
   username exists. Reuse that username if it meets Nextcloud's form rules.
   Nextcloud does not require an email for automatic first installation; ask for
   one only when the user chooses mail, notifications, password recovery, or a
   profile email. Never invent an email from a username.

## Manifest builder

`bun scripts/nextcloud-plan.ts --input /absolute/nextcloud-input.json` builds the
four-service manifest and passes it through `selfhost-compose` validation. The
input must provide the exact project and observed facts, pinned Nextcloud,
PostgreSQL 17, and Redis image references with official evidence URLs, owned
HTML and explicitly local database paths, two local secret-file references below the project
`secrets/` directory, the selected admin username, private bind and port, the
approved HTTPS origin, exact trusted proxy IPs or narrow CIDRs, and
`http://nextcloud:80` as Homarr's internal URL.

The result uses the Apache app, PostgreSQL, isolated Redis, and a `/cron.sh`
worker. App and cron share `/var/www/html` through one explicit same-project
read-write share group. Only the app joins the existing Homarr network and
publishes port 80 on the selected private host address. Database, Redis, and
cron remain on the internal project network. The cron worker receives the
non-secret `REDIS_HOST=redis` setting because it bypasses the app entrypoint and
the official Redis configuration reads that environment value at runtime.
`image-default` is recorded with
official upstream evidence because these images perform their supported init
and privilege-drop behavior before the steady-state process.

The approved origin supplies `NEXTCLOUD_TRUSTED_DOMAINS`, `OVERWRITEHOST`,
`OVERWRITEPROTOCOL=https`, and `OVERWRITECLIURL`. Homarr's internal host is an
additional trusted domain. `TRUSTED_PROXIES` contains only the explicitly
approved proxy addresses; accepted CIDRs are `/24` or narrower for IPv4 and
`/64` or narrower for IPv6. Never add a whole private range. These are planned settings and still require live reverse-proxy and
generated-URL checks.

## Apply and resume

1. Apply only through the selected owner after exact approval. For a fresh data
   volume, the official image can create the first admin automatically when the
   complete database group and both admin variables are present before first
   start. `_FILE` is the preferred secret boundary.
2. On resume, run `php /var/www/html/occ status --output=json_pretty` as `www-data` inside the app
   container. Continue only when `installed` is true, `maintenance` is false,
   and `needsDbUpgrade` is false. Run `occ setupchecks` and record its findings
   separately. If installed is true, do not change first-install variables in
   an attempt to rename or reset the administrator.
3. Verify browser login using the intended admin and its private URL. Configure
   trusted domains and reverse-proxy values only from the approved ingress plan.
   Set `occ background:cron`, then prove that the cron worker executes against
   the same application storage.

## Homarr and acceptance

1. Add one app tile with the user-reachable private URL and one integration with
   Homarr's container-reachable URL.
2. Homarr's Nextcloud integration requires a username and password. Use the
   selected Nextcloud username plus a dedicated Nextcloud app password. An
   ordinary account password may work without 2FA, but the app password keeps
   Homarr revocable and remains required when 2FA is enabled. Transfer it
   directly into Homarr's secret field and retain only its opaque reference.
3. Acceptance requires: `occ status` in normal operation; browser login;
   successful upload and retrieval of a small authorized test file; a passing
   Homarr integration test; and an authenticated calendar or notification query.
   An empty calendar is acceptable only when the query succeeds without an
   authentication or DAV error. A tile, container health, or HTTP 200 alone is
   insufficient.
4. Resume a partial Homarr step by checking for an existing exact integration
   before creating one. If the app password value is unavailable, revoke that
   token in Nextcloud and create one replacement through the private handoff;
   never print or recover it from configuration output.

## Official sources

- <https://github.com/nextcloud/docker/blob/master/README.md>
- <https://docs.nextcloud.com/server/latest/admin_manual/occ_system.html>
- <https://docs.nextcloud.com/server/latest/admin_manual/configuration_server/caching_configuration.html>
- <https://docs.nextcloud.com/server/stable/admin_manual/configuration_server/reverse_proxy_configuration.html>
- <https://docs.nextcloud.com/server/stable/admin_manual/configuration_user/authentication.html#app-passwords>
- Homarr source: `apps/docs/docs/integrations/nextcloud/index.mdx`,
  `packages/definitions/src/integration.ts`, and
  `packages/integrations/src/nextcloud/nextcloud.integration.ts` in the deployed
  Homarr revision.
