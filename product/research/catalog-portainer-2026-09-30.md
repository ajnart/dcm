# Portainer CE shared-recipe assessment — 2026-09-30

Decision: **do not add a shared Compose recipe or setup adapter yet**. Keep Portainer at discovery support. A UI-only container would not meet the container-management goal, while connecting it to the host Docker Engine crosses a host-wide authority boundary that the current recipe/apply route cannot safely establish or constrain.

## Official deployment and onboarding facts

- Portainer's official Linux Compose example uses `portainer/portainer-ce:sts`, persistent `/data`, HTTPS UI port 9443, optional Edge tunnel port 8000, and a bind mount of `/var/run/docker.sock`. `sts` is a moving channel tag, not a pinned release. The shared recipe would need a fixed release tag and an apply-time digest resolution before deployment. [Portainer Linux installation](https://docs.portainer.io/start/install-ce/server/docker/linux)
- Portainer documents `--admin-password-file` for first creation of `admin`; it is ineffective for later password changes. For fresh CE 2.39.4+ / 2.43+ instances, this pre-seeding suppresses the otherwise required one-time setup token. A generated private file mounted for that flag is a plausible deterministic first-admin mechanism, followed by authenticated readback. [CLI options](https://docs.portainer.io/advanced/cli), [setup token FAQ](https://docs.portainer.io/faqs/installing/setup-token)
- The documented API also has `POST /api/users/admin/init`, `POST /api/auth`, and `POST /api/endpoints`; the endpoint example can connect a remote Docker daemon with TLS and CA/client certificate files. The admin-init example alone does not establish an environment or prove Docker access. [Portainer environment API](https://docs.portainer.io/admin/environments/add/api), [API examples](https://docs.portainer.io/api/examples)
- `/api/auth` returns a short-lived JWT, not an API key. Portainer documents access tokens as per-user, permission-equivalent to that user, generated after re-entering the password, and shown only once. Its public access guide gives a UI creation flow and `X-API-Key` usage, but not a complete version-pinned headless creation/replay contract. An adapter must not claim an API key from the JWT or blindly retry a lost create response. [API access](https://docs.portainer.io/api/access)

## Blocking authority gap

- Docker states that control of the daemon, including possession of a TLS client key, can grant root access to the Docker host. A read-only socket bind is not a read-only Docker API. Therefore the official socket-mounted Compose example is not an acceptable default for this shared route. [Docker daemon socket security](https://docs.docker.com/engine/security/protect-access/)
- A TLS Docker API connection is supported upstream, but requires a separately approved, authenticated daemon listener, CA/server/client certificate lifecycle, private delivery of the client key, network restriction, and endpoint verification. The current Compose recipe schema describes app services, files generated from random bytes, and app-data mounts; it cannot provision or validate that external host daemon boundary or import an existing client certificate/key as scoped secret references. The scoped app engine owns one Compose project, not the Docker daemon configuration. [Portainer environment API](https://docs.portainer.io/admin/environments/add/api), [Docker daemon socket security](https://docs.docker.com/engine/security/protect-access/)
- A Docker API proxy cannot make Portainer a working *container manager* without permitting powerful create/update/delete operations. Merely filtering to a few read endpoints would produce a misleading UI-only deployment; any broader proxy policy needs a separate threat model and explicit privilege approval.

## Required before promotion

1. Define and implement an independently reviewed `docker-api-boundary` capability with explicit host-wide privilege approval and credential ownership. It must refuse an unauthenticated or public daemon and avoid a direct host-socket mount in the Portainer recipe.
2. Add an engine contract for referencing approved, externally provisioned TLS client material without logging it or treating it as ordinary generated random files. Verify peer identity and environment access after onboarding.
3. Pin an exact CE release, then add a focused recipe and first-admin adapter using a private `--admin-password-file`; handle replay, existing-admin state, and a connected-environment acceptance check. An HTTP 200 or successful login alone is insufficient.

No Docker, network daemon, or live Portainer deployment was changed for this assessment.
