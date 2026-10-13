Fresh complete **held-source** review at `d03616aac0a2aa902097cbd7062d99abf514f891`, against fixed `795c6d082c8affd213447e0629328fb7ba9d2fe4`:

- **Standards:** PASS, zero P0–P3 findings across the entire six-file +959/-14 diff. Existing test entry points remain; the diagnostic repair adds no cases or fault triggers.
- **Spec:** PASS, zero P0–P3 findings across that same complete diff. The contextual `%w` wraps only the already-redacted `ExecSecret` error; credential registration, returned diagnostics and later display/persistence sinks retain masking.
- Ownership, symlink/duplicate-line protection, UID/GID preservation, same-login recovery, consecutive provider definitions, separate provider Manual step and pre-mutation #354 hold are unchanged. Parent verified clean local/live-remote head, exact merge-base and the only +1/-1 production change from tested `52eab499`. The owner reports the actual mandated offline gate passing; reviewers did not rerun it.

This is **diagnostic quality, not a demonstrated fix to the observed persistence failure**. Its root cause is still unknown. Keep this PR draft and #290/#354 open: native activation, useful independently captured/rendered values and lifecycle acceptance remain held. No runtime retry, merge or privacy-boundary change is authorized by either source PASS.
