# Dashdot shared-project recipe decision

- Checked: 2026-09-30
- Decision: blocked; do not publish `recipe.json` or `setup.ts`

## Upstream contract

The [official Compose example](https://getdashdot.com/docs/installation/docker-compose) uses `mauricenino/dashdot:latest`, `privileged: true`, container port 3001, and a read-only bind of host `/` to `/mnt/host`. [Release v6.3.4](https://github.com/MauriceNino/dashdot/releases/tag/v6.3.4) is marked latest; the catalog pins that version's tag, but no image digest or live runtime behavior was verified. The [official API page](https://getdashdot.com/docs/integration/api) documents `/info`, `/config`, and `/load/{cpu,storage,ram,network,gpu}`. It does not make a successful HTTP response proof of accurate host visibility.

## Exact shared-Compose gaps

The v2 recipe schema has no `privileged` service field, and the multi-service compiler cannot emit it. Its selected-host-path validation explicitly rejects `/`. Consequently the official host-monitoring topology cannot be represented, even with a read-only mount and a loopback-only published port. Omitting either requirement would make a recipe's host-metrics claim misleading. The required privilege and host-root access also need a distinct, explicit approval gate; a normal shared-app approval must not silently grant them.

Dashdot remains guided. No recipe or no-account adapter was added. If the deployment contract and approval gate are extended in their owning modules, a later adapter could use the documented private API for deterministic read-only probing. It must distinguish service/API readiness from fresh, accurate host metrics and must not invent an administrator, API key, or health endpoint.

No Docker, browser, endpoint, fresh-instance, or restart verification was performed. No credentials or browser state were used.
