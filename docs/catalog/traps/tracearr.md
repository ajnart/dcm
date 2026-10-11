# Tracearr traps

## Pitfalls

- Auxiliary Compose services use App-owned names: `tracearr-timescale`, `tracearr-redis`. Keep these names in connection settings and dependencies; persistent data paths stay unchanged.
- Session analytics are not a replacement for service readiness or host monitoring.
- The standard image requires TimescaleDB, not plain PostgreSQL, and a secret-bearing DATABASE_URL.
- The current official pg18 Compose example calls PostgreSQL 18 experimental and new-install-only; never reuse an existing data volume with it.
- The bundled local-owner adapter requires a reviewed email, refuses an existing uncheckpointed owner or claim-code setup, and never repeats an uncertain signup or API-key rotation.
- Owner and API-key setup does not enroll a media server, fetch media, configure notifications, or prove Homarr integration or restart persistence.

## Security

- Treat session history, user identities, IP data, and media-server API access as sensitive.

## Homarr Link slice (#302)

Tracearr Setup prepares its public-API key only when Homarr is installed or a
managed key checkpoint already exists. Installing Homarr later requires retrying
`self-host setup tracearr`, then `self-host setup homarr`. No unused API key is
created for a standalone Tracearr App.

Tracearr 2.6.0 exposes one owner key, not scoped/dedicated read-only keys. It is
less privileged than the owner session because it cannot manage App settings,
but it also authorizes stream termination. This Link only reads; do not describe
the credential itself as read-only. Setup reads `/api/v1/settings/api-key`, only
generates when the token is explicitly null and no creation checkpoint exists,
and saves the owner ID and returned key fingerprint through helpers before
saving the key. It never rotates a key. Missing secrets can be rediscovered only
when the authenticated owner's current key matches the saved fingerprint.
Unowned, changed or uncertain keys remain Manual; there is no automatic adoption
or retry of an uncertain generation request. Generation has no upstream
compare-and-set guard: concurrent key management must remain out of scope.

`tracearrTarget()` uses `http://tracearr:3000` separately from the browser
Address, bearer authentication supplied as Homarr `apiKey`, a native `tracearr`
widget and shared Stats. Streams and statistics are shown; recent activity and
violations are hidden. Homarr still requests those optional datasets internally,
so hiding them is not a guarantee that histories are never read.

The four Stats keys all have unit `count`: `activeStreams` (currently cached
sessions), `totalUsers` (distinct attached media-server users), `totalSessions`
(deduplicated plays in the last 30 days), and `recentViolations` (undismissed
violations in the last seven days). There are no native library/server-count or
separate rate metrics. The native stream summary reports counts and formatted
`totalBitrate` in `kbps`, `Mbps` or `Gbps`; `—` means unavailable, never zero.
No server/library ID is invented or needed by these default widgets.

Read-only preflight requires authenticated health, Tracearr 2.6.0, healthy
database/cache and at least one online nonhistorical media server. Missing or
offline servers remain Manual before Homarr mutation. Upstream `online: true`
also includes not-yet-probed servers: it is not independent connectivity proof.
Native verification checks the Stats catalog, the owned dashboard ID, timestamps
within 30 seconds (five-second future tolerance), explicit nonnegative integer
counts, stream rows and summary consistency. It uses Homarr's supported
`widget.stats.refresh` with `force: true` to bypass the one-hour Stats window:
that POST only refreshes Homarr's cache through read-only upstream calls, not
App settings or resources. The returned snapshot must have explicit
`error: false`, `stale: false`, fresh `updatedAt` milliseconds and all four
count values. A locked/failed refresh returning old data is rejected. Explicit
empty streams are valid; missing fields, authentication failures and stale
responses are not zero. Rendered freshness is not claimed.

Sources checked on 11 October 2026:

- [Tracearr v2.6.0 key API](https://github.com/connorgallopo/Tracearr/blob/4e95a204359038cc58ea99845512d49115d38af0/apps/server/src/routes/settings.ts)
- [Public authentication](https://github.com/connorgallopo/Tracearr/blob/4e95a204359038cc58ea99845512d49115d38af0/apps/server/src/plugins/auth.ts)
- [Public counts/streams and termination](https://github.com/connorgallopo/Tracearr/blob/4e95a204359038cc58ea99845512d49115d38af0/apps/server/src/routes/public.ts)
- [Bitrate formatting](https://github.com/connorgallopo/Tracearr/blob/4e95a204359038cc58ea99845512d49115d38af0/packages/shared/src/constants.ts)
- [Homarr adapter](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/integrations/src/tracearr/tracearr-integration.ts)
- [Native widget options](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/widgets/src/tracearr/index.ts)
- [Stats names and units](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/integrations/src/stats/existing.ts)
- [Stats catalog/snapshot API](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/api/src/router/widgets/stats.ts)

The adapter/types, native router/options, integration definition, widget map and
Stats provider/router files are identical between the supplied Homarr image
source `3d4150e59f600876b7e308f857b2f21572b75348` and tagged baseline
`ebbd4876d25a51151444a009ab596e1154d62880`. This is source verification, not a
new image-digest or runtime proof. Context7 was already exhausted.

This draft intentionally leaves registry assembly to #262's owner. No runtime,
media-server enrollment, fresh Stats snapshot, rendered widget, Manual recovery,
restart, installation-order or removal/reinstallation proof is claimed. Those
need separately approved scoped owned resources; never use personal servers,
account tokens, histories, scans or playback to fill the gaps.
