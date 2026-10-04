# Gluetun catalog boundary — 2026-09-30

Gluetun remains a guided catalog entry, not a bounded Compose recipe or shared-setup adapter. The upstream repository now redirects to `passteque/gluetun`; its README says the image names remain `qmcgaw/gluetun` and `ghcr.io/qdm12/gluetun`. The official Compose example requires `NET_ADMIN`, `/dev/net/tun`, `VPN_SERVICE_PROVIDER`, `VPN_TYPE`, and protocol-specific private settings. It does not supply a safe universal provider or credentials. [Upstream README](https://github.com/passteque/gluetun#setup)

The current v2 recipe schema cannot represent `cap_add`, `devices`, or `network_mode: service:gluetun`. It also cannot bind a user-selected provider and protocol to a reviewed private credential input. A no-account adapter could observe a local endpoint, but that would not prove provider configuration or the downloader's fail-closed egress. Publishing a recipe under this contract would be misleading; `recipe.json` and `setup.ts` are intentionally absent. See `compose-recipe.schema.json` and `selfhost-vpn/references/topology.md`.

Required future contract before bounded apply:

1. Record the owner-selected provider/protocol and its exact required credential fields as opaque references; resolve payloads only in the owner-only apply boundary, never in catalog JSON, CLI arguments, or reports.
2. Review and approve the gateway's `NET_ADMIN` and `/dev/net/tun`; keep its firewall enabled. Put only the selected downloader in the gateway namespace, with no independent ports or fallback route. Publish its control port only from the gateway on a selected private bind and LAN allowlist. [Upstream Compose example](https://github.com/passteque/gluetun#setup), [Docker Compose `network_mode`](https://docs.docker.com/reference/compose-file/services/#network_mode)
3. Pin a versioned image tag and verify its publisher provenance when an actual recipe is added. The catalog's unpinned image reference is discovery metadata, not a deployable pin.
4. After explicit approval, record observed namespace/firewall topology, tunnel egress and DNS, then break the tunnel **while the downloader stays running**. External IP and DNS requests from that namespace must both fail; restore the tunnel and audit routes/firewall. A timeout without a distinguishable cause is ambiguous. Only a timestamped passing tunnel-break result can support the narrow `network-verified` claim. [VPN evidence contract](../../.agents/skills/self-host/workflows/selfhost-vpn/references/evidence-contract.md), [upstream firewall FAQ](https://github.com/qdm12/gluetun-wiki/blob/main/faq/firewall.md)

No Docker deployment or live privacy test was performed for this catalog-only change.
