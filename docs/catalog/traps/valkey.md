# Valkey traps

## Pitfalls

- Do not assume Redis and Valkey versions are interchangeable for every application.
- The official image has no documented generated-password-file bootstrap; unauthenticated PING or container liveness does not prove safe peer access or a secure deployment.

## Security

- Keep TCP port 6379 loopback-only on the host and restrict the shared Compose network to trusted applications. The no-account recipe has no authentication; require separately reviewed ACL or requirepass configuration before any untrusted peer or broader exposure.
