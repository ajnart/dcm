# Deluge traps

## Pitfalls

- Daemon, Web UI, peer ports, and plugin behavior must be planned separately.
- The image documents no first-start password environment variable, and post-start RPC rotation leaves a default-password window on a shared Compose network.

## Security

- Keep the Web UI and daemon control port private and protect their authentication.
- The documented initial WebUI password is shared; change and verify it before granting access or joining untrusted services to its network.
- Do not advertise VPN-safe downloader egress without a recorded tunnel-break fail-closed test.
