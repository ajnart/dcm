# AdGuard Home traps

## Pitfalls

- DNS, DHCP, and bootstrap ports can conflict with host services.
- Setup keeps administration on container port 3000; changing it to the first-run default port 80 breaks the managed Address and Links.
- A first-run page or userless server is not a verified Admin login. Setup and Check require the authenticated profile, running DNS API, query/block statistics and filtering rule counts.
- Existing administrator credentials are never overwritten. If the saved login is explicitly rejected, restore it without replacing DNS settings, then run `self-host setup adguard-home`.
- DNS/API failures after a valid login fail the separate DNS readiness step, not administrator recovery. Read `self-host logs adguard-home`, restore the reported API, then retry `self-host setup adguard-home`; do not recreate the administrator or change upstream DNS to clear that failure.
- An explicitly present `filters: null` or `filters: []` means no subscribed blocking lists and is valid for the App's own Check. Missing or malformed filtering data is not an empty dataset. The native Link allows genuine `null` only after authenticated Homarr reports exactly `2.5.1` or `2.5.2`, whose adapter maps it to zero filtered domains. Homarr `2.4.1`, unreviewed versions and failed version authentication still reject that native path; no response is rewritten or DNS setting changed. Direct Check success does not prove a working native widget.

## Security

- Keep administration private; publishing DNS port 53 and changing LAN or host DNS require a separate owner-approved cutover with fallback DNS.
