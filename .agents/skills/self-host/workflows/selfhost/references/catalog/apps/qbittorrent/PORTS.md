# qBittorrent WebUI port

The selected private host port also sets the container target and Hotio's
`WEBUI_PORTS` value. Selecting `1340` therefore renders `1340:1340` and
`WEBUI_PORTS=1340/tcp`; the default remains `8080`.

Hotio's runner passes the numeric part of `WEBUI_PORTS` to
`qbittorrent-nox --webui-port`. Keep the published port, container listener,
and bootstrap origin aligned; do not weaken Host/Origin validation or publish
peer-listener ports to accommodate a WebUI choice.

Sources: [Hotio documentation](https://hotio.dev/containers/qbittorrent/),
[Hotio runner](https://github.com/hotio/qbittorrent/blob/release/root/etc/s6-overlay/s6-rc.d/service-qbittorrent/run),
and the repository's dated `product/research/qbittorrent-route-2026-09-29.md`.
This is source-backed configuration, not live image acceptance.
