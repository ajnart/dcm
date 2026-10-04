# Dashdot shared setup recheck — 2026-09-30

Decision: do not publish a v2 recipe or `setup.ts` yet. This is a source-only decision; no Docker or live endpoint was run.

The [official Compose example](https://getdashdot.com/docs/installation/docker-compose) runs `mauricenino/dashdot:latest` on container port 3001 with `privileged: true` and a read-only bind of host `/` to `/mnt/host`. The catalog currently pins `mauricenino/dashdot:6.3.4`. The v2 shared recipe cannot express privileged mode, and selected host-path validation rejects `/`. A recipe omitting these requirements would not represent the documented host-monitoring deployment. Both privileges and host-root visibility require explicit approval beyond ordinary app apply.

The [official API documentation](https://getdashdot.com/docs/integration/api) names read-only `/info`, `/config`, and `/load/{cpu,storage,ram,network,gpu}` routes, not a health route. A future no-account adapter could probe `/info` on an exact private origin after an approved deployment, but HTTP 200 would prove only API reachability, not accurate host metrics. The official docs do not establish an administrator account or API-key bootstrap, so neither should be invented.

Fresh source recheck found the same boundary in the [current official Compose page](https://getdashdot.com/docs/installation/docker-compose): its host-monitoring service still requires both `privileged: true` and `/:/mnt/host:ro`. Since this recipe format cannot express the privilege grant or accept `/` as a selected host path, publishing a reduced recipe and marking its `/info` response ready would misrepresent host monitoring. The missing recipe capability and separate privilege/host-visibility approval must be resolved before a shared adapter is useful.
