# Technitium DNS Server traps

## Pitfalls

- A broad DNS feature set increases configuration and recovery scope.
- The shared recipe publishes only the loopback web console. DNS on TCP/UDP 53 requires a separate LAN owner and cutover plan.
- The Go CLI's `--set technitium-dns.dns-port=PORT` changes only the TCP/UDP host publication; container DNS remains on 53. The default remains 53, which ordinary LAN DNS clients expect.

## Security

- Separate public authoritative service from private recursion and administration.
