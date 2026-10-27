---
status: accepted (amends ADR 0006, ADR 0009 and ADR 0011)
---

# The Telemetry notice shows only on Onboarding's Welcome step

ADR 0006 printed a notice on the first plain command, recorded in the Home
folder that it was shown, and sent nothing until then. A line on stderr before
a person's first command reads as a warning, the record was one more file to
explain, and the README and the telemetry page already say what is sent.

Onboarding's Welcome step shows the two-line notice with the link to the
[telemetry page](https://self-host.fyi/telemetry) whenever Telemetry is on.
Onboarding opens only until a Project exists, so nothing needs recording.
Commands, `--json` or not, print nothing about Telemetry, and sending no longer
waits for the notice: an agent that installs without Onboarding sends errors
and App requests without one. Nothing in the Home folder records it.

Every off switch, the never-sent rules and the events of ADR 0011 stand.
