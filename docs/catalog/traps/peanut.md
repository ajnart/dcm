# PeaNUT traps

## Pitfalls

- The upstream Git tag is `v6.0.0`, but the [published Docker Hub image](https://hub.docker.com/r/brandawg93/peanut/tags?name=6.0.0) is `brandawg93/peanut:6.0.0`; the image tag has no `v` prefix.
- PeaNUT does not provision a NUT server, UPS driver, device, or connection credentials; those require an owner-selected existing installation.
- WEB_USERNAME and WEB_PASSWORD bootstrap the initial browser account. PeaNUT
  6.0.0 also accepts them directly for API Basic authentication before checking
  the stored browser password; an API pass does not verify that browser account
  or rotate its password.
- v6.0.0 defaults auth.yaml outside /config; the shared recipe relies on environment bootstrap only and cannot claim auth-file persistence until the path defect is resolved.
- A green dashboard does not prove load runtime, shutdown sequencing, or recovery after power returns.
- Setup separately verifies the authenticated `6.0.0` information response and
  actual device readings from `GET /api/v1/devices?meta=true`. A NUT error, empty
  device list, unknown status, missing battery charge or ambiguous device names
  leaves a retryable Manual step. Open PeaNUT to connect an owner-selected
  existing NUT server, verify its driver, then retry `self-host setup peanut`
  and `self-host setup homarr`.
- The Project Admin login is reused through helpers; PeaNUT's single-user API
  has no scoped read-only web key. Homarr supports username/password or an
  explicit no-auth instance, but this authenticated Catalog App never disables
  authentication or falls back to no credentials.
- The Homarr descriptor uses native kind `peaNut` at `http://peanut:8080`,
  separate from the browser Address. Its `ups` widget discovers every configured
  UPS with real `peanut.device_id` and `peanut.server` metadata; it has no device
  selector. Names must be globally unique because Homarr's summary ID omits the
  server. No `ups-N` fallback is accepted. Missing voltage remains unavailable,
  not zero.
- Native shared Stats are exactly `devices`, `onBattery` and `lowBattery`;
  low-battery status takes precedence over on-battery status. Verification reads
  `widget.ups.getSummaries` and refreshes authenticated `widget.stats.refresh`,
  checking IDs, status, real readings and non-stale complete counts. It adds no
  control widget and preserves other Apps' shared bindings through the reference
  contract.
- The descriptor awaits reference-owner registry assembly in `targets.go`;
  this lane does not enable the Link. No PeaNUT image digest, Docker/browser
  lifecycle or physical UPS acceptance was exercised. A controlled `dummy-ups`
  source could verify API behavior only, never physical UPS health, capacity or
  shutdown/recovery acceptance. Existing authentication-file persistence remains
  an upstream prerequisite, not a passed runtime claim.

## Source contract

PeaNUT source `73d5a1ee1caa70092f92a159b73ec8f1d688a4dd` (`v6.0.0`);
Homarr 2.4.1 actual-image source
`3d4150e59f600876b7e308f857b2f21572b75348`. The PeaNUT adapter/types, UPS
router/widget and native Stats provider/router are unchanged from the reference
research baseline `ebbd4876d25a51151444a009ab596e1154d62880`; this comparison is
source evidence, not resolved-image or runtime acceptance.

- [PeaNUT API and metadata](https://github.com/Brandawg93/PeaNUT/blob/73d5a1ee1caa70092f92a159b73ec8f1d688a4dd/README.md#api)
- [PeaNUT API authentication](https://github.com/Brandawg93/PeaNUT/blob/73d5a1ee1caa70092f92a159b73ec8f1d688a4dd/src/auth.config.ts)
- [Homarr PeaNUT adapter](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/integrations/src/peanut/peanut-integration.ts)
- [Homarr UPS options](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/widgets/src/ups/index.ts)
- [Homarr native Stats](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/integrations/src/stats/existing.ts)
- [Homarr Link ownership contract](../../homarr-integration-contract.md)
- [NUT read-only monitoring](https://networkupstools.org/docs/man/upsc.html) and [dummy UPS limitations](https://networkupstools.org/docs/man/dummy-ups.html)

## Security

- Keep PeaNUT authenticated and privately reachable; its API exposes UPS commands as well as monitoring.
- Keep NUT control credentials private and separate read-only monitoring from shutdown authority.
