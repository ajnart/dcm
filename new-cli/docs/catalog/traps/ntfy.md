# ntfy traps

## Pitfalls

- Guessable or anonymous topics can leak operational alerts when default access is not deny-all.
- The shared recipe seeds an administrator and creates one non-expiring Homarr token with administrator privileges; separate least-privilege publisher credentials, topic ACLs, and notification delivery are not automated.
- An administrator token grants broad account privileges; ntfy access tokens are not individually scoped to topics.

## Security

- Set auth-file and auth-default-access=deny-all; the documented default is read-write even when authentication is enabled.
- Provision an administrator and separate least-privilege publisher account before enabling notification delivery or public exposure.
