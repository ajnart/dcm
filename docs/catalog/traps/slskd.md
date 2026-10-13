# Slskd traps

## Pitfalls

- Only share or download content the operator is authorized to distribute or retain.
- A loopback-only port 50300 does not make the daemon reachable to Soulseek peers; peer ingress needs a separate network approval.
- The Soulseek protocol account requires operator-supplied credentials; Web UI credentials do not create that account.
- Setup verifies the local API separately, then leaves an absent Soulseek connection/login as a retryable Manual step. It never connects, searches or starts transfers. Configure the account privately in Slskd only after approving network use, then retry `self-host setup slskd` and `self-host setup homarr`.
- Homarr 2.4.1's Slskd adapter lists downloads only; pause, resume and delete are no-ops. Its `download` Stat sums every returned file's `averageSpeed` in bytes/s, including completed transfers, so it is not guaranteed instantaneous throughput. The adapter hardcodes upload to zero and paused to false; neither is a meaningful default Stat. Downloads omit unsupported per-item speed columns.
- Local API acceptance of an explicit empty download array is not evidence of Soulseek readiness. The Homarr preflight requires explicit connected and logged-in server fields before creating any resources. Native verification checks the Downloads result and a forced fresh, non-error Stats result; rendered widgets and provider transfers still need separately approved runtime proof.

## Security

- Set a generated Web UI password and primary API key before first start; never retain the documented slskd/slskd defaults.
- The Slskd 0.26.1 Compose definition uses the official `SLSKD_API_KEY` tuple `role=ReadOnly;<saved Project key>` without rotating that key. The shared Admin login remains unchanged; no Soulseek password is stored or fetched by this Link. Existing Projects must back up and run `self-host update slskd` to apply the version and key mode, then retry Setup. Recover lost keys through the Project secret boundary, never through command arguments or chat.
- `ReadOnly` is the least-privilege upstream role, not proof every Slskd write endpoint rejects the key: 0.26.1 declares several transfer and server mutations with `AuthPolicy.Any` and no role restriction. This implementation makes only local GET reads and Homarr's read-only Stats refresh; write-denial behavior and effective runtime key scope have not been exercised.
- Keep the Web UI private. API keys sent over plain HTTP can be intercepted; use a trusted HTTPS route for remote clients.
- Review shared folders and the Soulseek listen port separately from Web UI access.

## Source contract

- [Slskd 0.26.1 configuration](https://github.com/slskd/slskd/blob/0.26.1/docs/config.md), [primary key parsing](https://github.com/slskd/slskd/blob/0.26.1/src/slskd/Core/Security/SecurityService.cs), [session authentication](https://github.com/slskd/slskd/blob/0.26.1/src/slskd/Core/API/Controllers/SessionController.cs), [server state](https://github.com/slskd/slskd/blob/0.26.1/src/slskd/Core/API/DTO/ServerState.cs), [transfers](https://github.com/slskd/slskd/blob/0.26.1/src/slskd/Transfers/API/Controllers/TransfersController.cs), and [file units](https://github.com/slskd/slskd/blob/0.26.1/src/slskd/Transfers/Types/Transfer.cs).
- [Homarr 2.4.1 Slskd adapter](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/download-client/slskd/slskd-integration.ts), [Stats metrics](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/stats/existing.ts), [Downloads options](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/widgets/src/downloads/index.ts), and [Stats freshness](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/request-handler/src/stats.ts).
- This peer supplies `slskdTarget()`; the reference owner must assemble it in `targets.go`. Source and existing App fixtures are not native/rendered acceptance. No Slskd image digest, runtime lifecycle, provider connection or transfer has been verified here.
