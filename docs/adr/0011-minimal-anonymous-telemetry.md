---
status: accepted (supersedes ADR 0010; amends ADR 0006 and ADR 0009)
---

# Telemetry stores no ID and sends only Onboarding, errors and agent App requests

The maintainer wants statistics and a way to improve the app, nothing more:
that someone installed and how, what breaks, and which Apps agents are asked
for that the Catalog lacks. A stored install ID and a stream of command events
are more than that.

**No ID is saved.** The persisted install ID is gone: no file in the user
config folder, no Home-folder copy, no migration. Each process draws a random
UUID in memory and uses it as the PostHog distinct ID for that run only, so
runs cannot be linked. Every event is anonymous (`$process_person_profile:
false`): no person profiles and no person properties, so `experience` is a
plain property of the `onboarding` event. `self-host profile set experience`
stays a local preference and sends nothing. The first-run notice stays; ADR
0012 moves it to Onboarding only.

**Events, and nothing else:**

- `onboarding`, when Onboarding's plan is approved: Experience level, glyph
  set, whether the Intro was skipped, Doctor's outcome, duration, the chosen
  App and Recipe IDs and Access choice when there are any, plus version, OS
  and architecture.
- `$exception` for a failed or incomplete command, with the warning and error
  step logs of ADR 0006. A successful command sends nothing, so the generic
  `command` event and ADR 0010's list of commands reported on success are gone.
- `app_requested`, from `self-host apps request <name> [--url <homepage>]`, run
  by an agent whose person wants an App the Catalog lacks. It carries the
  name (trimmed, lowercase, at most 64 characters of `a-z 0-9 . _ + -`, else
  refused) and the homepage's host only, never a path or query. A name that is
  already a Catalog App sends nothing. A person asks for an App by opening a
  GitHub issue instead.
- `feedback`, only after the person approves the text, as in ADR 0006.

Every off switch of ADR 0006 applies, including to `app_requested`; with
Telemetry off the command says so and exits 0. The fields, never-sent rules,
proxy and deadlines of ADR 0006 otherwise stand.

## Amendment

[ADR 0012](0012-telemetry-notice-only-in-onboarding.md): the notice shows only
on Onboarding's Welcome step, nothing records it, and sending does not wait
for it.
