# Gluetun Compose boundary — 2026-10-03

Outcome: keep Gluetun guided, without a recipe or setup adapter. The existing
private-file primitives can represent its provider and control credentials;
the ordinary Compose owner cannot represent the required gateway authority or
downloader namespace. No deployment, secret read, tunnel break, or live
acceptance occurred.

Reuses the Gluetun audit in [remote-missing.md](catalog-audits/remote-missing.md).
Context7 resolved `/qdm12/gluetun-wiki` and fetched control-auth/Compose docs.
Official release source was then checked directly because moving documentation
and released authentication behavior differ. GitHub's unauthenticated release
API returned 403; the official [release page](https://github.com/passteque/gluetun/releases/tag/v3.41.3)
identified v3.41.3. No image digest or image execution was verified.

## Pinned upstream facts

- Both the historical v3.40.0 and checked v3.41.3 Compose examples require
  `NET_ADMIN` and `/dev/net/tun:/dev/net/tun`. The image does not declare a
  non-root `USER`; startup configures firewall/routes and creates its internal
  non-root user. Do not force Compose `user: uid:gid`. `PUID`, `PGID`, and `TZ`
  are documented image inputs, not a substitute for network authority.
  Sources: [v3.41.3 README](https://github.com/passteque/gluetun/blob/v3.41.3/README.md),
  [Dockerfile](https://github.com/passteque/gluetun/blob/v3.41.3/Dockerfile),
  [startup](https://github.com/passteque/gluetun/blob/v3.41.3/cmd/gluetun/main.go).
- The official same-project attachment is `network_mode: service:gluetun`.
  Publish downloader control ports on the gateway, not on an independently
  networked downloader. Dashboard, Arr, and other management services remain
  outside the namespace.
  Source: [container attachment](https://github.com/qdm12/gluetun-wiki/blob/main/setup/connect-a-container-to-gluetun.md).
- The image consumes owner-issued provider secrets through documented file
  inputs, including `OPENVPN_USER_SECRETFILE`, `OPENVPN_PASSWORD_SECRETFILE`,
  `WIREGUARD_PRIVATE_KEY_SECRETFILE`, and `WIREGUARD_CONF_SECRETFILE`. Select
  provider/protocol first; never generate provider credentials. Existing
  `fileEnvironment` supports the `*_SECRETFILE` suffix and owner-only imported
  bytes. A selected WireGuard config could use one bounded owner file; a
  two-file OpenVPN account needs its own reviewed onboarding representation.
  Source: [pinned Dockerfile](https://github.com/passteque/gluetun/blob/v3.41.3/Dockerfile).
- Control authentication loads a TOML roles file at
  `/gluetun/auth/config.toml`; an API key is a configured nonempty secret,
  supplied privately through `X-API-Key`. Existing `privateConfigs` can assemble
  a generated base64url key into an explicit read-only role file. No extraction
  endpoint or account creation is needed. Do not use query-string credentials.
  Sources: [v3.40.0 parser](https://github.com/passteque/gluetun/blob/v3.40.0/internal/server/middlewares/auth/configfile.go),
  [key comparison](https://github.com/passteque/gluetun/blob/v3.40.0/internal/server/middlewares/auth/apikey.go),
  [role validation](https://github.com/passteque/gluetun/blob/v3.41.3/internal/server/middlewares/auth/settings.go).
- Important version mismatch: the current wiki states all control routes are
  private by default, but v3.41.3 source still populates public roles, including
  VPN status writes. A nonempty explicit role list replaces that default;
  unassigned routes receive 401. Use a read-only allowlist such as VPN status,
  not global credentials that also enable control writes. Verify anonymous and
  wrong-key denial, saved-key status readback, and denial of writes/settings.
  Sources: [moving wiki](https://github.com/qdm12/gluetun-wiki/blob/main/setup/advanced/control-server.md),
  [released defaults](https://github.com/passteque/gluetun/blob/v3.41.3/internal/server/middlewares/auth/settings.go),
  [released middleware](https://github.com/passteque/gluetun/blob/v3.41.3/internal/server/middlewares/auth/middleware.go).

## No useful restricted mode established

The checked VPN validators accept only OpenVPN or WireGuard and validate a
supported provider. Normal startup enables the firewall before full settings
validation, then configures routing and starts the VPN loop. No supported
VPN-disabled, unprivileged control-only daemon was established. `genkey` and
`healthcheck` are bounded CLI utilities, not the app's gateway function;
disabling the firewall would violate the VPN owner contract.
Sources: [VPN validator](https://github.com/passteque/gluetun/blob/v3.41.3/internal/configuration/settings/vpn.go),
[provider validator](https://github.com/passteque/gluetun/blob/v3.41.3/internal/configuration/settings/provider.go),
[startup](https://github.com/passteque/gluetun/blob/v3.41.3/cmd/gluetun/main.go).

## Smallest common capability proposal — not implemented

Keep the ordinary recipe prohibition intact. Add a separately reviewed typed
`vpn-gateway` grant owned by `selfhost-vpn`, consumed by `selfhost-compose`:

1. Exact gateway and downloader service IDs in one saved Compose owner;
   selected provider/protocol, opaque credential refs, private control binds,
   permitted private CIDRs, and pinned image digest.
2. Only the exact TUN character device and `NET_ADMIN` on the gateway. No
   privileged mode, arbitrary device list, host networking, `SYS_MODULE`,
   Docker socket, or inferred rootful-daemon switch. Host/context compatibility
   must be inspected; unsupported rootless TUN/routing remains blocked.
3. Only a same-owner `service:<gateway>` namespace binding for the selected
   downloader, with independent networks/ports forbidden. Gateway publishes
   the reviewed WebUI port. Namespace changes and privilege grants are explicit
   effects bound into a separate approval digest, not catalog defaults.
4. Keep firewall/kill switch enabled and review narrow control routing; do not
   turn `FIREWALL_OUTBOUND_SUBNETS` into a guessed broad fallback route.

Current blockers are explicit in the recipe schema and
`selfhost-compose/scripts/compose-project.ts` (`FORBIDDEN_KEYS` rejects devices,
capabilities, and network mode). Secret representation is not the reason to
bypass that guard. A schema field alone is insufficient: inspection, approval,
deterministic compilation, replay, selected lifecycle, and verification all
need the same grant contract.

Control login is separate from gateway acceptance. Before support promotion,
record downloader namespace/route ownership, healthy tunnel egress and DNS,
a deliberate tunnel break while the downloader remains running, failed
external and DNS requests, and restoration. The VPN owner's
`references/evidence-contract.md` already defines these required observations.
Homarr status access remains a separate read-only integration claim, not
proof of downloader privacy.

## Validation boundary

Source audit and focused manifest JSON parse/diff check only. No new runtime
implementation or tests: current primitives cannot safely deploy this gateway.
Fresh setup, replay, restart, Homarr delivery, and fail-closed acceptance remain
unverified.
