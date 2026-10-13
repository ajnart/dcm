Fresh complete bounded source review at `aaa37b83e99d116936a4353fedf0a8a61068205d`, against frozen `6b82c55fb890c11a1388bd4e5a2f10b632ff4f7c`: only `internal/apps/homarr/links.go`, +3/-0.

## Standards

**PASS — zero P0–P3 findings.** Reuses existing per-App hint dispatch, with no abstractions, comments, tests, dependencies, Telemetry or persisted-format changes. Approval, Project scope and domain wording follow the documented boundaries.

## Spec

**PASS — zero P0–P3 findings.** The persisted recovery hint requires trusted HTTPS on authenticated 8971, explicit Project-scoped private TLS and certificate trust in both Homarr and the CLI, then gives both Setup retry commands. The default HTTP starter is named accurately; port 5000, authentication disablement, certificate bypass and public Access are forbidden. Existing Manual/event/result/redacted state persistence retains the hint beyond informational logs.

Parent verified clean local/live-remote and current draft PR head. The owner executed the offline gate; reviewers did not rerun it.

**Summary: Standards 0; Spec 0 — bounded diagnostic fix only.** This does not provision or approve TLS, activate Frigate, close #277, or establish native/useful data, rendering, exact-image/version or lifecycle acceptance. No runtime retry or merge approval is conveyed.
