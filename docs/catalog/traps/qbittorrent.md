# qBittorrent traps

## Pitfalls

- The WebUI and peer-listener ports are separate; do not publish peer ports without an explicit choice.
- The Go CLI's `--set qbittorrent.torrent-port=PORT` changes both the peer listener and its TCP/UDP publications; the default remains 6881.
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
- A dashboard hyperlink can get `Unauthorized` before login if it sends a
  different-origin `Referer`, even when the integration works. Open Homarr app
  tiles in a new tab: current Homarr uses `noopener noreferrer` for those links.
  Notebook service links also suppress the referrer. Keep CSRF and Host-header
  validation enabled; verify the actual browser request before changing either.
  qBittorrent 5.2.4 checks the referrer even on `/`; upstream master now exempts
  the static WebUI root from that check. This does not establish which version
  a particular installation runs.

Sources: [hotio image docs](https://hotio.dev/containers/qbittorrent/),
[official WebUI API](https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0)),
[5.2.4 request checks](https://github.com/qbittorrent/qBittorrent/blob/release-5.2.4/src/webui/webapplication.cpp),
[upstream request checks](https://github.com/qbittorrent/qBittorrent/blob/master/src/webui/webapplication.cpp).
