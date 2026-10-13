Fresh complete source review at `71e5c0fc1afd1732a38b299137f0001ed99a19d3`, against fixed `6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c` (five files, +536/-42).

## Standards

**PASS — zero P0–P3 findings.** Prior P3 closed: `target_aria2.go` and its proof reference now follow the documented peer seam. No actionable documented-rule breaches or Fowler-smell findings. Common/registry/helper/dependency files remain unchanged.

## Spec

**PASS — zero P0–P3 findings.** Prior P2 closed: RPC, native Downloads and refreshed Stats validate independently instead of requiring volatile cross-sample equality. Duplicate IDs are checked within each response; native list paused semantics remain separate from the Stats one-item window. Saved identity/credential/destination, authenticated version/directory, required arrays, typed fields/ranges, supported units and central advancing freshness remain checked. Missing/authentication/unsupported data still fails; no fabricated zeros, anonymous fallback, arbitrary tolerance or added retry loop. Approved replacement/restart recovery is preserved.

Parent verified clean local/live-remote and current draft PR head. The owner executed mandatory offline gates; reviewers did not rerun them. No new tests, dependencies or runtime were added.

**Summary: Standards 0; Spec 0 — source only.** Aria2 remains individually unregistered; actual native/rendered data, both installation orders, credential/resource preservation and removal/reinstall lifecycle remain unproved. The sampling correction has not been exercised live. Keep #269 open and this PR draft; no runtime retry, merge or full acceptance approval is conveyed.
