# Telemetry is on by default in releases, anonymous, and documented in the wiki

We shape the CLI around what people install and where Setup breaks. Releases
send Telemetry to EU PostHog through `https://hog.ajnart.dev`, using the public,
write-only project key embedded by GoReleaser. Development builds have no key
and send nothing, even when a release key is supplied to a development build.

The install ID is a random UUID in `os.UserConfigDir()/self-host/telemetry-id`.
An existing Home-folder ID migrates there; deleting or reinstalling the Project
does not change it. It is never derived from the machine. Person profiles are
enabled to group usage and retention by this ID, with no extra person
properties. GeoIP stays disabled and payloads carry no IP or location. The
maintainer must enable PostHog's "Discard client IP data" setting; neither the
CLI nor fake-transport tests verify server-side discard. Network requests still
expose their source IP to the receiving infrastructure.

Command events carry version, OS and architecture, command, outcome and
duration, Catalog App and Recipe IDs, Access IDs (`home`/`local`), and step IDs,
outcomes and durations. Errors are `$exception` events with stable fingerprints
and only in-app function names, module-relative files and lines. Panic values
are reduced to their type and a fixed message, sent as unhandled exceptions
within the usage deadline before rethrowing. No host names, absolute paths,
inputs, secrets, App data or raw error text are sent.

Warning and error steps send fixed-text OTLP/HTTP JSON logs through the proxy's
`/i/v1/logs`, authenticated with the project token. This is documented by
[PostHog Logs](https://posthog.com/docs/logs/installation/other) and follows its
[reverse-proxy routing](https://posthog.com/docs/advanced/proxy); live ingestion
through this proxy is not verified by tests. There is no tracing claim. Usage
and logs share a 500 ms deadline, with no retries and silent network failures.

`self-host feedback` is the one event carrying person-approved free text,
masked against known secrets again by the CLI. The person sees the text and
agrees before sending. Messages and stdin are limited to 4096 bytes. Approved
Feedback gets a separate five-second send deadline and reports delivery failure;
when Telemetry is off it sends nothing and exits 1, not the Manual-step code.

The first-run notice and Onboarding link the
[telemetry page](https://self-host.fyi/telemetry), with
no toggle or off-switch advertising. Nothing is sent before that notice,
except explicitly approved Feedback. Environment variables
`SELF_HOST_NO_TELEMETRY=1` and `DO_NOT_TRACK=1` disable all sending, as do CI and
development builds. Agents explain these switches only when the person asks.
The page's source is `docs/telemetry.md`, rendered on the site. A public dashboard may come later; none is promised today.

On by default was chosen over opt-in because opt-in data from a self-hosting
audience is too sparse to steer by. The documented scope and never-sent rules
make that acceptable; widening either needs a new ADR.

## Amendment: the onboarding event and the experience person property

[ADR 0009](0009-onboarding-event-and-experience-property.md) adds one
`onboarding` event on approving Review and the person property `experience`.

Which commands send an event is narrowed by
[ADR 0010](0010-telemetry-only-problems-and-installs.md).

## Amendment: no stored ID

[ADR 0011](0011-minimal-anonymous-telemetry.md) removes the persisted install
ID and person profiles, and narrows what is sent to Onboarding, errors, agent
App requests and approved Feedback.

## Amendment: the notice only in Onboarding

[ADR 0012](0012-telemetry-notice-only-in-onboarding.md) shows the notice only
on Onboarding's Welcome step, records nothing, and stops holding events back
until it was shown.
