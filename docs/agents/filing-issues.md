# Filing issues and opening PRs

Blank issues are disabled. File through the forms in `.github/ISSUE_TEMPLATE/`; the label vocabulary is `triage-labels.md`.

## Issue

- Run `self-host --version` and `self-host doctor` and paste both outputs. Add the `--json` output of the failing command when it has one.
- Fill every required field. Set "Reported by" to "An agent".
- Keep the form's labels (`bug` or `enhancement`, plus `needs-triage`). Maintainers add `ready-for-agent` after triage.
- State the observed fact and the exact command. Put suspected causes under "Anything else", marked as suspicion.
- Redact secrets before posting: `secrets.env`, `.env*`, tokens, `.sessions/`, browser profiles and private hostnames stay out of text, logs and screenshots. Report vulnerabilities through the private security advisory.

## Pull request

- Start from an issue and end the body with `Closes #<n>`. Anything touching 100 or more files needs prior agreement in an issue, or it is closed unread; split it instead.
- Make the smallest fix that solves the issue, using the existing package that owns the boundary (see the Map and Ownership in `AGENTS.md`).
- Write the body in plain sentences: what was wrong, what changed, why. Leave out restated diffs and unrequested extras.
- Show visible changes with a before/after table of screenshots, attached via `gh pr create --attach`.
- Paste the local gate result from `AGENTS.md`. Add tests where they pin the behaviour; run only the files you touched.
- Use a conventional commit title and disclose AI assistance.
