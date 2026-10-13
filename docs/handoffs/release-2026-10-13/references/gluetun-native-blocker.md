## Blocked native Link

Blocks #279 and draft #327. Source inspection of Homarr 2.4.1 (`ebbd4876d25a51151444a009ab596e1154d62880`) and the Catalog's Gluetun 3.41.3 shows that native VPN and Stats summaries cannot currently use the existing least-privilege control credential safely.

`GluetunIntegration.getSummaryAsync` always requests VPN status, DNS status, public IP and `GET /v1/vpn/settings`. Gluetun's settings handler JSON-encodes a full copied VPN configuration; its OpenVPN and WireGuard types expose credential/private-key fields. Homarr's settings schema also requires those fields, although the displayed summary only uses protocol/provider. This is an unnecessary provider-secret read boundary, not evidence that secrets were rendered or leaked.

The current Project control role grants only `GET /v1/vpn/status`, `GET /v1/publicip/ip` and `GET /v1/portforward`. It correctly denies DNS/settings reads. Broadening it to the credential-bearing settings route is not an approved fix. Homarr also requires eight public-IP string fields, while Gluetun can omit empty metadata or clear it when disconnected.

The staged descriptor deliberately blocks before any native summary call. No runtime, provider connection, real credentials or functional acceptance was used to establish this finding.

## Acceptance

- Provide a first-party credential-free summary route or an audited supported Homarr adapter/version that uses only necessary non-secret data. Preserve the supported-version and exact credential-shape gates from #262.
- Native `status`/`publicIp` Stats must not require provider credentials or fabricated metadata. Treat stopped/unready tunnels, missing optional metadata, authentication errors and malformed responses distinctly.
- Preserve the current control grants, firewall and Compose authority. Do not add a credential-scrubbing proxy, disable TLS/authentication, purchase a provider account or discover a user's provider secrets without a separately approved design.
- Before registering `gluetunTarget()`, record exact versions/digests and prove useful authenticated native/rendered data plus rerun, credential recovery and removal preserving unrelated resources in an approved disposable Project.
- Keep #279/#327 blocked until that proof exists; a navigation tile, successful connection test or fake fixture is not acceptance.

## Sources

- [Pinned Homarr adapter](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/gluetun/gluetun-integration.ts)
- [Pinned Homarr schema](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/gluetun/gluetun-types.ts)
- [Gluetun settings handler](https://github.com/qdm12/gluetun/blob/v3.41.3/internal/server/vpn.go)
- [Copied settings state](https://github.com/qdm12/gluetun/blob/v3.41.3/internal/vpn/state/vpn.go)
- [OpenVPN JSON fields](https://github.com/qdm12/gluetun/blob/v3.41.3/internal/configuration/settings/openvpn.go)
- [WireGuard JSON fields](https://github.com/qdm12/gluetun/blob/v3.41.3/internal/configuration/settings/wireguard.go)
- [Gluetun public-IP fields](https://github.com/qdm12/gluetun/blob/v3.41.3/internal/models/publicip.go)

Local source/gate notes: `docs/homarr-gluetun-contract.md` on draft #327 at `7d70c832c426eb1485ef8f072d461a621cfcabb1`.
