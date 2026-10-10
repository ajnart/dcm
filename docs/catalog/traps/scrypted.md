# Scrypted traps

## Pitfalls

- The shared recipe is a minimal bridge-only administrator bootstrap, not an equivalent full camera deployment. The upstream Compose comments describe bridge networking; HomeKit requires separately approved mDNS/Avahi integration, and camera reachability must be verified directly.
- The upstream example includes a Watchtower service with Docker socket access and unpinned default images; it is not a safe drop-in project recipe.
- Pinned source implements first administrator creation through POST /login and durable user-token readback through authenticated GET /login. The latter can consume a reset-login marker and erase users; the adapter checks its absence and treats the request as an approved effect. Do not create that marker concurrently.
- Login and durable-token identity are read back, but the first owner's administrator role is inferred from pinned creation source, not independently verified through an ACL-only endpoint. Camera streams, HomeKit discovery, GPU acceleration, licensed NVR recording, backup restore and restart persistence remain separate. Fresh-image and replay acceptance are unverified.

## Security

- The bootstrap publishes only the insecure HTTP management listener on loopback. Do not expose it remotely without separately reviewed HTTPS ingress; protect administrator tokens and camera credentials.
- Approve NVR storage, GPU or USB device passthrough, mDNS/Avahi access, and automatic update authority separately; none are implied by this catalog record.
