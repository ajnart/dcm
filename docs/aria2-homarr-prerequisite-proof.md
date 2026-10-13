# Aria2 prerequisite proof for Homarr #269

11 October 2026. **Aria2 prerequisites verified; Homarr acceptance blocked by
#262.** The separate `aria2Target()` descriptor is deliberately not registered.
No Homarr connection or rendered widget was tested, and #269 remains open.

## Tested source and runtime

- Code: `34f7c905b0c61d9133cbb832ca74e1e32efe16d4`, built with
  `GOFLAGS=-buildvcs=false go build ./cmd/self-host`.
- Development binary SHA-256:
  `5d89cdac17ec39188f5d3f992edfc45f8578365b70f70547bd55e7c299c9837a`.
- App: `snowdreamtech/aria2:1.37.0-debian`; authenticated runtime version
  `1.37.0`; image ID
  `sha256:c33bf5b5a53caba42033143478a9f91ea19f8f41b8fc62e15f076a5fe067427f`;
  repository digest
  `snowdreamtech/aria2@sha256:b599a244507683b982500a42b8bb1e1d7a6a3716628f4959a6fed4b0e692f54a`.
- Docker `29.4.0`. Exactly one App in Compose Project
  `selfhost-aria2-269-bzgzimx8`, using a uniquely generated disposable Home
  under the approved temporary directory. Media/download folders were also
  disposable; no existing Project was opened.
- `SELF_HOST_NO_TELEMETRY=1`, `DO_NOT_TRACK=1`, `--exposure local`, mapped
  port `26869`; inspection confirmed only `127.0.0.1:26869 -> 6800/tcp`.
  Runtime override bounded the App to 256 MiB and 0.5 CPU.
- Initial internal-only networking suppressed Docker's published port and
  blocked host-side Setup. Scoped `self-host down` removed that network;
  successful verification used this Project's private bridge network instead.
- Entrypoint was `/usr/bin/aria2c` and the sole argument was
  `--conf-path=/run/secrets/rpc-config`. No token in arguments or proof output.
  No socket, host network, privileged mode, browser, or public Access was used.

## Functional observations

The probe obtained the owned disposable credential through
`self-host credentials --json` into process memory, never printed it, and sent
POST requests to `/jsonrpc`. No protected file was inspected or dumped.

| Observation                            | Result                                                          |
| -------------------------------------- | --------------------------------------------------------------- |
| `aria2.getVersion`, no token           | HTTP 400, JSON-RPC error code 1, `Unauthorized`                 |
| `aria2.getVersion`, invalid token      | HTTP 400, same explicit denial                                  |
| `aria2.getVersion`, saved token        | HTTP 200, result version `1.37.0`, no RPC error                 |
| `aria2.getGlobalOption`, saved token   | Setup verified the owned `/var/lib/aria2/downloads` directory   |
| `aria2.getGlobalStat`, saved token     | Download/upload rates and active/waiting/stopped counts all `0` |
| `aria2.tellActive`, saved token        | Valid empty result array                                        |
| `aria2.tellWaiting(0, 1)`, saved token | Valid empty result array                                        |
| `aria2.tellStopped(0, 1)`, saved token | Valid empty result array                                        |
| Setup rerun, restart followed by Setup | Passed; credential unchanged                                    |
| Healthy-token reinstall and Status     | Passed; saved credential reused; Setup `ok`                     |

These reinstall observations used an already healthy token; they are not
token-drift recovery proof. The 12 October 2026 correction is source-only:
recovery now requires inspection and review of existing Compose,
authentication, mounts and ports, preservation of protected configuration,
and separate explicit approval of Compose/private-configuration replacement
before an install, followed by explicit restart and Setup. Reinstall is not a
credential-only update. No runtime or token-drift recovery was exercised for
this correction; only the existing failing-hint test was strengthened.

Empty queues are authenticated data, not an authorization failure. No download,
public torrent, session-persistence claim, or VPN-safety claim was involved.
The RPC token controls the daemon; aria2 has no narrower read-only token scope.
Verification itself used only read-only RPC methods.

Cleanup used this Home's `self-host down`, then confirmed no containers or
networks retained under the exact Compose Project label before removing the
exact disposable Home/binary/probe. No image or volume pruning was performed.

## Descriptor and remaining acceptance

