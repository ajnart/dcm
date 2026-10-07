# Stalwart Mail Server traps

## Pitfalls

- Residential IP reputation, blocked outbound ports, and DNS errors can break delivery.
- The first boot exposes only a temporary bootstrap administrator on HTTP port 8080; it does not start mail services until configuration is completed.
- The wizard requires a server hostname and mail domain, writes config.json, and provisions a distinct permanent administrator; the bootstrap password is not the final administrator password. The pinned Bootstrap JMAP handler generates the permanent password and returns it once with the login identity; privately capture that response before another request, and do not replay bootstrap after losing the returned credential.
- Default bootstrap prints its temporary password in container output. A pinned STALWART_RECOVERY_ADMIN avoids generating that temporary password but remains a recovery credential, not the permanent administrator or mail acceptance. Never print startup logs in ordinary setup evidence.
- A production mail deployment needs selected SMTP and client ports, hostname and domain DNS records, working TLS, and external delivery checks; a private loopback WebUI alone is not a mail-server acceptance test.
- STALWART_RECOVERY_ADMIN must be removed after permanent administrator and HTTPS access are verified; leaving it enabled retains a recovery login.
- Community code is AGPL-3.0 licensed; enterprise functionality has a separate owner-issued license. Neither is the server-generated, once-returned management API key, which does not authenticate SMTP or IMAP.

## Security

- Require anti-abuse controls, TLS, DNS authentication, and account recovery.
- An ordinary app approval does not authorize public SMTP/client ports, DNS changes, or a TLS owner. Review the exact hostname, mail domain, listener ports, outbound policy and anti-abuse scope separately before production deployment.
