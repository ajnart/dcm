# Speedtest Tracker traps

## Pitfalls

- Frequent tests consume bandwidth and can distort application traffic or provider usage limits.
- Setup verifies the seeded administrator without changing its password or role, then uses the installed Laravel Sanctum `User::createToken` method through the owned helper runtime to issue one token with exactly `results:read`. There is no public token-issuance API or supported token CLI. The one-time value is privately captured into `SPEEDTEST_TRACKER_HOMARR_API_KEY`; recorded account/token IDs and exact abilities are checked afresh before reuse. A collision, lost value or ambiguous issuance remains Manual; a persisted pending marker prevents a second token. No raw token/hash/row injection, name-only adoption or automatic rotation is used.
- A valid empty history means internet speed is unknown, not zero. Homarr's connection test rejects the fresh App's latest-result HTTP 404, even though its dashboard reader understands that empty response. Setup and the Link wait as Manual until a completed measurement exists; neither runs or schedules a test. External bandwidth and provider terms require a separately bounded approval.
- The supported native widget is `speedtestTracker`; Homarr 2.4.1 has no shared Stats provider for this App. Read probes verify latest/history/statistics fields and byte-to-bit conversions. See [the source-only compatibility record](../../homarr-speedtest-tracker-source.md) for credential, timestamp and rendered-acceptance gaps.

## Security

- Keep the web UI private, replace the documented default admin login on first start, and treat public IP, ISP, and location metadata as private operational data.
