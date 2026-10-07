# Domain docs

## Layout and reading rules

This is a single-context repository, including its CLI workspace.

Before exploring:

- Read `.agents/CONTEXT.md` for domain vocabulary and boundaries.
- Read relevant decisions in `.agents/adr/`.
- Follow the owning workflow's GUIDE.md and directly linked references,
  as required by the repository guide.

These existing paths are canonical. Domain modeling updates them in place.
If a referenced domain document is absent, proceed silently; create it
only when domain modeling resolves a term or decision.

## Vocabulary

Use terms defined in `.agents/CONTEXT.md` in issue titles, proposals,
hypotheses, and implementation work.

For missing terms, reconsider invented language or record the gap for
domain modeling.

## ADR conflicts

Explicitly flag proposals that contradict an existing ADR, identifying
the decision and why it should be reconsidered.
