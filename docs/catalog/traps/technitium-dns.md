# Technitium DNS Server traps

Source status, 13 October 2026 (before this docs update):
`e41c11799e133521bb9860efff9f32fa67f94a1d`.
The descriptor is normalized to the Stats SDK and registered in `internal/apps/homarr/targets.go`. This establishes source
wiring only; native/rendered data, both installation orders and lifecycle
acceptance remain unproved. Earlier dated evidence retains its original scope.

## Pitfalls

- A broad DNS feature set increases configuration and recovery scope.
- The shared recipe publishes only the loopback web console. DNS on TCP/UDP 53 requires a separate LAN owner and cutover plan.
- The Go CLI's `--set technitium-dns.dns-port=PORT` changes only the TCP/UDP host publication; container DNS remains on 53. The default remains 53, which ordinary LAN DNS clients expect.

## Security

- Separate public authoritative service from private recursion and administration.

## Homarr Link contract

- Source-checked versions: Technitium 15.5.1, commit
  `4323993c2dd6cbe828d2fd3b239c401a526f58fc`, and Homarr 2.4.1, commit
  `ebbd4876d25a51151444a009ab596e1154d62880`. Other Technitium versions stop
  with a backup/version hint. This is not runtime compatibility evidence.
- A fresh Technitium configuration creates the built-in `admin` using
  `DNS_SERVER_ADMIN_PASSWORD_FILE`. Setup records that App-local username
  when the shared Admin username differs. Existing configurations do not
  reread the password file to reset accounts. Restore a configured alias and
  shared password through the Project boundary; Setup never resets passwords,
  changes groups, disables two-factor authentication or elevates accounts.
- Setup creates only an absent `self-host-homarr` local account through
  `/api/admin/users/create`, and records ownership after creation is confirmed.
  Its random password stays in `TECHNITIUM_DNS_HOMARR_PASSWORD`.
  A matching account without `TECHNITIUM_DNS_HOMARR_USER` ownership is a
  retryable Manual step, never silently adopted.
- `/api/admin/sessions/createToken` creates the non-expiring token named
  `self-host Homarr statistics`. `TECHNITIUM_DNS_HOMARR_API_KEY` stores it;
  `/api/user/session/get` verifies its identity, version and permissions.
  A valid token is reused. A rejected token is not rotated. If the token exists
  but the Project secret is lost, restore that secret or delete only that owned
  token in Technitium's console and retry `self-host setup technitium-dns`.
- Required capability: **Dashboard View**. Technitium tokens inherit their
  user's permissions, not token-specific scopes. Every local user inherits
  `Everyone`; its upstream defaults also grant View on Zones, Cache, Allowed,
  Blocked, Apps, DnsClient, DhcpServer and Logs. Those inherited read permissions
  are a limitation, not a claim of Dashboard-only scope. No extra groups are
  allowed; Modify/Delete anywhere and Settings/Administration View are rejected.
  Setup never rewrites the shared `Everyone` policy to obtain narrower scope.
- The descriptor `technitiumDNSTarget()` uses native kind `technitiumDns`,
  `apiKey` authentication and internal Address `http://technitium-dns:5380`.
  The browser Address remains separate. Read-only preflight validates the
  owned credential and explicit DNS statistics before Homarr mutation.
  Defaults are `dnsHoleSummary` and the shared Stats widget. DNS controls
  require Settings Modify and are deliberately omitted.
- Native Stats metrics: `dnsQueriesToday`, `adsBlockedToday` and
  `domainsBeingBlocked` use count units; `adsBlockedTodayPercentage` uses percent.
  Homarr's Technitium adapter actually requests **LastHour**, despite its
  “today” labels. Blocked domains are `blockedZones + blockListZones`.
  No client metric is invented from query counts. Explicit zero counts are
  accepted; absent fields, malformed bodies and body-level authentication
  errors are not empty datasets. Verification checks the native metric catalog
  and a forced refresh with a new timestamp, no error and no stale snapshot.
- The reference owner registered the descriptor. Source work
  does not prove external contracts, rendered values,
  installation orders, credential changes, removal/reinstallation or lifecycle.
  No Docker, browser, resolver changes, DNS queries or zones were used for this
  source-only work. The parent runtime lane must supply real scoped evidence.
- The Docker registry returned index digest
  `sha256:b8efe03a5e3bdc6e9d2baff3f6e70c382c7f98afa2a7ca66f318d4b58a8d5944`
  for `technitium/dns-server:15.5.1` during source work. No image was started;
  runtime proofs must resolve and record their own platform image digest.

Sources:

- [Technitium 15.5.1 API documentation](https://github.com/TechnitiumSoftware/DnsServer/blob/4323993c2dd6cbe828d2fd3b239c401a526f58fc/APIDOCS.md)
- [Technitium bootstrap and inherited permissions](https://github.com/TechnitiumSoftware/DnsServer/blob/4323993c2dd6cbe828d2fd3b239c401a526f58fc/DnsServerCore/Auth/AuthManager.cs)
- [Technitium account/token API implementation](https://github.com/TechnitiumSoftware/DnsServer/blob/4323993c2dd6cbe828d2fd3b239c401a526f58fc/DnsServerCore/WebServiceAuthApi.cs)
- [Homarr 2.4.1 Technitium adapter](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/technitium/technitium-integration.ts)
- [Homarr 2.4.1 native metrics and units](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/stats/existing.ts)
- [Homarr 2.4.1 forced Stats refresh](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/api/src/router/widgets/stats.ts)
- [Official Homarr integration guide](https://homarr.dev/docs/integrations/technitium-dns/)
