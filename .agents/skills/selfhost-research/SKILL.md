---
name: selfhost-research
description: Research current self-hosted software without changing a host. Use for official installation or API evidence, secret-free Compose extraction, alternative comparisons, lifecycle or image provenance, documentation-link validation, Homarr coverage, or bounded public UI proof. Keep official and community evidence distinct.
license: Apache-2.0; see LICENSE.txt
compatibility: Requires Bun 1.4.0 or newer; live research may require approved public network or browser access.
---

# Selfhost research

Produce current, auditable evidence without installing software, changing a host, authenticating to a site, or retaining browser state.

## Research workflow

1. Define one research question, the required evidence fields, and an explicit domain allowlist. Reject a request to browse an unrestricted domain set.
2. Prefer upstream documentation, repositories, release notices, registries, and specifications. Label vendor and community packaging separately from the upstream project. Use community sources only for popularity or operator experience and label them `community`.
3. Read [references/methods.md](references/methods.md) for official-doc discovery, Compose extraction, alternative comparison, and lifecycle review.
4. Before any browser command, read [references/browser-contract.md](references/browser-contract.md). Load the installed browser workflow with `agent-browser skills get core` or `agent-browser skills get core --full` before creating a session.
5. Use a unique named session, pass the allowlist on every browser command, wait explicitly after navigation, and use status-aware `read --json`. Keep the requested source URL, canonical URL, and observed final URL distinct.
6. Send extracted text through `scripts/redact.ts` before printing, saving, or giving it to another agent. Extract Compose snippets with `scripts/extract-compose.ts`; never preserve environment values or host volume sources.
7. Validate captured link envelopes with `scripts/validate-link-result.ts` and lifecycle records with `scripts/validate-lifecycle.ts`. Treat `blocked` as missing evidence, not as a negative finding.
8. For UI proof, use `snapshot -i`, interact through a fresh ref, verify the URL, wait, and take a new snapshot. Do not reuse refs after navigation or state changes.
9. Copy [assets/research-report.md](assets/research-report.md) for the deliverable. Include exact source roles, check date, confidence, limitations, and redaction counts; omit raw browser payloads.
10. Close the named browser session in cleanup on success, failure, or interruption. Confirm closure in the report.

## Browser boundary

Use isolated local browser state only. Start no session with restore state, a user profile, authentication, cookies, recording, HAR capture, or a persistent vault. Do not use a shared default browser session.

If Chromium requires `--no-sandbox`, stop and report `browser_environment_blocked`. State that disabling the browser sandbox is an explicit environment and security prerequisite. Continue only after that prerequisite is deliberately accepted outside this skill; never add the flag silently.

An allowlist limits browser navigation but is not an egress security boundary. Research only public, non-sensitive pages. Never inspect local application sessions, `.env` files, `.sessions`, credential stores, or authenticated control planes.

## Utilities

Resolve scripts relative to this `SKILL.md`; do not assume the repository is the current directory. Every utility accepts stdin or `--file FILE`, writes JSON to stdout, and runs on Bun 1.4.0 or newer without package dependencies.

```text
bun scripts/redact.ts [--file FILE] [--pretty]
bun scripts/extract-compose.ts [--file FILE] [--pretty]
bun scripts/validate-link-result.ts [--file FILE] [--pretty]
bun scripts/validate-lifecycle.ts [--file FILE] [--max-age-days N] [--strict] [--pretty]
```

Read [references/evidence-contract.md](references/evidence-contract.md) before constructing link or lifecycle input. Utilities intentionally return reason codes instead of rejected values. Do not paste a rejected payload into a report to explain a failure.

## Result contract

Return a Markdown report plus optional normalized JSON records:

```yaml
status: pass | warn | blocked
question: string
checkedAt: ISO-8601
sources:
  - role: official | vendor | image-publisher | community
    sourceUrl: canonical public URL
    finalUrl: observed URL
    linkStatus: pass | blocked
findings: []
alternatives: []
lifecycle: []
uiProof: []
redaction: {applied: true, count: 0}
confidence: high | medium | low
limitations: []
sessionClosed: true
```

Completion requires at least one primary source for each technical claim, a passing or explicitly blocked link record for every cited URL, no unlabelled community claim, no environment value or credential in any artifact, explicit lifecycle/image uncertainty, reported browser cleanup, and limitations sufficient for another agent to decide whether the evidence can update the catalog.
