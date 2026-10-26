# Tailscale traps

## Pitfalls

- A running container or local daemon status does not prove the node is registered and authorized in the intended tailnet. TS_ENABLE_HEALTH_CHECK exposes /healthz, but HTTP 200 proves only that the node has at least one tailnet IP, not intended-client access or ACL enforcement.
- The portless private-connector recipe publishes no host frontend and joins only the shared owner frontend bridge plus its private network. It starts /usr/local/bin/tailscaled directly instead of containerboot, so credential import and Compose apply do not implicitly enroll or activate Serve.
- The pinned containerboot rejects TS_DEST_IP and TS_EXPERIMENTAL_DEST_DNS_NAME when TS_USERSPACE is enabled. These forwarding settings cannot replace a reviewed private Serve configuration without separately approved kernel-network privileges.
- The daemon writes /var/lib/tailscale/tailscaled.state into its owned persistent volume. Enrollment must use a non-ephemeral owner-issued key and a reviewed retention/revocation policy; local node status cannot prove the key's remote policy. Never copy the key payload into a Compose environment file.
- Serve is private while Funnel is public; they are different approval classes. TS_SERVE_CONFIG can configure either, so any imported Serve configuration needs an explicit no-Funnel review and an exact owned upstream target. Upstream requires a directory bind, not an individual file bind, to detect configuration updates.
- An App's node must not take the App's Compose service name as its container `hostname`: Docker maps a container's own hostname in its `/etc/hosts`, so Serve's `http://<service>:<port>` upstream resolves to the node itself and every request gets 502. `TS_HOSTNAME` alone names the node in the tailnet (found on the first real run, #502).
- A reusable private-connector contract must bind the selected same-owner app/service/port, persistent node identity, owner-file enrollment and ACL owner into approval. Reject Funnel, subnet routes, exit-node settings and SSH; verify tailscale status --json and tailscale serve status --json without claiming intended-client access from local status alone.

## Security

- Enrollment requires an owner-supplied auth-key file kept outside catalog data and command arguments. The pinned tailscale up CLI consumes --auth-key=file:/run/secrets/auth-key directly; shared import saves owner-only bytes, while the ordinary recipe starts only a daemon and performs no enrollment.
- Default userspace networking does not route the host or sibling containers. Kernel networking requires separately approved /dev/net/tun and NET_ADMIN; subnet routes, exit-node use, Serve, and public Funnel each need separate review.
