# Aria2 traps

## Pitfalls

- An exposed RPC listener can permit arbitrary downloads and filesystem writes within its process authority.
- aria2c listens only on loopback by default; a container RPC listener needs an explicit reachability decision and separate private host binding.
- aria2 has no username account; its RPC token is the control credential, not an administrator password.
- The third-party image's publisher startup passes RPC_HASH in argv and logs a generated secret; do not use it unchanged or bypass the shared recipe's secret boundary.
- The publisher Dockerfile uses root, but aria2 RPC on port 6800 needs no privileged mode, Docker socket, host networking, or host-root mount. A non-root override still needs pinned image and writable-storage evidence.
- Authenticated aria2.getVersion is a read-only control-token check; system.listMethods is allowed without a token and cannot prove authentication. Downloads, session persistence, and VPN safety need separate acceptance.
- Setup also verifies authenticated aria2.getGlobalStat, aria2.tellActive, aria2.tellWaiting and aria2.tellStopped. Zero transfer rates and empty queue arrays are valid data, not a failed Setup.
- Missing or rejected RPC credentials do not select unauthenticated mode. Restore the saved token and private configuration with `self-host install aria2 --yes`, then run `self-host start aria2` and `self-host setup aria2`.

## Security

- Keep JSON-RPC on a private route and require --rpc-secret before enabling remote control.
- Keep the RPC token out of process arguments, logs, Compose manifests, and ordinary reports.
- The RPC token has daemon-control authority; aria2 does not provide a separate read-only token scope. Verification uses only read-only methods.
