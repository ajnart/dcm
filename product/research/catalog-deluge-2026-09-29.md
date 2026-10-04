# Deluge catalog and first-run research

- Checked at: 2026-09-29
- Status: warn — pinned image and API facts are documented; safe shared first-run bootstrap is not proven.
- Browser session: not used; session closed: not applicable.
- Domain allowlist: `docs.linuxserver.io`, `github.com/linuxserver`, `deluge.readthedocs.io`.

## Sources and findings

| Role | Primary source | Finding |
| --- | --- | --- |
| Image publisher | [LinuxServer Deluge image](https://docs.linuxserver.io/images/docker-deluge/) | Its Compose example uses `/config`, `/downloads`, WebUI port 8112, peer TCP/UDP 6881, optional daemon port 58846, PUID/PGID/TZ, and `unless-stopped`. It documents an initial WebUI login and instructs operators to change the password in the UI. No image-specific first-run password environment variable is documented. |
| Image publisher | [LinuxServer 2.2.0-ls381 release](https://github.com/linuxserver/docker-deluge/releases/tag/2.2.0-ls381) | The catalog's fixed image tag has a publisher release record. The tag is a versioned release tag, not an independently verified registry digest. |
| Official upstream | [Deluge 2.2.0 WebUI API](https://deluge.readthedocs.io/en/deluge-2.2.0/modules/deluge.ui.web.html) | `auth.login(password)` yields a session ID or false; `auth.change_password(old_password, new_password)` exists; JSON-RPC is POSTed to `/json`. This supports a possible post-start rotation flow, but does not prove image startup isolation or first-run state. |

All three links were reachable in the public source lookup. No browser profile, authentication, or local host state was used.

## Compose contract and safety

The image publisher's sample is sufficient to identify config/download mounts and distinct WebUI, peer, and optional thin-client ports. It does **not** document a password-file or environment bootstrap for this image. A generated password file in a v2 recipe would therefore not configure Deluge. Starting the documented image before rotating the shared initial password creates a default-password interval on any reachable Compose network, even if the host publication binds to loopback. An adapter that logs in after start cannot eliminate that interval merely by rotating quickly.

The WebUI login is password-based; the daemon's optional thin-client port is a separate surface. Do not publish that port for a WebUI-only plan. Inbound peer ports require their own exposure decision. VPN egress is separate from WebUI authentication: no recipe or rotation proves fail-closed behavior. Claim VPN safety only after the selected network topology survives a recorded tunnel-break test.

## Decision and missing proof

Keep Deluge at guided support and leave `recipe.json` and `setup.ts` absent. A safe v2 shared setup needs a source-proven way to seed a unique WebUI secret **before** either process becomes reachable to peers, or an independently proven isolated bootstrap network with no default-credential access window. Then verify the pinned image's exact JSON-RPC request/session behavior, fresh-profile rotation, replay, and restart persistence. The upstream API documentation alone is insufficient to promote a first-run adapter.

No live image, Docker, browser, test, or VPN check was run. No credentials, rendered Compose values, or raw browser payloads were retained; redaction count: 0.
