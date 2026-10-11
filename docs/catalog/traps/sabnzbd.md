# SABnzbd traps

## Pitfalls

- Provider access and retention are external operational dependencies.
- Setup leaves a missing enabled Usenet provider as a retryable Manual step. Add your own authorized provider in Config > Servers, then retry `self-host setup sabnzbd`; Setup does not create or test provider accounts.
- A first-run wizard is not API failure: readiness uses the version API, then verifies authenticated queue/history. Explicit empty arrays and zero download rate are valid.
- Setup saves the existing full API key as `SABNZBD_API_KEY` through the Project secret boundary. The NZB upload-only key cannot read queue/history. Retry Setup to recover a missing saved key without rotation.
- The source-verified Homarr 2.4.1/SABnzbd 5.1.3 contract and pending runtime acceptance are recorded in [the SABnzbd Link contract](../../homarr-sabnzbd-contract.md).
- Select completed and incomplete paths with the Arr import layout; differing paths or filesystems can prevent hardlinks or atomic moves.

## Security

- Treat provider credentials, server configuration, and the SABnzbd API key as secrets.
- Keep its WebUI private; the API key is accepted as a query parameter by the upstream API.
