# Transmission shared recipe evidence (2026-09-29)

The LinuxServer image documents the `USER`/`PASS` authentication pair, `FILE__` file-backed environment convention, `PUID`/`PGID`/`TZ`, `/config`, `/downloads`, WebUI/RPC port 9091, and separate TCP/UDP peer port 51413. Its published tag list includes `version-4.1.3-r0`. The recipe pins that tag, supplies `FILE__PASS` from a generated private file, binds only 9091 to loopback, and requires the owner to choose the writable downloads bind. It deliberately does **not** publish 51413 or establish a VPN route.

Transmission's RPC specification documents Basic authentication, `/transmission/rpc`, HTTP 409 with `X-Transmission-Session-Id` for CSRF, and JSON-RPC 2.0 `session_get`. The adapter rejects unauthenticated access, retries one authenticated session read after the CSRF challenge, checks the response and pinned version, and never stores or prints the password or Authorization header. Transmission does not provide a separate API key here; its RPC credential is the administrator username/password.

Sources:

- https://docs.linuxserver.io/images/docker-transmission/
- https://hub.docker.com/r/linuxserver/transmission/tags
- https://github.com/linuxserver/docker-transmission/blob/master/root/etc/s6-overlay/s6-rc.d/init-transmission-config/run
- https://github.com/transmission/transmission/blob/main/docs/rpc-spec.md

Limits: image/runtime behavior, bind ownership, actual download path, restart persistence, peer reachability, VPN fail-closed behavior, and Homarr integration have not been live-verified. Peer-port publication and VPN egress each need their own review and approval; do not treat loopback RPC success as download acceptance.
