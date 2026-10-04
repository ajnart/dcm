# Independent utility migration gate (2026-09-29)

Status: **no support promotion in this slice**. The repository has useful
official install/API evidence for several utilities, but the current app setup
route cannot run a new per-app `setup.ts` without shared CLI wiring. A recipe
would be deployment-only, not first-run/account/API acceptance. No Docker,
browser, or live-service check was run.

## Candidate evidence

| App | What upstream supports | Why it does not pass the current setup gate |
| --- | --- | --- |
| Gatus | [Upstream Compose config](https://github.com/TwiN/gatus/blob/master/.examples/docker-compose/config/config.yaml) shows a small config-driven service; [upstream API example](https://github.com/TwiN/gatus/discussions/451) identifies status endpoints. | No account/API secret to extract. A useful install needs an operator-selected endpoint/config, but the recipe does not generate structured config and the app adapter cannot call the API. A container-ready check alone would not prove a configured monitor. |
| Gotify | [Official Docker guide](https://gotify.net/docs/install) documents persistent `/app/data` and `TZ`; [configuration docs](https://gotify.net/docs/config) document `GOTIFY_DEFAULTUSER_PASS_FILE`; [API docs](https://gotify.net/api-docs) distinguish client and app tokens; [push guide](https://gotify.net/docs/pushmsg) says an app token is returned once at creation. | Strong candidate for the next engine-enabled batch, but it needs private first-admin provisioning plus safe one-time app-token extraction/readback. Schema v2 can model one service with file-backed onboarding; the current app CLI still does not register Gotify's onboarding or token route. |
| ntfy | [Docker install](https://docs.ntfy.sh/install/) says the image has no `/etc/ntfy/server.yml` and requires an operator-created config mount; [auth docs](https://docs.ntfy.sh/config/) show default anonymous read/write, `auth-file`, `deny-all`, provisioned users, and tokens. | Cannot safely publish the anonymous defaults. Current recipes generate random secret files but cannot render the required structured server config or run the `ntfy user/token` CLI after start. A health endpoint would not prove private topic policy or credential extraction. |
| Syncthing | [REST docs](https://docs.syncthing.net/dev/rest.html) define API-key auth and unprotected `/rest/noauth` checks; the [official container Dockerfile](https://github.com/syncthing/syncthing/blob/main/Dockerfile) exposes TCP and UDP ports. | The generic recipe models only one application port, not Syncthing's TCP/UDP sync and UDP discovery ports. It also cannot accept owner-selected shared folders or configure/verify a device sync. A healthy empty node is not file-sync acceptance. |
| Mealie | [Official installation checklist](https://mealie.io/documentation/getting-started/installation/installation-checklist/) currently publishes default credentials and documents versioned images; [backend config](https://mealie.io/documentation/getting-started/installation/backend-config/) includes `TZ`, `BASE_URL`, and default-user metadata. | Existing [Mealie research](mealie.md) remains current: the recipe cannot securely seed/rotate the published default password, and there is no registered first-run login/API-key check. Never deploy with the public default account left active. |
| Stirling PDF | Existing [Stirling research](stirling-pdf.md) records the upstream Docker/security/API contract and outstanding image, private password rotation, API-key, and document-round-trip checks. | No verified private credential bootstrap/extraction path or registered app adapter; its documented health pattern also exceeds the current single-service recipe health contract. |

Gotify and Gatus are the best bounded candidates to revisit after the CLI
adapter seam exists. ntfy and Syncthing additionally need typed config/folder
and network input. Mealie and Stirling stay blocked until their first-account
secrets can be provisioned and proved privately. This is not a claim that the
remaining discovery catalog was audited for install readiness.

## Current shared contract blockers

- `SetupAdapter` has only `status`, generic app-action `read`, and approved app-action `apply`; it has no constrained API/exec transport. `setup-engine.ts` now loads packaged per-app `setup.ts` sidecars dynamically, but the app CLI still lacks a general first-run action and limits single-service `onboard` to Uptime Kuma. Adding a `setup.ts` under another app folder is discoverable, not sufficient for first-run acceptance.
- `account-plan`/`account-prepare` can prepare a private credential file, but they do not create an account, verify login, extract an API token, or prove app function. `handoff` must not imply any of those.
- Recipe schema v1 is single-service and has no environment, private-file, or onboarding fields. V2 has these, but is named/implemented as multi-service. Its onboarding kinds cover manual-first-admin, environment-file-first-admin, and one Immich-specific API-first-admin path; app CLI first-run handlers remain app-ID allowlists.
- The shared-project planner now carries a project-level IANA timezone and a `TZ` host-environment binding. It is not a deployed app route or acceptance evidence. In the app recipe contract, service `user` remains fixed to `image-default`; host UID/GID mapping is limited to `USERMAP_UID`, `USERMAP_GID`, `PUID`, or `PGID`. There is no typed per-service fixed or host-mapped `user` value for apps whose upstream image requires one.
- App recipes originally exposed one primary TCP port. The new `additionalPorts` descriptors can express bounded TCP/UDP publications, but multicast/LAN discovery and narrowly approved host-device integrations remain separate. Do not solve these by broadening to host networking, privileged containers, devices, or Docker socket access.
- Recipes can generate opaque random private files and map supported `*_FILE` variables, but cannot render an owner-reviewed structured config such as Gatus YAML or ntfy `server.yml`, nor accept arbitrary synced-folder paths with overlap/ownership checks.
- The working tree now has a pure shared-project candidate compiler, but the persisted app checkpoints and first-run adapters are still app-ID-specific. The compiler itself does not add/apply a unit, resume an interrupted apply, or prove a service's account/API. See [the shared-project migration gate](../shared-compose-migration.md); do not treat the preview as an install or acceptance path.

Minimum shared work before promoting this cohort:

1. A shared-project planner/state contract with stable project identity and
   service-level ownership/approval/lifecycle, preserving one Compose mutation
   boundary while allowing app-level checks.
2. Typed runtime inputs for per-service user mapping, additional private
   TCP/UDP ports, and per-app config files. Project timezone support is now
   being wired separately. Host integration remains a separate explicit
   capability with device/network inspection and approval; it must not be
   inferred from a recipe.
3. A registered adapter path that can perform narrow, version-pinned local
   API checks and store one-time credentials in owner-only files without
   passing secrets through argv, logs, or reports. Each app still needs its
   own idempotent, interruption-safe implementation and functional/persistence
   acceptance.

## Removed from the Compose app catalog

The following records were removed rather than promoted into application recipes:

- `openmediavault`, `opnsense`, `proxmox-backup-server`, and `synology` were
  catalogued as a NAS OS, firewall/network appliance, Proxmox-targeted backup
  appliance/package, and model/version-dependent NAS appliance respectively.
  They are excluded from this Docker Compose-only product, not deferred to
  another install workflow. `proxmox`, `truenas`, and `unraid` have the same
  host/hypervisor boundary and are excluded too.
- `obsidian` is a desktop/mobile local-vault client; its paid Sync is a separate
  hosted service, not an Obsidian server image. `ical` is the iCalendar format
  and feed surface, not a server product. Anytype is different: self-hosting
  AnySync is possible, but requires a separate multi-component sync network,
  identities, and client reconfiguration; keep it out of the single-app utility
  recipe lane.
- Media/download and infrastructure/platform records remain in their owners'
  lanes rather than this utility batch (including media, download workers,
  hypervisors/NAS, container managers, ingress, DNS, identity, and remote-access
  control planes).

## Repository evidence checked

- `.agents/skills/self-host/workflows/selfhost-setup/GUIDE.md` and
  `selfhost-compose/GUIDE.md` plus their recipe/manifest contracts.
- `catalog/types/setup.ts`, `packages/cli/src/control-panel/setup-engine.ts`,
  and the `app onboard`, account preparation, and project-ID paths in
  `packages/cli/src/app.ts`.
- `catalog/apps/{gatus,gotify,ntfy,syncthing}/manifest.json` and existing
  `product/research/{mealie,stirling-pdf}.md`.
