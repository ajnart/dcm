# PeaNUT traps

## Pitfalls

- The upstream Git tag is `v6.0.0`, but the [published Docker Hub image](https://hub.docker.com/r/brandawg93/peanut/tags?name=6.0.0) is `brandawg93/peanut:6.0.0`; the image tag has no `v` prefix.
- PeaNUT does not provision a NUT server, UPS driver, device, or connection credentials; those require an owner-selected existing installation.
- WEB_USERNAME and WEB_PASSWORD create the initial account only; changing them later does not rotate the stored password.
- v6.0.0 defaults auth.yaml outside /config; the shared recipe relies on environment bootstrap only and cannot claim auth-file persistence until the path defect is resolved.
- A green dashboard does not prove load runtime, shutdown sequencing, or recovery after power returns.

## Security

- Keep PeaNUT authenticated and privately reachable; its API exposes UPS commands as well as monitoring.
- Keep NUT control credentials private and separate read-only monitoring from shutdown authority.
