# Homebridge Docker catalog decision — 2026-09-29

Homebridge remains discovery-only. Do not add `recipe.json` or `setup.ts` under the current shared Compose contract.

## Official facts

- The [Homebridge Docker guide](https://github.com/homebridge/homebridge/wiki/Install-Homebridge-on-Docker) and [image README](https://github.com/homebridge/docker-homebridge/blob/latest/README.md) specify `network_mode: host` as required for HomeKit discovery, a persistent `/homebridge` mount, and a UI on HTTP port 8581. The README also warns that Docker Desktop on macOS and Windows cannot provide the required networking behavior. The upstream example uses `restart: always` and an optional timezone.
- The [2026-09-25 image release](https://github.com/homebridge/docker-homebridge/releases/tag/2026-09-25) reports Homebridge 2.4.0 and UI 5.29.0. The manifest records `docker.io/homebridge/homebridge:2026-09-25`; a tag pin still requires a resolved registry digest at apply time.
- The [Homebridge UI README](https://github.com/homebridge/homebridge-config-ui-x/blob/latest/README.md) states the default username and password are both `admin`. It says the UI can install plugins, edit configuration, view logs, and restart Homebridge. Treat the default as an exposure risk, not as an owner credential.
- The upstream [UI API Reference](https://github.com/homebridge/homebridge-config-ui-x/wiki/API-Reference) does not, by itself, establish a version-pinned, replay-safe first-password rotation and verification flow for UI 5.29.0. No private live instance was used to verify one.

## Exact common-primitive gap

The shared v2 recipe compiler supports private published ports on a managed Compose bridge, not `network_mode: host`. Adding an ordinary recipe with port 8581 would be a misleading UI-only service: HomeKit/mDNS discovery, the application's core function, would not be accepted. Host networking also changes the exposure and collision review from a selected private port to host-wide binding, and must be separately approved and verified.

A safe shared route needs: an explicit host-network recipe primitive with a distinct LAN-exposure approval; preflight for port 8581 and HomeKit/mDNS conflicts; an exact `/homebridge` persistent owner; a pinned first-admin rotation procedure for the bundled UI version that checkpoints before mutation, verifies the generated credential afterward, and refuses ambiguous replay; and LAN HomeKit discovery/pairing plus restart-persistence acceptance. Neither the known `admin/admin` seed nor an HTTP-200 UI response meets that bar. No Docker, UI, or HomeKit live checks were run.
