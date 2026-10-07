# Gluetun traps

## Pitfalls

- Gluetun's image healthcheck and firewall kill switch do not independently prove fail-closed downloader egress; verify the shared namespace and deliberate tunnel-break behavior.
- The derived shared recipe consumes only the source-bound tun-net-admin runtime-resource profile, requiring its exact privilege approval and inspected local character device. It does not attach a downloader namespace or grant generic capabilities/devices.
- The pinned release defaults several control routes, including VPN status writes, to unauthenticated access when no roles are configured. Existing privateConfigs prepares an explicit read-only generated-key TOML role at /run/secrets/control-auth and HTTP_CONTROL_SERVER_AUTH_CONFIG_FILEPATH selects it, replacing the permissive defaults.
- The checked v3.41.3 release source retains permissive public control roles despite the current wiki describing private-by-default routes. Pin and verify the actual image behavior; do not infer authentication policy from the moving wiki.
- The checked v3.40.0 and v3.41.3 VPN validators accept only OpenVPN or WireGuard with a supported provider. No documented VPN-disabled control-only mode was established; disabling the firewall or running only genkey/healthcheck is not a useful downloader VPN deployment.
- Provider secret files use documented *_SECRETFILE variables, including OPENVPN_USER_SECRETFILE, OPENVPN_PASSWORD_SECRETFILE, and WIREGUARD_CONF_SECRETFILE. The owner must select provider and protocol; generated control credentials are not VPN provider credentials.
- Control bootstrap acceptance must reject an unauthenticated status request, authenticate the saved read-only credential, and read VPN status. This proves control access only; downloader wiring and tunnel-break privacy acceptance remain separate.
- The app-local derived-recipe.ts and discovered setup.ts consume control.ts directly. Setup readiness means only anonymous denial, saved read-only key acceptance and running VPN status; it does not claim write-policy tests, downloader IP/DNS privacy, tunnel-break or restart evidence.
- Only explicit protonvpn or purevpn provider selections with openvpn and one server-country are supported by this shared profile. Import the provider's issued OpenVPN username and password as separate mode-0600 files; ProtonVPN web-account credentials are not its OpenVPN credentials. Other providers and WireGuard remain separate reviewed profiles.
- Provider and protocol requirements differ; do not embed OPENVPN_USER, OPENVPN_PASSWORD, WIREGUARD_PRIVATE_KEY, or equivalent secret payloads in catalog environment fields.

## Security

- Select a supported VPN provider and OpenVPN or WireGuard protocol before apply; provider-specific credentials and WireGuard private keys stay at the private apply boundary.
- Approve NET_ADMIN and /dev/net/tun explicitly; keep Gluetun's firewall enabled, attach only the downloader to its network namespace, and publish the downloader WebUI only on a private gateway bind.
- Require a recorded tunnel-break test showing downloader external IP and DNS requests fail while the downloader remains running, followed by tunnel restoration.
- Homarr's native Gluetun integration is separate from gateway acceptance. Use an explicit read-only control role and saved private API key; do not select the integration's unauthenticated alternative or expose VPN control writes.
