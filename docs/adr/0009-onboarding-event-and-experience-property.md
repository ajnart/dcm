---
status: accepted (amends ADR 0006)
---

# Approving Onboarding sends one event and sets the Experience level on the person

ADR 0006 said person profiles carry no extra person properties and that
Onboarding's answers stay local. That blinded us to who uses self-host and
left no way to split later events, including installs made by agents, or to
gate a feature on the Experience level. This amends it for exactly one event
and one person property.

When the person approves Review, Onboarding sends one `onboarding` event with
`experience` (`new` or `advanced`, from the answer or the saved Profile),
`glyphs` (`nerd-font` or `simple`), `intro_skipped` (whether the Intro was
skipped), `doctor` (`ok` or `warn`, `warn` when any host check warned) and
`duration_ms` (Onboarding open to approval), plus `version`, `os` and `arch`
like every other event. The event sets the person property `experience`
(`$set`) to the same level. `self-host profile set experience <level>` sets
the same person property on its command event, so the data stays true when the
level changes.

Every value comes from a fixed set or is a flag or a duration; no free text
travels. Nothing is sent if Onboarding is quit before approval, and nothing
is sent before the first-run notice. Every off switch of ADR 0006 applies:
`SELF_HOST_NO_TELEMETRY=1`, `DO_NOT_TRACK=1`, CI and development builds.
Everything else in ADR 0006 stands, including its never-sent list. The wiki's
Telemetry page lists the event and the person property.

Abandoned Onboarding and drop-off funnels stay out of scope: they would need
events before approval, which the notice promise forbids.
