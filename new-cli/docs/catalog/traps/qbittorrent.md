# qBittorrent traps

## Pitfalls

- The WebUI and peer-listener ports are separate; do not publish peer ports without an explicit choice.
- VPN status alone does not prove a working kill switch.

## Security

- Keep the WebUI private and separately approve downloader VPN routing.
- Verify the selected image's first-run credential mechanism before automating login; do not assume another publisher's temporary-password log format.

## From docs/qbittorrent.md

### Traps

- The temporary password rotates whenever fresh config is created.
- A fresh qBittorrent instance always uses `admin` for the temporary login;
  bootstrap changes the username only after that login succeeds.
- qBittorrent rejects mismatched WebUI/Host-header ports. The session harness
  keeps `WEBUI_PORT`, `WEBUI_PORTS`, published port, and downstream port equal.
- API requests must send a matching `Origin` or `Referer`; preserve the exact
  run host and port when verifying `/api/v2`.
- qBittorrent 5.2.3 names its cookie `QBT_SID_<port>` in this setup. Capture and
  replay the actual cookie name instead of assuming the historical `SID` name.
- qBittorrent uses username/password here, not an API key.

Sources: [hotio image docs](https://hotio.dev/containers/qbittorrent/),
[official WebUI API](https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0)).
