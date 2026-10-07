# ZeroTier traps

## Pitfalls

- Virtual LAN reachability can expose services beyond their host bind assumptions.
- A successful join or running container is not network acceptance. Verify listnetworks reports OK and an assigned address after controller authorization, then test peer reachability.
- Persist /var/lib/zerotier-one across upgrades to preserve node identity; keep identity.secret and authtoken.secret private.
- The userspace libzt sockets SDK requires application integration and is not a drop-in unprivileged network sidecar for arbitrary shared services. The localhost service API token and the owner's Central authorization token are separate credentials.
- The recipe creates no networks and joins none. Native identity and controller API readback is bootstrap readiness only; controller choice, network creation, membership authorization, assigned addresses and peer routes remain pending.
- The owner-volume retains identity and controller data. Resume requires the same saved token and node identity; unknown or changed ownership must be inspected, not reset. UPnP/NAT-PMP mapping and in-container software updates are disabled.

## Security

- Review network membership, routes, and controller ownership before joining; a network ID alone does not authorize a node.
- The pinned official image needs NET_ADMIN and /dev/net/tun through the source-bound tun-net-admin approval. It uses its own bridge namespace, not host networking, and does not grant host or sibling-service routing.
- The native management token is generated once into the owner-private file and supplied through the documented ZEROTIER_API_SECRET environment. Docker operators can inspect this token; it is not a local admin password or a Central API credential.
