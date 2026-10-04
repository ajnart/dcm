# HAProxy catalog review — 2026-09-30

## Decision

Keep HAProxy at discovery support. The official `haproxy:3.2.23` image is pinned in the manifest, but do not add a shared Compose recipe or first-run adapter yet. No backend target was supplied, and an inert private health endpoint alone would not prove proxy functionality.

## Primary evidence

- [Docker Official Image](https://hub.docker.com/_/haproxy) lists `3.2.23` and says the image has no default configuration. It documents mounting a configuration under `/usr/local/etc/haproxy`.
- [Official image Dockerfile](https://github.com/docker-library/haproxy/blob/master/3.2/Dockerfile) uses `USER haproxy` (UID 99) and starts with `/usr/local/etc/haproxy/haproxy.cfg`.
- [HAProxy 3.2 configuration manual](https://docs.haproxy.org/3.2/configuration.html) documents `monitor-uri` and HTTP return actions, which could support a private readiness endpoint. Neither establishes an actual backend route or its acceptance.
- The local [catalog contract](../../.agents/skills/self-host/workflows/selfhost/references/catalog.md) writes generated configuration as owner-only mode `0600` and specifically requires proof that the documented image user can read it. The current recipe schema has no generated-file permission or ownership field. Under the default non-root image user, that file cannot be read.

## Exact gap

A usable private proxy recipe needs a selected target, listener/port, and route acceptance; public exposure additionally needs separate DNS/TLS/80/443/auth approval. The current generated-file mount cannot deliver a readable `haproxy.cfg` to UID 99. Running the image as root or embedding configuration in a command just to bypass this contract would weaken the boundary. After a source-backed config delivery mechanism and selected backend exist, add a private-only recipe, validate its syntax and HTTP route, and implement a setup adapter that verifies the backend response rather than only process liveness. Reload and certificate lifecycle remain separate decisions.

No Docker or live HAProxy check was run.
