# Backup planner contract

`plan-backup.ts` accepts one JSON object, validates every object key recursively, and emits a deterministic secret-free assessment. It reads only the named input file and never inspects a source or target.

## Input model

- `project`: stable `id` and accountable `owner`.
- `objectives`: positive `rpoMinutes` and `rtoMinutes`.
- `sources`: `config`, `user-data`, `database`, or `cache` records with an absolute `path`, failure domain, owner, inclusion/rebuildability decision, and consistency method.
- `targets`: `local` or `off-host` records with an absolute path, covered source IDs, failure domain, owner, encryption/custody record, protection options, and destructive approval.
- `schedule`: cadence, bounded retention counts, and pruning approval/owner.
- `notifications`: failure owner and opaque route references.
- optional `restoreDrill`: timestamped isolated-restore evidence with source coverage, a non-production target, duration, integrity and application results, evidence references, and SHA-256 hashes. Omit it or use `null` when no drill exists; the result remains blocked and not verified.

Database consistency methods are `native-export`, `application-export`, `quiesced-copy`, or `quiesced-snapshot`. `filesystem-copy` and `filesystem-snapshot` may describe suitable non-database sources but do not prove a live database is consistent. Every included source records the application/schema version used for recovery.

Encryption uses `secretRefs` only. Custody records contain an owner, opaque location reference, independent-custody flag, and confirmation timestamp. They never contain a recovery key.

## Restore gate

`restore.state` becomes `verified` only when all included sources were restored to an absolute path isolated from sources and backup targets; production was not overwritten; integrity passed with objects checked and ownership preserved; every application acceptance check passed; evidence references and hashes exist; and duration met RTO.

Backup existence, snapshot creation, upload completion, repository readability, and checksum validation without application acceptance remain `not-verified`.

## Safety findings

- A source and target whose normalized paths contain one another are `conflict`.
- A nominal off-host target in the source failure domain is `conflict`; absent independent off-host coverage is `blocked`.
- Missing database consistency, encryption reference, recovery-key custody, owner, failure route, or restore evidence is `blocked`.
- A destructive target without approval or enabled pruning without approval is `conflict`.

Inputs are capped at 256 KiB, nesting at 12 levels, collections at 100 entries, and strings at 2048 characters. Unknown keys, plaintext secret-bearing fields, private-key material, bearer/basic authorization values, token-shaped values, and secret-bearing URLs are rejected without echoing their contents.
