# Downloader VPN topology

Use one gateway namespace for one or more explicitly chosen downloaders. Keep every control-plane and media-serving service on its ordinary private network.

```text
Arr / Seerr / media server / reverse proxy -- normal private network
                           |
                           | private WebUI control path
                           v
VPN gateway (Gluetun or WireGuard) -- TUN + strict firewall -- tunnel egress
                           ^
                           |
downloader/qBittorrent -- network namespace: service:<gateway>
```

## Namespace contract

- Set the downloader network namespace to the gateway service. The downloader has no independent network attachment, `ports`, or fallback default route.
- Publish the downloader WebUI port from the gateway service. Bind it to loopback or a specific private interface; restrict source traffic to the selected private CIDRs.
- Keep Arr and request applications outside the namespace. They reach the WebUI through the gateway service name and private port, never a container IP.
- Give the gateway `/dev/net/tun` and the narrow network-administration capability its implementation requires. The downloader does not inherit host networking or extra capabilities.
- Keep firewall and kill-switch behavior enabled. Allow only tunnel establishment, tunnel DNS, chosen LAN control CIDRs, and the required VPN egress.
- Treat WireGuard `AllowedIPs` as routing policy. A tunnel handshake alone does not prove downloader traffic uses the tunnel.

## Secret boundary

Represent VPN account data, WireGuard private keys, preshared keys, tunnel tokens, and forwarded-port state only as opaque secret references. The apply adapter resolves them into a private secret mechanism. Plans may state the required purpose and reference identifier; evidence may state configured or missing. Neither carries a payload.

## Provider neutrality

Accept a provider already chosen by the user or compare providers using disclosed technical criteria such as protocol support, port-forwarding behavior, region availability, client compatibility, terms, and price. Keep affiliate links and payments out of machine-readable defaults and rankings. A provider claim never replaces the fail-closed evidence contract.

## Primary references

- [Gluetun project](https://github.com/qdm12/gluetun)
- [Gluetun firewall FAQ](https://github.com/qdm12/gluetun-wiki/blob/main/faq/firewall.md)
- [WireGuard quick start](https://www.wireguard.com/quickstart/)
- [Docker Compose network mode](https://docs.docker.com/reference/compose-file/services/#network_mode)
