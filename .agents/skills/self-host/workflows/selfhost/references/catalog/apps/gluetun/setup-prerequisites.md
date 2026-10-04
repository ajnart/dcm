# Gluetun shared profile

The derived recipe selects `qmcgaw/gluetun:v3.41.3`, an explicit `protonvpn`
or `purevpn` provider, `openvpn`, and one provider-supported server country.
WireGuard, custom providers, proxies and downloader namespace changes are not
part of this profile. A tag pin is not registry digest verification.

The reviewed runtime-resource boundary must approve `NET_ADMIN` and the exact
character device `/dev/net/tun:/dev/net/tun:rwm` before startup. It rejects
unsupported local daemon/device conditions. This is not unrestricted privilege
or permission to alter another Compose owner.

Import the provider's actual OpenVPN username and password as two owner-issued
mode-0600 files (`provider-user`, `provider-password`). For ProtonVPN these are
its OpenVPN-specific credentials, not the web account login. The documented
`OPENVPN_USER_SECRETFILE` and `OPENVPN_PASSWORD_SECRETFILE` variables reference
the imported copies under `/run/secrets/`; the provider payload is not generated
or placed in Compose environment values. Resume verifies the saved private files.

Existing `privateConfigs` prepares a mode-0600 TOML configuration from a generated
32-byte hex `control-api-key`. The official image starts as root and can read
that private file. `HTTP_CONTROL_SERVER_AUTH_CONFIG_FILEPATH` points to its
read-only secret mount. The explicit read-only role replaces the pinned public
default roles; only status, public-IP and port-forward reads are allowed. Control
is published on loopback port 8000, with no UI or invented administrator account.

Headless setup rejects anonymous status access, verifies `X-API-Key` and requires
the documented VPN status to be `running`. It saves the same verified key through
the private handoff boundary. Ready means authenticated running VPN control only,
not provider entitlement, actual downloader IP/DNS egress, namespace attachment,
write-authorization verification, deliberate tunnel-break fail-closed evidence,
or restart persistence. No live Docker or VPN acceptance was performed here.

Sources: [pinned Compose requirements](https://github.com/passteque/gluetun/blob/v3.41.3/README.md),
[pinned role defaults](https://github.com/passteque/gluetun/blob/v3.41.3/internal/server/middlewares/auth/settings.go),
[pinned route checks](https://github.com/passteque/gluetun/blob/v3.41.3/internal/server/middlewares/auth/middleware.go),
[control API](https://github.com/qdm12/gluetun-wiki/blob/main/setup/advanced/control-server.md),
[provider secret files](https://github.com/qdm12/gluetun-wiki/blob/main/setup/advanced/docker-secrets.md),
[ProtonVPN](https://github.com/qdm12/gluetun-wiki/blob/main/setup/providers/protonvpn.md),
[PureVPN](https://github.com/qdm12/gluetun-wiki/blob/main/setup/providers/purevpn.md).
