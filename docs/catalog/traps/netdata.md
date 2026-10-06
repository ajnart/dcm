# Netdata traps

## Pitfalls

- The bounded candidate cannot provide host, sibling-container, Docker, systemd, or network-namespace monitoring.
- The official full-host example requires host PID and network namespaces, SYS_PTRACE and SYS_ADMIN, broad read-only host mounts, and a Docker socket mount; it is not represented by this recipe.

## Security

- The bundled candidate uses loopback HTTP, no host mounts or added capabilities, and no Cloud claim. Review any host-observation expansion separately.
