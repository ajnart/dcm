# Tdarr traps

## Pitfalls

- A bad transcode policy can replace source media; test on copies and preserve recoverable originals.
- On Tdarr 3.x the seededApiKey setting also creates a user `admin` whose password is that key, so first-run registration is closed (403). Setup signs in as that user with the key and either resets its password to the Admin password (Admin username `admin`) or registers a second administrator and sets its password. On 2.x there is no seeded user and Setup registers the first admin. The owned API key is saved before insertion.
- The internal node registers 20-40 seconds after the server answers; Check waits up to two minutes for it before treating zero nodes as a problem.
- Port 8266 is the server/API listener and is not published by the shared recipe; only the web UI is mapped to loopback.
- The internal node starts with zero configured workers; approve library write behavior and test on copies before enabling transcoding.

- The native widget and shared Stats are separate cached samples. The SDK collects one advancing Stats refresh; the leaf validates count units, integral nonnegative values and the existing clock bounds without requiring their counts to equal the native cache. [Source normalization](../../homarr-tdarr-source.md) remains separate from runtime acceptance.

## Security

- Limit worker access to owner-selected libraries and approve GPU or device access explicitly.
- With a non-`admin` Admin username the seeded `admin` user stays, with the API key as its password; Tdarr cannot disable it. On 2.x, keep the first-user setup screen private: auth=true does not pre-create an administrator or close registration.
