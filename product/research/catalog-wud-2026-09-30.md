# WUD shared Compose review — 2026-09-30

Decision: no `recipe.json` or `setup.ts` yet. The missing Docker API boundary is a deployment blocker, not merely a first-run verification gap.

The pinned catalog image is `getwud/wud:9.1.0`. WUD's [9.x authentication documentation](https://getwud.app/docs/configuration/authentications/) specifies `WUD_AUTH_ADMIN_USER` and `WUD_AUTH_ADMIN_PASSWORD` for a database-backed bootstrap administrator. This appears compatible with the existing generated `secretEnvironment` and `initial-admin-from-secret-env` recipe primitives, but a setup adapter would still need a pinned, documented authenticated read and anonymous-denial check. Do not infer a login or token route from the UI.

WUD's [9.x watcher documentation](https://getwud.app/docs/configuration/watchers/) says an unconfigured watcher defaults to `/var/run/docker.sock`. It supports remote TCP/TLS watchers, but those examples do not confer least-privilege Docker authorization. The local examples mount the socket `:ro`; that only limits filesystem writes to the socket inode, not requests sent through it. [Docker's daemon guidance](https://docs.docker.com/reference/cli/dockerd/) warns that socket or TCP access can give host-root control. A loopback UI with no watcher would not monitor updates, so its HTTP readiness cannot count as app acceptance.

An owned Docker API bridge or explicitly approved remote endpoint must be designed before publishing a recipe. It needs an allowlist of exact read operations WUD uses, denial of mutation endpoints, scoped network reachability, credential handling, lifecycle ownership, and proof against the pinned WUD version. The existing Compose recipe model has no reviewed bridge service or narrow socket-permission contract. Do not add a direct socket mount, unprotected TCP daemon, or proxy image on assumption. Separately verify monitored inventory, an update-detection fixture, authenticated and anonymous UI/API behavior, and exact-project restart. Automatic update triggers stay disabled unless separately approved.

No Docker run, browser run, recipe, setup adapter, or live acceptance is claimed.
