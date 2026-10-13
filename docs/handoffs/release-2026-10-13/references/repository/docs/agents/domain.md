# Domain docs

## Layout and reading rules

This is a single-context repository: one Go module at the repository root.

Before exploring:

- Read `CONTEXT.md` for domain vocabulary and boundaries.
- Read relevant decisions in `docs/adr/`.

These paths are canonical. Domain modeling updates them in place. If a
referenced domain document is absent, proceed silently; create it only when
domain modeling resolves a term or decision.

## Vocabulary

Use terms defined in `CONTEXT.md` in issue titles, proposals, hypotheses, and
implementation work.

For missing terms, reconsider invented language or record the gap for domain
modeling.

## ADR conflicts

Explicitly flag proposals that contradict an existing ADR, identifying the
decision and why it should be reconsidered.
