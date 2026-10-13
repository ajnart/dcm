# Glances traps

## Pitfalls

- Metrics are only what Glances can observe from its container. CPU, memory and uptime can describe the backing kernel (a Linux VM on Docker Desktop), while network and filesystem data follow the container's visibility. This is not verified physical-host monitoring.
- The documented password-file bootstrap is interactive and cannot be represented by the current shared secret inputs.
- Setup checks Glances 4.5.6, API v4 and actual resource data; a successful `/api/4/status` is not sufficient because this route remains public when authentication is enabled. Retry with `self-host setup glances` after repairing the version or required plugins.
- Homarr 2.4.1's native Glances adapter supports only the explicit empty credential alternative. An authenticated Glances API remains authenticated and leaves a retryable Manual step; do not disable authentication to make the Link pass.
- Missing sensors, GPU or SMART data do not establish zero temperatures or healthy disks. No device access or privileged mounts are added. See [the Glances Link source contract](../../homarr-glances-proof.md) for supported widgets and outstanding runtime proof.
- Homarr's Health Monitoring information modal shows fixed package-update/reboot placeholders for Glances. They are not verified package or reboot health results.

## Security

- Keep the Web UI and API private; unauthenticated API responses may expose process command lines.
- Treat host PID visibility and the Docker socket as separate explicit privilege decisions.
