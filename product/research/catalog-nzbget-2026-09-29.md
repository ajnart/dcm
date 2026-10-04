# NZBGet shared-Compose candidate (2026-09-29)

The maintained [upstream Docker image](https://github.com/nzbgetcom/nzbget/blob/develop/docker/README.md) documents versioned `v*` tags, `/config`, optional `/downloads`, port 6789, `PUID`/`PGID`/`TZ`, and `NZBGET_USER`/`NZBGET_PASS`. [v26.3](https://github.com/nzbgetcom/nzbget/releases/tag/v26.3) is the stable release inspected here. The recipe pins its image and binds the selected shared media-data path to `/downloads`; no Usenet provider or content is chosen automatically.

The image documents `NZBGET_PASS` as a plain environment variable, not a `*_FILE` variable. The new shared-Compose `secretEnvironment` primitive can generate a random password in an owner-only file and write a mode-0600 private environment file before container start, avoiding the [published default credential](https://nzbget.com/documentation/what-is-the-default-nzbget-password/). As with any process environment secret, the Docker daemon and authorized container inspectors remain within the trust boundary.

The recipe uses `initial-admin-from-secret-env` to bind the generated `admin-password` to `NZBGET_PASS` before startup, with `NZBGET_USER=admin`. This is distinct from an upstream `*_FILE` variable or a manually changed post-start password.

The [official RPC reference](https://nzbget.com/documentation/api/) specifies `/jsonrpc` and HTTP Basic authentication with username/password pairs, not an API key. Its [`version()` method](https://nzbget.com/documentation/api/version/) returns a version string. The adapter makes only that authenticated RPC read with the generated password and requires the pinned version; the common transport requires approval for a POST even when it is read-only. It saves no API key.

Fresh-instance behavior, provider connection, actual downloads, path readback, restart persistence, and Homarr integration still need independent checks. No Docker or live-instance check was performed here; guided support is unchanged.
