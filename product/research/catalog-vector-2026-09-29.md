# Vector private recipe evidence (2026-09-29)

Vector's official Docker guide lists `ghcr.io/vectordotdev/vector:0.58.0-debian`, mounts `/etc/vector/vector.yaml`, and gives a self-contained example with the API bound to `0.0.0.0:8686`. Its API reference documents unauthenticated `GET /health`: HTTP 200 with `{ "ok": true }` while initialized and serving, and HTTP 503 while draining. The recipe publishes that API only on host loopback and uses only the documented `internal_logs` source and `console` sink. It neither mounts the Docker socket nor reads host logs. The pinned Debian Dockerfile has no `USER` directive, so its image-default process can read the owner-only generated config mount; this is an image-specific fact, not a general permission assumption.

The adapter proves only private Vector readiness. It does not prove application-log ingestion, sensitive-data filtering, remote delivery, or restart persistence. These require an operator-reviewed topology and separate acceptance. No live container was started here.

Sources:

- [Official Docker installation and configuration example](https://vector.dev/docs/setup/installation/platforms/docker/)
- [Observability API and health semantics](https://vector.dev/docs/reference/api/)
- [Internal logs source](https://vector.dev/docs/reference/configuration/sources/internal_logs/)
- [Console sink](https://vector.dev/docs/reference/configuration/sinks/console/)
- [Pinned Debian Dockerfile](https://github.com/vectordotdev/vector/blob/v0.58.0/distribution/docker/debian/Dockerfile)
