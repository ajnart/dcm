# AdGuard Home traps

## Pitfalls

- DNS, DHCP, and bootstrap ports can conflict with host services.
- Setup keeps administration on container port 3000; changing it to the first-run default port 80 breaks the managed Address and Links.
- A first-run page or userless server is not a verified Admin login. Setup checks the authenticated profile and running DNS API; Check also requires query/block statistics and filtering rule counts.
- Existing administrator credentials are never overwritten. Restore the saved Admin login without replacing DNS settings, then run `self-host setup adguard-home`.

## Security

- Keep administration private; publishing DNS port 53 and changing LAN or host DNS require a separate owner-approved cutover with fallback DNS.
