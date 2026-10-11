# Transmission traps

## Pitfalls

- This private recipe does not publish the TCP/UDP peer port or establish a VPN kill switch. Incoming peers and VPN-safe downloading require separately approved work.

## Security

- Keep the authenticated RPC/WebUI bound to loopback; separately approve peer-port publication and downloader VPN routing.

## Homarr contract

- Transmission 4.1.3 (RPC 6.0.1) retains the legacy RPC protocol used by Homarr 2.4.1's `@ctrl/transmission` 7.4.0. Setup probes the authentication challenge, then authenticated `session-get`, `session-stats` and `torrent-get`, negotiating a fresh session ID for each RPC read. It rejects missing fields, unsupported versions, authentication failures and incomplete session negotiation.
- The Homarr descriptor reuses Transmission's own Project Admin login without generating, adopting or rotating credentials. It keeps `http://transmission:9091` separate from the browser Address, and does not change RPC authentication, IP/host whitelists, peer ports or download state. Existing access-policy failures need review and a Setup retry, not an automatic policy bypass.
- Downloads show up to 50 items. Shared Stats use only `download`, `upload` and `paused`: rates are bytes per second summed over all torrents, not session totals or a queue count. Homarr considers an empty queue paused. Explicit empty arrays, zero rates and boolean paused values are valid; absent data, body errors or failed/stale Stats are not.
- Registry assembly belongs to the reference owner. Native API, rendered widget and lifecycle proof remains pending the parent's disposable Project runtime batch; source checks and fake-backed tests are not that proof. No downloads or tracker traffic are part of Setup or Link verification.

Sources:

- [Homarr 2.4.1 Transmission adapter](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/download-client/transmission/transmission-integration.ts)
- [Homarr 2.4.1 Stats metrics](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/stats/existing.ts)
- [Transmission 4.1.3 RPC contract](https://github.com/transmission/transmission/blob/4.1.3/docs/rpc-spec.md)
- [Transmission 4.1.3 RPC authentication and host checks](https://github.com/transmission/transmission/blob/4.1.3/libtransmission/rpc-server.cc)
