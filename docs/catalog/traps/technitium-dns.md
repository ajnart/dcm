# Technitium DNS Server traps

## Pitfalls

- A broad DNS feature set increases configuration and recovery scope.
- The shared recipe publishes only the loopback web console. DNS on TCP/UDP 53 requires a separate LAN owner and cutover plan.

## Security

- Separate public authoritative service from private recursion and administration.
