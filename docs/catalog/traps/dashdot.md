# Dash. traps

## Pitfalls

- The shared profile intentionally provides only kernel-visible CPU/RAM. Native Linux Docker normally exposes kernel-wide /proc counters; Docker VM or virtualized /proc can expose another scope. CPU and memory limits bound Dashdot, not the reported counters. Independently compare scope before claiming physical-host metrics.
- Widget selection alone is insufficient: pinned LazyObservable starts every collector when background collection is enabled. The recipe disables background collection and Docker-specific namespace setup explicitly.
- The adapter validates configured scope and nonempty complete CPU/RAM data, not host identity, freshness, disks/network, Homarr widgets or restart persistence. Full host observation still needs separate source-bound authority and acceptance; no privilege bypass is published.

## Security

- The shared CPU/RAM profile grants no capabilities, namespace access or host mounts and uses a read-only root filesystem. The upstream full-host Compose grants privileged mode and host-root visibility; do not infer those grants from ordinary app approval.
- Keep the unauthenticated dashboard on a private interface and review whether host inventory is appropriate for its viewers.
