# WUD catalog assessment — 2026-09-29

Decision: retain guided catalog support; do not add `recipe.json` or `setup.ts` yet.

The current upstream is `getwud/wud`, with 9.x documentation and an official Docker Hub image. Its [quick start](https://getwud.app/docs/quickstart/) publishes port 3000, configures an admin login, and mounts `/var/run/docker.sock`. The [watcher documentation](https://getwud.app/docs/configuration/watchers/) says a local Docker watcher is created by default against that socket. The examples also show remote TCP/TLS watchers, but do not provide a least-privilege local Docker API proxy contract. A `:ro` socket mount is not a read-only Docker API permission boundary: it restricts filesystem writes to the socket path, not Docker API operations. [Docker's daemon guidance](https://docs.docker.com/reference/cli/dockerd/) warns that socket access can grant host-root control.

The [REST API documentation](https://getwud.app/docs/api/reference/wud-rest-api/) says authentication is optional by default and the API can trigger actions, including updates. A loopback-bound, no-account HTTP endpoint could be probed, but without a Docker watcher it would not prove the requested image monitoring works. Calling that a ready setup would misstate acceptance. Adding the direct socket to make it work would violate this repository's no-casual-socket-mount invariant.

Before a shared Compose candidate can ship, define and review an owned, narrowly scoped Docker API bridge or a bounded remote TLS watcher, including exact allowed API operations, credentials, network isolation, and lifecycle ownership. Then verify the watcher lists only the intended containers, detects an update without invoking a trigger, and survives a restart. Keep any automatic update trigger disabled unless separately approved. The app's web UI should remain private and authenticated when reachable beyond the host.

No recipe, setup adapter, Docker run, or live acceptance is claimed here.