`internal/apps/homarr/target_aria2.go` proposes kind `aria2`, internal
Address `http://aria2:6800`, saved `rpc_token` as Homarr `apiKey`, Downloads,
and shared Stats keys `download`, `upload`, `paused`. It does not enable the
upstream no-auth alternative. Aria2 is headless; no browser UI or AriaNg was
installed or inferred from the RPC Address.

The #262 owner must register `aria2Target()` using its approved registry and
attach its finalized verification hook: freshly check `aria2.App.Check`, then
validate actual Homarr-native download/stat data. The current proposal does not
claim this hook, ownership policy, or compatibility contract is complete.

Still required: exact supported Homarr runtime/version/digest; authenticated
native connection and useful rendered widget; credential-update and stable-ID
reconciliation; preservation/removal of unrelated resources and shared
bindings; absent/unready peers, both installation orders, late peer, removal
and reinstall. Those checks cannot be inferred from this prerequisite proof.

Homarr v2.4.1 source maps an empty download list to `paused=true`; that is its
derived empty-list convention, not evidence that aria2's whole queue was
explicitly paused.

## Local gate

Passed: `gofmt -l .` (empty), `go build ./...`, `go vet ./...`,
`go vet -tags e2e ./e2e/`, `go test ./...`,
`go test -race ./internal/tui/ ./internal/activity/`, and `bash -n install.sh`.
Existing focused Aria2/Homarr tests passed; only their existing RPC fixture
was updated. No new dependencies or test cases were added. No e2e runtime
suite or browser was run.

For the 12 October source-only correction, the existing failing-hint test
failed before the fix and passed afterward; focused Aria2/Homarr tests,
format/build/both vet gates, relevant race tests, Bash syntax and diff checks
passed. The initial full test run failed the unchanged
`TestCommandDeadlineRetainsSanitizedTermination` and
`TestPassboltApplicationMetadataWrapperRejectsExpandedAccess` fixtures;
`go test -p 1 ./...` then passed without fixture changes or Docker runtime.

## Official sources

- [aria2 1.37.0 authorization implementation](https://github.com/aria2/aria2/blob/release-1.37.0/src/RpcMethod.cc).
- [aria2 RPC documentation](https://aria2.github.io/manual/en/html/aria2c.html#rpc-interface).
- [Homarr Aria2 guide](https://homarr.dev/docs/integrations/aria2/).
- [Homarr v2.4.1 Aria2 transport and data mapping](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/download-client/aria2/aria2-integration.ts).
- [Homarr v2.4.1 Stats metric definitions](https://github.com/homarr-labs/homarr/blob/ebbd4876d25a51151444a009ab596e1154d62880/packages/integrations/src/stats/existing.ts).

Context7 lookup was attempted but quota-exhausted; the official source above
was used instead. v2.4.1 is a researched contract, not a tested Homarr runtime.

## 13 October shared Stats and Downloads migration

The original branch forward-merges the shared Stats/Downloads SDK and its
retry metadata without rewriting history. `aria2Target()` keeps native
readiness, identity and queue semantics and uses `readDownloadsQueue` for
one owned Downloads result with an explicit items array and a requested
limit of 50. The shared owner acquires the catalog and exactly one forced,
positive advancing sample per `verifyData` invocation; `verifyAria2Stats`
validates that same sample's units and types. Rates remain finite nonnegative
bytes/second and paused remains boolean with catalog unit `text`.
Both download and upload remain selected. The native bounded-list paused
relationship, progress/state rules and nonnegative millisecond ETA remain
unchanged. Stats paused comes from its separate one-item native request.

Focused descriptor HTTP fixtures use the existing `statsFixture`, reject the
first invalid refreshed value without resampling, no-op refresh, wrong units,
wrong value types and foreign Downloads identity, and stop before the Stats
catalog on native failure. Explicit zero Stats remain valid even when the
independently sampled native rate or paused state differs. Local fixture
responses are synthetic and establish no real App/native/rendered acceptance.
The affected descriptor tests, shared Stats/Downloads tests, App tests,
package build/vet, gofmt and diff checks passed. No Docker/browser runtime,
provider request, download or protected Project state was used.

Registry assembly remains custodian-owned. Useful real native/rendered data,
both installation orders and credential/ownership/removal lifecycle checks
remain prerequisites to full acceptance; source fixtures do not satisfy them.
