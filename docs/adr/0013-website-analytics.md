---
status: accepted (replaces Cloudflare Web Analytics on self-host.fyi; ADR 0006 and ADR 0011 are about the CLI and stand)
---

# The website sends cookieless, anonymous usage events to our own PostHog

The maintainer wants to know which pages are read and which copy and Compose
Maker actions people use, without cookies, a banner or anything that follows a
person. Cloudflare Web Analytics counted page views only, and its beacon was a
remote script.

**Where it runs.** One module, `site/src/lib/analytics.ts` (Apache-2.0),
bundled with the site (`posthog-js` from npm, no remote script,
`disable_external_dependency_loading`). It is loaded on every page: the site,
`/compose`, `/apps` and the docs. It starts only in a browser whose hostname is
exactly `self-host.fyi`: local development, previews, forks and the
`ghcr.io/ajnart/dcm` image send nothing. Browsers that send Do Not Track send
nothing.

DCM (`dcm/`) never imports PostHog. It reports through
`dcm/src/lib/track.ts`, a seam with the `DcmEvent` type and a `track()` that
calls whichever listener the host registered. The site registers one in
`initAnalytics`; without a listener, which is every non-production host, the
call does nothing. A fork that embeds DCM chooses its own listener or none.

**How.** EU PostHog through the same proxy as the CLI, `https://hog.ajnart.dev`
(the only `connect-src` the site allows), with the public write-only project
key from ADR 0006. `cookieless_mode: always`: no cookie, no local storage, no
stored ID; PostHog derives a daily-rotating hash server-side. `person_profiles:
never`, no autocapture, no session recording, no heatmaps, no surveys, no
product tours, no conversations, no exception or performance capture, no
saved campaign parameters, no feature flags. The maintainer must enable
cookieless mode in the PostHog project settings; nothing on the site verifies
it. The site does not depend on, or claim, any server-side IP setting: the
request carries the visitor's IP address like every request, and the posthog-js
`ip` option has no effect.

**What is sent.** The automatic `$pageview` and the named events listed on the
[telemetry page](https://self-host.fyi/telemetry#website): copies of install
commands and share links, Docker Compose Maker mode, selection, copy, download,
template, search, settings and Suggest container actions. Event properties are
Catalog and Container ids, counts and fixed enums. posthog-js adds its own
properties to every event: the page URL, referrer and path, browser, OS, device
type, viewport and screen size, time zone, language and SDK version. A
`before_send` hook removes the query string and fragment from every URL, referrer
and path property, including the `$set` and `$set_once` copies, so a share link
or a search typed into the address bar never leaves the browser.

**What is never sent.** Typed text, the search query, Compose or `.env`
content, settings values, what you type on the Suggest container page, query
strings and fragments, and anything that identifies the person beyond the
browser properties above.

A new site event goes into `SiteEvent` in `site/src/lib/analytics.ts`, and a new
Docker Compose Maker event into `DcmEvent` in `dcm/src/lib/track.ts`; the type
fixes its name and fields. Both go into the telemetry page. Sending more than
ids, counts and fixed values needs a new ADR.
