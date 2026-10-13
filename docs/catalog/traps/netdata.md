# Netdata traps

## Pitfalls

- The bounded candidate does not provide comprehensive host, sibling-container, Docker, systemd, or network-namespace monitoring. Container-visible kernel counters may describe the shared Linux kernel or Docker virtual machine, not this computer or only the Netdata container.
- Setup and Check require explicit local alarm counts and a fresh sample from the discovered agent CPU chart. Missing charts, empty samples and denied API access are not zero usage. The CPU probe measures Netdata's own process, not the whole computer.
- Homarr 2.4.1 supports Netdata through shared Stats entries `warnings` and `criticals`, using `/api/v1/info` with an explicit empty credential array. It does not support Netdata in System Resources, Health Monitoring or a dedicated widget. No machine identifier, chart identifier or Cloud claim is needed for Stats.
- Existing bearer protection or denied API access stays intact. Retry `self-host setup netdata` after reviewing compatible local access; this Homarr adapter cannot supply a Netdata credential. Retry `self-host setup homarr` after Netdata is ready. Its Link forces a fresh Stats query and rejects missing counts, refresh errors and stale results; explicit zero active alarms is valid.
- The charts.d sleep-timer FIFO in the cache bind is disposable and recreated on startup. Backup omits only that exact FIFO; regular files, unknown special files and unsafe archive paths retain the normal checks.
- The Go CLI removes only the tested image's `orig -> //usr/lib/netdata/conf.d` stock shortcut before the official startup copies configuration. Custom regular files and other links remain intact; unsafe links still prevent backup.
- The official full-host example requires host PID and network namespaces, SYS_PTRACE and SYS_ADMIN, broad read-only host mounts, and a Docker socket mount; it is not represented by this recipe.

## Security

- The bundled candidate uses local HTTP under the Project's existing Access, no host mounts or added capabilities, and no Cloud claim. Review any host-observation expansion separately.
