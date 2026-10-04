# Uptime Kuma v2.5.5 first-run route (2026-09-29)

The existing Socket.IO first-owner route was incomplete on an empty data directory. The tagged server starts a temporary HTTP-only database setup service before the normal Socket.IO server; a healthy container can therefore still reject a socket connection.

| Gate | Tagged source | Deterministic step |
| --- | --- | --- |
| Database not configured | [Setup database server](https://github.com/louislam/uptime-kuma/blob/2.5.5/server/setup-database.js#L61-L103) | Inspect `GET /setup-database-info`. When `needSetup` is true and `runningSetup` false, record an attempt before sending one SQLite setup POST. |
| SQLite database setup | [HTTP routes](https://github.com/louislam/uptime-kuma/blob/2.5.5/server/setup-database.js#L126-L170) and [UI payload](https://github.com/louislam/uptime-kuma/blob/2.5.5/src/pages/SetupDatabase.vue#L194-L235) | `POST /setup-database` with `{ "dbConfig": { "type": "sqlite" } }`, then poll the read-only info route until `needSetup` is false. Do not retry an uncertain POST blindly. |
| First administrator | [Server handler](https://github.com/louislam/uptime-kuma/blob/2.5.5/server/server.js#L646-L679) and [UI event flow](https://github.com/louislam/uptime-kuma/blob/2.5.5/src/pages/Setup.vue#L79-L111) | Only after the database gate, inspect Socket.IO `needSetup`, emit `setup(username,password)` once under its own attempt checkpoint, and verify login with the saved private credential. |

The initial Socket.IO `info` event reports `serverTimezoneOffset` as an `±HH:MM` string, not a number; both the tagged [server info sender](https://github.com/louislam/uptime-kuma/blob/2.5.5/server/client.js#L128-L150) and [timezone implementation](https://github.com/louislam/uptime-kuma/blob/2.5.5/server/uptime-kuma-server.js#L414-L420) establish this. The live isolated instance matched that type without revealing its values.

The main app also answers `/setup-database-info` with `needSetup:false`; that proves only database readiness, not account creation. [Main handler](https://github.com/louislam/uptime-kuma/blob/2.5.5/server/server.js#L266-L272). The alternative `UPTIME_KUMA_DB_TYPE=sqlite` skips the temporary page, but the CLI retains the HTTP setup route to recover existing recipe projects without silently changing their Compose approval.

The first live two-app trial found the missing database gate on an isolated rootless project. After adding the HTTP step and correcting the info type, the same owned Uptime Kuma project reached `login-verified` with its generated credential. Monitor function and restart persistence remain unproved; the sibling Paperless database remains failed in that original trial.
