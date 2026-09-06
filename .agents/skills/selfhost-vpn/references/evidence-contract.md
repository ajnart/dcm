# VPN evidence contract

`plan-vpn.ts` consumes recorded facts; it performs no request, namespace inspection, tunnel break, container operation, or file write. Evidence must be collected from the downloader namespace by an explicitly authorized verification capability.

## Input

```json
{
  "schemaVersion": 1,
  "service": {"id": "qbittorrent", "class": "downloader", "webUiPort": 8080},
  "facts": {
    "observedTopology": {
      "downloaderSharesGatewayNamespace": true,
      "downloaderPublishesPorts": false,
      "webUiPublishedByGateway": true,
      "gatewayHasTun": true,
      "gatewayHasNetAdmin": true,
      "killSwitchEnabled": true,
      "lanAllowlistApplied": true
    }
  },
  "preferences": {
    "mode": "gluetun",
    "gatewayService": "gluetun",
    "scope": ["qbittorrent"],
    "lanControlCidrs": ["192.168.1.0/24"],
    "webUiBind": "127.0.0.1",
    "secretRefs": ["vpn.credentials"],
    "legalContentOnly": true,
    "peerValidationRequested": false
  },
  "evidence": {
    "healthy": {
      "tunnelUp": true,
      "externalIpObserved": true,
      "expectedTunnelEgress": true,
      "dnsResolverObserved": true,
      "dnsUsesTunnel": true
    },
    "tunnelBreak": {
      "performed": true,
      "recordedAt": "2026-08-28T12:00:00Z",
      "tunnelDownObserved": true,
      "downloaderStayedRunning": true,
      "externalRequestFailed": true,
      "dnsRequestFailed": true
    },
    "restored": {"tunnelUp": true, "expectedTunnelEgress": true},
    "routeAudit": {"noDirectDefaultRoute": true, "firewallRestrictsEgress": true}
  }
}
```

Supported modes are `gluetun` and `wireguard`. Mode selection is user-chosen or existing; the planner does not rank providers. `scope` must contain only the named downloader. LAN control CIDRs accept loopback, RFC1918 IPv4, or IPv6 ULA ranges and reject default routes.

Supply secret references as opaque identifiers. Fields named `token`, `password`, `apiKey`, `privateKey`, `credentials`, or other secret-bearing variants are rejected without echoing their contents.

## Verification gate

All of these are required for `network-verified`:

1. Observed topology proves shared gateway namespace, no direct downloader ports, WebUI publication by the gateway, TUN/network administration on the gateway, an enabled kill switch, and the LAN allowlist.
2. Healthy evidence records tunnel egress and tunnel DNS without logging IPs, resolver addresses, or credentials in the planner result.
3. A timestamped tunnel break leaves the downloader running while external IP and DNS requests both fail.
4. Restoration returns expected tunnel egress.
5. Route and firewall audit finds no direct default route and restricted egress.

An observed successful external or DNS request during the break is `conflict` and `verification.state: failed`. Missing or ambiguous evidence is `blocked` and `not-verified`. A timeout counts as pass only when the verifier can distinguish expected fail-closed behavior from its own outage; otherwise record it as ambiguous and remain blocked.

If `peerValidationRequested` is true, also require `evidence.legalPeerTest` with `authorized`, `controlledFixture`, and `observedPeerUsesTunnel` all true. Never select or download copyrighted material as a test fixture.

The verified claim is narrow: downloader egress and kill-switch behavior at `recordedAt`. It does not prove anonymity, provider honesty, application security, legal use, or future configuration.
