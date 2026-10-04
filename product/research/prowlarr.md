# Prowlarr standalone candidate (2026-09-29)

Status: private, experimental one-service installer proved on one fresh rootless
Docker project; **not** a configured indexer service. The existing media-harness
bootstrap supplied the key-read/API pattern, but its wrapper also wires
Sonarr/Radarr and was not reused unchanged.

| Contract | Source and reusable asset | Required proof |
| --- | --- | --- |
| One service, `/config`, port 9696, `PUID`/`PGID` | [LinuxServer image guide](https://docs.linuxserver.io/images/docker-prowlarr/) | Pin a version tag and resolve its platform digest; prove owner-only project storage and scoped restart. |
| Fresh API key comes from the app's private `config.xml` | `scripts/lib/session-context.ts` reads it in the media harness; [upstream config provider](https://github.com/Prowlarr/Prowlarr/blob/develop/src/NzbDrone.Core/Configuration/ConfigFileProvider.cs) | Read only the owned container's config, keep the key out of logs, save a private reference, and verify an authenticated API call. |
| API-based login configuration | [Current Prowlarr OpenAPI](https://raw.githubusercontent.com/Prowlarr/Prowlarr/develop/src/Prowlarr.Api.V1/openapi.json) | Fetch `/api/v1/config/host`, update the returned **ID** at `PUT /api/v1/config/host/{id}`, then read back; the older harness's PUT without an ID is not portable evidence. |
| Form login | [Current OpenAPI](https://raw.githubusercontent.com/Prowlarr/Prowlarr/develop/src/Prowlarr.Api.V1/openapi.json) declares `POST /login` multipart fields `username`, `password`, and optional `rememberMe`; [controller](https://github.com/Prowlarr/Prowlarr/blob/develop/src/Prowlarr.Http/Authentication/AuthenticationController.cs) sets the cookie | Verify the session cookie with a protected request; a redirect alone can also mean login failure. |
| Homarr supports `prowlarr` | `catalog/homarr-integrations.json` | Prove a private bridge, integration, widget data, and readback separately from a bookmark tile. |

The new recipe pins `lscr.io/linuxserver/prowlarr:version-2.6.5.5623` and
resolves its immutable Linux/amd64 digest at plan time. It uses an owned Docker
volume for `/config`, avoiding the old bind-only engine's rootless UID mismatch.
On `/tmp/selfhost-prowlarr-live-20260929-keAndI`, the generated admin and API
key were saved as distinct owner-1000, mode-0600, single-link files. The first
auth call reached an attempted checkpoint; its login proof initially rejected
Prowlarr's absolute same-origin redirect. After a strict redirect-parser fix,
the same checkpoint verified Forms login and API-key access without re-sending
the host-settings PUT. A repeat returned `mutation:false`; scoped stop/start
preserved the login and key, and another repeat returned `mutation:false`.
A read-only `app login-check` after restart also reverified the current admin
and API access; the picker uses this instead of trusting a saved timestamp.
Container health is unverified because this recipe has no upstream-provided
Compose healthcheck.

Indexer selection, credentials, legality, downstream app sync, functional
search, Homarr integration/widget, and rendered UI are separate gates. A
successful first administrator proves none of those. The existing
`scripts/setup-prowlarr.ts` remains canonical for the seven-app media harness.
