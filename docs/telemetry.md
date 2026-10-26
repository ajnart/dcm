# Telemetry and Feedback

Anonymous usage data helps improve self-host: which Apps people install, which
Setup steps are slow, and where commands fail. Release builds send it to EU
PostHog through `https://hog.ajnart.dev`. Development builds and CI send nothing.
There is no public dashboard yet; one may come later.

## What it is for

The data is used only to see how self-host is used, such as which Apps people
install and where Setup and Onboarding break, and to debug failures. Only the
maintainers see it. It is never sold, rented or shared with third parties, and
never used for advertising.

## What is sent

Only these four things. A command that succeeds sends nothing.

- **An onboarding summary**, when you approve Onboarding's plan: your Experience
  level (`new` or `advanced`), the glyph set (`nerd-font` or `simple`), whether
  you skipped the intro, whether the machine check warned (`ok` or `warn`), how
  long Onboarding took, and the Catalog App and Recipe IDs and Access choice
  (`home` or `local`) you picked. Nothing is sent if you quit before approving.
- **Errors**, when a command fails or ends incomplete: the command name,
  duration, Catalog App and Recipe IDs, step IDs, outcomes and durations, and a
  PostHog `$exception` with the error type, a fixed description, a stable
  fingerprint, and in-app function names, module-relative files and line
  numbers. Panics are unhandled exceptions, flushed before the original panic
  continues. Warning and error steps also send fixed-text OTLP log records
  with the step and command IDs. These are not App logs, raw error messages or
  distributed traces.
- **Agent App requests.** When an agent is asked for an App that is not in the
  Catalog, it runs `self-host apps request "<name>"`, which sends the App's name
  (lowercase, at most 64 characters) and the host of its homepage, never a path
  or query. A person asks for an App by opening a
  [GitHub issue](https://github.com/ajnart/self-host/issues) instead.
- **Feedback**, only after you see the text and agree (see below).

Each event also carries the self-host version, OS and architecture. Events are
anonymous: PostHog keeps no person profile and no person properties. GeoIP is
disabled; payloads contain no IP addresses or locations. Receiving network
infrastructure still sees the source IP. Server-side "Discard client IP data"
is a maintainer-controlled setting, not something the CLI verifies.

## This website

self-host.fyi counts page views with Cloudflare Web Analytics: no cookies, no
fingerprinting, no personal data, and nothing shared with the CLI telemetry
above.

## What is never sent automatically

Host names, absolute file paths, typed inputs, secrets, App data, raw error or
panic text, IP addresses or locations. Stack files are relative to the Go
module, never to the machine where the binary was built or installed.

## There is no stored ID

Nothing identifies you or your machine, and nothing is saved. Each run uses a
random value held in memory and thrown away when the command ends, so one run
cannot be linked to another. Older versions that saved a `telemetry-id` file no
longer read it; you can delete it.

## Notice and controls

The first plain command or Onboarding announces Telemetry and links here, with
no button or toggle. Automatic usage is not sent before the notice is shown;
an initial `--json` command does not announce or send. Usage and logs wait at
most 500 ms and are dropped silently if the network is slow, without retries.

To turn all Telemetry and Feedback off, set either environment variable:

```sh
export SELF_HOST_NO_TELEMETRY=1
```

or `DO_NOT_TRACK=1`. Set to 1 (or true); any value except empty, 0 or false turns it off. Sending is always off when `CI` is set or the binary is a
development build. Tests use fake transports and never send real Telemetry.

## Feedback is deliberate

When an agent cannot fix a problem, `self-host feedback --message "…"` can send
a report after you see the exact text and agree. `--yes` is only for approval
already given in chat. Feedback is the one event carrying approved free text;
the agent must remove personal details and the CLI masks known secrets again.
`--app <id>` adds a short Debug report summary, never App logs.

Messages from `--message` or stdin are limited to 4096 bytes. Approved Feedback
uses the same endpoint, anonymity and off switches, but waits up to five seconds
for delivery and reports failure. It does not require the usage notice because
you explicitly approved it. With Telemetry off it sends nothing, exits 1, and
points to [GitHub Issues](https://github.com/ajnart/self-host/issues).

## Technical sources

- [PostHog Go library](https://posthog.com/docs/libraries/go).
- [PostHog OTLP/HTTP logs endpoint and project-token authentication](https://posthog.com/docs/logs/installation/other).
- [PostHog reverse proxies](https://posthog.com/docs/advanced/proxy).

Logs use the proxy's documented `/i/v1/logs` path with a bearer project token.
Fake-transport tests verify the requests, not live proxy ingestion or server-side
IP discard. The key embedded in releases is a public write-only project token,
not a personal API key.
