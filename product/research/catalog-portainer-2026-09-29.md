# Portainer CE catalog decision — 2026-09-29

Portainer stays **discovery-only**. There is no `recipe.json` or `setup.ts` yet. This is an intentional privilege boundary, not missing Compose syntax.

## Official contract

- [Portainer's Linux Compose installation](https://docs.portainer.io/start/install-ce/server/docker/linux) uses `portainer/portainer-ce:sts`, a persistent `/data` volume, HTTPS UI on 9443, optional Edge tunnel on 8000, and a bind mount of `/var/run/docker.sock`. Portainer uses a self-signed certificate by default. The floating `sts` tag is not a version pin.
- [Initial setup](https://docs.portainer.io/start/install-ce/server/setup) creates an administrator with a password of at least 12 characters, then connects an environment. A first account or HTTP response is not proof that an environment is connected.
- [The setup-token FAQ](https://docs.portainer.io/faqs/installing/setup-token) says fresh CE 2.39.4+ instances require a one-time token from server logs, with a five-minute first-account window. The documented `--admin-password-file` startup option pre-seeds the administrator password and avoids the token; `--no-setup-token` weakens the first-claim gate and is not acceptable as a default.
- [Portainer's API examples](https://docs.portainer.io/api/examples) document `POST /api/users/admin/init` and `POST /api/auth`. The latter returns a JWT. These routes do not establish Docker-environment ownership or an API key.
- [API access documentation](https://docs.portainer.io/api/access) says keys are per-user, inherit that user's permissions, require password re-entry during creation, and are visible only once. Calls use `X-API-Key`. The [release notes](https://docs.portainer.io/release-notes) mention `POST /users/{id}/tokens` and `rawAPIKey`, but the currently available user guide does not give a complete version-pinned request/replay contract for headless key creation.
- [Docker's daemon-socket guidance](https://docs.docker.com/engine/security/protect-access/) says client TLS keys can give root-level instructions to the Docker host. A socket mount or authenticated remote Docker API is therefore a separate host-wide privilege grant, not ordinary app storage or a private-port choice.

## Exact recipe and adapter gap

The current shared recipe can describe a socket `hostPath` mount, but that would silently make the Portainer container a Docker administrator when the generic shared approval only covers the Compose project. The safe alternative—an explicitly selected, mutually authenticated Docker API boundary—needs a separate privilege approval, endpoint/certificate provisioning and secret delivery, ownership checks, and a way to verify the connected environment without granting unowned project mutation. None exists in this app's bounded adapter contract today. Do not publish `recipe.json` just to start an inert Portainer UI or mount the socket by default.

A future deterministic setup may use the official `--admin-password-file` option with a generated mode-0600 credential, but must pin and verify an image version, prove first-admin login, create and privately save the one-time API key without blind retries after an ambiguous response, verify the selected Docker environment and restart persistence, and keep the Docker privilege gate separate from ordinary apply. A JWT from `/api/auth` is not an API key. No live Portainer instance, Docker environment, or first-run behavior was tested here.
