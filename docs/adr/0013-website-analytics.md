---
status: accepted (replaces Cloudflare Web Analytics on self-host.fyi; ADR 0006 and ADR 0011 are about the CLI and stand)
---

# The website sends cookieless, anonymous usage events to our own PostHog

The maintainer wants to know which pages are read and which copy and Compose
Maker actions people use, without cookies, a banner or anything that follows a
person. Cloudflare Web Analytics counted page views only, and its beacon was a
remote script.

**Where it runs.** One module, `dcm/src/lib/analytics.ts`, bundled with the
site (`posthog-js` from npm, no remote script, `disable_external_dependency_loading`).
It is loaded on every page: the site, `/compose`, `/apps` and the docs. It
starts only in a browser whose hostname is exactly `self-host.fyi`: local
development, previews, forks and the `ghcr.io/ajnart/dcm` image send nothing.
Browsers that send Do Not Track send nothing.

**How.** EU PostHog through the same proxy as the CLI, `https://hog.ajnart.dev`
(the only `connect-src` the site allows), with the public write-only project
key from ADR 0006. `cookieless_mode: always`: no cookie, no local storage, no
stored ID; PostHog derives a daily-rotating hash server-side. `person_profiles:
never`, no autocapture, no session recording, no heatmaps, no surveys, no
feature flags. The maintainer must enable cookieless mode and "Discard client
IP data" in the PostHog project settings; nothing on the site verifies either.

**What is sent.** The automatic `$pageview` (URL, referrer, browser, OS and
screen size) and the named events listed on the
[telemetry page](https://self-host.fyi/telemetry#website): copies of install
commands and share links, Docker Compose Maker mode, selection, copy, download,
template, search, settings and Suggest container actions. Properties are
Catalog and Container ids, counts and fixed enums.

**What is never sent.** Typed text, the search query, Compose or `.env`
content, settings values, what you type on the Suggest container page, and anything about
the person or their machine.

A new event goes into `AnalyticsEvent`, which fixes its name and fields in the
type, and into the telemetry page. Sending more than ids, counts and fixed
values needs a new ADR.
