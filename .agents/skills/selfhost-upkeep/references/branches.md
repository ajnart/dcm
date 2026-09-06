# Upkeep branches

Use exactly one primary branch per run and retain all prior selected services.

| Branch | Owner | Completion evidence |
| --- | --- | --- |
| Status | Adapter plus `selfhost-verify` | Fresh service, relationship, browser, and edge classifications |
| Extend | New profile owners | Existing acceptance still passes and every new relationship has direct proof |
| Upgrade or migrate | `selfhost-operations` and `selfhost-compose` | Compatibility, backup/restore, apply, health, acceptance, and rollback evidence |
| Repair | Capability that owns the failed boundary | Reproduction goes red, bounded fix applies, focused acceptance returns green |
| Reconnect | Application adapter | Private connection file updated atomically and dependent checks pass |

An extension begins with `stack.ts extend`, which records intent and returns the
metadata stage to `selected`. It does not authorize or perform the change.
For each profile whose manifest declares explicit service consumption, repeat
`--consume PROFILE=SERVICE` for the existing or newly recorded service IDs it
will affect. A generic service record never stands in for this binding.
When adding the media profile to a stack that has no runtime, pass
`--adapter selfhost-media --run-id ID`, then create that exact run through the
media adapter. Existing media runtime identity is immutable.
