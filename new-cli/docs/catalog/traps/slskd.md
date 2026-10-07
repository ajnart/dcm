# Slskd traps

## Pitfalls

- Only share or download content the operator is authorized to distribute or retain.
- A loopback-only port 50300 does not make the daemon reachable to Soulseek peers; peer ingress needs a separate network approval.
- The Soulseek protocol account requires operator-supplied credentials; Web UI credentials do not create that account.

## Security

- Set a generated Web UI password and primary API key before first start; never retain the documented slskd/slskd defaults.
- Keep the Web UI private. API keys sent over plain HTTP can be intercepted; use a trusted HTTPS route for remote clients.
- Review shared folders and the Soulseek listen port separately from Web UI access.
