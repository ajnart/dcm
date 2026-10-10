# Netdata traps

## Pitfalls

- The bounded candidate cannot provide host, sibling-container, Docker, systemd, or network-namespace monitoring.
- The charts.d sleep-timer FIFO in the cache bind is disposable and recreated on startup. Backup omits only that exact FIFO; regular files, unknown special files and unsafe archive paths retain the normal checks.
- The Go CLI removes only the tested image's `orig -> //usr/lib/netdata/conf.d` stock shortcut before the official startup copies configuration. Custom regular files and other links remain intact; unsafe links still prevent backup.
- The official full-host example requires host PID and network namespaces, SYS_PTRACE and SYS_ADMIN, broad read-only host mounts, and a Docker socket mount; it is not represented by this recipe.

## Security

- The bundled candidate uses loopback HTTP, no host mounts or added capabilities, and no Cloud claim. Review any host-observation expansion separately.
