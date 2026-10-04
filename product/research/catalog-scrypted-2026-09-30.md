# Scrypted catalog boundary (2026-09-30)

Status: discovery only. The catalog identifies the upstream image, but does not offer a Compose recipe, shared setup adapter, or managed first-run claim.

## Primary-source findings

- [Official Linux Docker instructions](https://docs.scrypted.app/install/linux-docker.html) install a service through a downloaded script, identify `ghcr.io/koush/scrypted` as the default image, and call external NVR storage optional. The image is named but not version-pinned there.
- [Official installation overview](https://docs.scrypted.app/installation.html) says Scrypted requires Docker host networking; Proxmox is preferred partly because a dedicated IP avoids host port conflicts. A private loopback-published bridge recipe would not be equivalent.
- The [upstream Compose file](https://github.com/koush/scrypted/blob/main/install/docker/docker-compose.yml) mounts persistent data at `/server/volume` and uses `network_mode: host`. NVR storage, USB/GPU devices, and Avahi integration are optional host-specific changes. It also includes Watchtower with Docker socket access and update authority. These are not silently inherited into this catalog.
- [Lost-password guidance](https://docs.scrypted.app/maintenance/lost-password.html) describes resetting users through a `reset-login` file, then creating a new administrator in the login page. It does not establish a supported first-admin HTTP route or an API authentication probe.
- [Users and remote-access guidance](https://docs.scrypted.app/maintenance/access.html) distinguishes local accounts from cloud login; a cloud email is not a local administrator credential.

## Exact implementation gap

The v2 Compose recipe schema has private published ports but no host-network mode. Its `onboarding` contracts require an administrator flow that can be verified by a deterministic adapter. The current official sources do not establish a version-pinned image or supported first-admin/password/API route. Therefore a recipe or `setup.ts` would advertise a deployable, headless path that cannot yet be supported. The manifest remains `discovery`, with no `cliSetup` or adapter.

To promote this app, first add an explicit host-network approval/preflight model (including port ownership and exposure), verify an immutable image digest, and prove a first-admin creation plus credential readback against a fresh instance. Camera discovery, NVR recording/storage, GPU passthrough, and restart persistence require separate acceptance; a running container or reachable UI is not proof of them. No host or Docker checks were run for this catalog research.
