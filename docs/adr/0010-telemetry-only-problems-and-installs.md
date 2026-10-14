# Telemetry sends only installs, Onboarding and problems

Amends the "Command events" paragraph of [ADR 0006](0006-telemetry-on-by-default.md).

Sending an event for every finished command is more than we need. The
maintainer wants Onboarding, problems and the few facts that steer the product.

A `command` event is now sent only when:

- the outcome is failed or incomplete, together with its `$exception`; or
- the command changes the Project and shows what people install: `install`,
  `setup`, `remove`, `restore` and `self-update`, including on success.

`self-host profile set experience` also sends, because it sets the person
property from ADR 0009. Every other successful command (`status`, `logs`,
`doctor`, `debug`, `apps`, `credentials`, start/stop/restart, `config`,
Dashboard opens) sends nothing. Warning and error step logs, the `onboarding`
event and approved Feedback are unchanged. The command set lives in one place,
`reportedOnSuccess` in `internal/telemetry`; there is no setting for it.

The telemetry page now states the purpose: understanding how self-host is used
and debugging it, for the maintainers only, never sold or shared with anyone
else. Fields, off switches and the first-run notice are unchanged.

Superseded by [ADR 0011](0011-minimal-anonymous-telemetry.md): successful commands send nothing.
