# Telemetry and Feedback

Anonymous usage data helps improve self-host: which Apps people install, which
Setup steps are slow, and where commands fail. Release builds send it to EU
PostHog through `https://hog.ajnart.dev`. Development builds and CI send nothing.
There is no public dashboard yet; one may come later.

## What is sent

- A random install ID; self-host version, OS and architecture.
- Command names, outcomes and durations; Catalog App and Recipe IDs.
- The Access choice, using the same `home`/`local` IDs as `status --json`.
- Step IDs, outcomes and durations, including failed steps.
- Errors as PostHog `$exception` events: error type, fixed description, stable
  fingerprint, and in-app function names, module-relative files and line numbers.
  Panics are unhandled exceptions, flushed before the original panic continues.
- When you approve Onboarding's plan, one `onboarding` event: your Experience
  level (`new` or `advanced`), the glyph set (`nerd-font` or `simple`), whether
  you skipped the intro, whether the machine check warned (`ok` or `warn`) and
  how long Onboarding took. Nothing is sent if you quit before approving.
- Warning and error steps as fixed-text OTLP log records, with the step and
  command IDs. These are not App logs, raw error messages, or distributed traces.

PostHog person profiles group events by the random ID to count usage and return
visits. No names or emails are set. The one person property is `experience`
(`new` or `advanced`), set by the `onboarding` event and by
`self-host profile set experience`. GeoIP is
disabled; payloads contain no IP addresses or locations. Receiving network
infrastructure still sees the source IP. Server-side "Discard client IP data"
is a maintainer-controlled setting, not something the CLI verifies.

## What is never sent automatically

Host names, absolute file paths, typed inputs, secrets, App data, raw error or
panic text, IP addresses or locations. Stack files are relative to the Go
module, never to the machine where the binary was built or installed.

## The install ID

The ID is a randomly generated UUID, never derived from hardware or a host name.
It lives at `os.UserConfigDir()/self-host/telemetry-id`: normally
`~/.config/self-host/telemetry-id` on Linux and
`~/Library/Application Support/self-host/telemetry-id` on macOS. An older ID in
the Home folder (`~/.self-host/telemetry-id`, or the `SELF_HOST_HOME` override)
migrates automatically. The user-config copy takes precedence. Deleting or
reinstalling the Project or Home folder does not create another ID.

## Notice and controls

The first plain command or Onboarding announces Telemetry and links here, with
no button or toggle. Automatic usage is not sent before the notice is shown;
an initial `--json` command does not announce or send. Usage and logs wait at
most 500 ms and are dropped silently if the network is slow, without retries.

To turn all Telemetry and Feedback off, set either environment variable:

```sh
export SELF_HOST_NO_TELEMETRY=1
```

or `DO_NOT_TRACK=1`. Sending is always off when `CI` is set or the binary is a
development build. Tests use fake transports and never send real Telemetry.

## Feedback is deliberate

When an agent cannot fix a problem, `self-host feedback --message "…"` can send
a report after you see the exact text and agree. `--yes` is only for approval
already given in chat. Feedback is the one event carrying approved free text;
the agent must remove personal details and the CLI masks known secrets again.
`--app <id>` adds a short Debug report summary, never App logs.

Messages from `--message` or stdin are limited to 4096 bytes. Approved Feedback
uses the same endpoint, random ID and off switches, but waits up to five seconds
for delivery and reports failure. It does not require the usage notice because
you explicitly approved it. With Telemetry off it sends nothing, exits 1, and
points to [GitHub Issues](https://github.com/ajnart/selfhost-skills/issues).

## Technical sources

- [PostHog Go exception fields](https://github.com/posthog/posthog-go/blob/main/_autodocs/api-reference/error-tracking.md).
- [PostHog OTLP/HTTP logs endpoint and project-token authentication](https://posthog.com/docs/logs/installation/other).
- [PostHog reverse proxies](https://posthog.com/docs/advanced/proxy).

Logs use the proxy's documented `/i/v1/logs` path with a bearer project token.
Fake-transport tests verify the requests, not live proxy ingestion or server-side
IP discard. The key embedded in releases is a public write-only project token,
not a personal API key.
