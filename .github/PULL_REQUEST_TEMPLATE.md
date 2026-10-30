## Change

Describe the user-visible outcome. End with `Closes #<n>`.

## Gate

Paste the result of the local gate in `AGENTS.md` (CI cannot run).

## Safety

- [ ] No secret, session, private host, or credential material is included.
- [ ] Access changes keep their own explicit approval.
- [ ] Existing `--json` keys, non-TTY output and persisted formats still work.

## Provenance

- [ ] I disclosed material AI assistance and reviewed the resulting content.
- [ ] New third-party material is identified in `THIRD_PARTY_NOTICES.md`.

## Docker Compose Maker (`dcm/`)

- [ ] Not a `dcm/` change, or `bun run --cwd dcm test` passes and new containers follow `dcm/CONTRIBUTING.md`.
