# Docmost headless bootstrap/API evidence

Research date: 2026-09-25. Source-only review; no Docmost instance, Docker stack, credentials, or browser session was accessed.

## Version and evidence boundary

- Upstream currently redirects its latest release page to **v0.96.0**, source commit [`9b3e5dd3dc21588fa20c02c5b8646d2f46ee73af`](https://github.com/docmost/docmost/releases/tag/v0.96.0). The setup CLI in this checkout accepts `docker.io/docmost/docmost:0.96.0@sha256:<64 hex>`; the digest is supplied as deployment input rather than hard-coded in the CLI ([`packages/cli/src/docmost.ts:240`](../packages/cli/src/docmost.ts)).
- Findings below use that exact upstream commit. They establish route and guard behavior in source, **not live runtime acceptance**.
- Context7 lookup was attempted as required, but returned “Monthly quota reached.” To retry later, use `npx ctx7@latest login` or set `CONTEXT7_API_KEY`; the sources below are direct Docmost documentation and tagged source, not Context7 output.

## Verdict

**Source-level: yes.** The pinned v0.96.0 server has HTTP handlers for one-time owner setup, password login, page create/edit, and file upload. A non-browser HTTP client can retain and resend the session cookie; the inspected flow has no browser-only dependency.

**Supported/stable API contract: no for Community.** Docmost’s current API guide says its REST API requires an active Enterprise license. The v0.96.0 page and attachment handlers are ordinary session-authenticated server routes; the file-upload route is not listed as a public API operation. Treat this as a version-specific implementation adapter, not supported Community API automation. The live behavior was not exercised.

## v0.96.0 route behavior

| Step | Source behavior |
|---|---|
| First owner/workspace | `POST /api/auth/setup`, body with `name`, `email`, `password`, optional `workspaceName` and `hostname`. `SetupGuard` denies cloud and rejects setup once a workspace exists. It creates an owner and workspace; workspace creation also creates the default `General` space and records its `defaultSpaceId`. The response sets the session cookie. Repeating setup after initialization returns 403. |
| Login | `POST /api/auth/login`, body `{ email, password }`; password login creates a session and sets the same cookie. Workspace/domain resolution must target the configured self-hosted workspace. SSO enforcement can reject password login; Enterprise MFA can add a challenge path. |
| Page create | `POST /api/pages/create`, authenticated, requires `spaceId`; optional `content` and `format` (`json`, `markdown`, or `html`). The setup-created `General` space provides the initial target. |
| Page edit | `POST /api/pages/update`, authenticated, requires `pageId`; content changes require `content`, `operation` (`append`, `prepend`, or `replace`), and `format`. The server applies content through its collaboration/Yjs gateway. |
| Attachment upload | `POST /api/files/upload`, authenticated multipart upload with a file and `pageId`. It verifies the page exists and that the user can edit it; the response contains attachment metadata and a URL. The endpoint is implemented in the application controller but is absent from the public API guide/reference. |

Tagged source: [`auth.controller.ts`](https://github.com/docmost/docmost/blob/9b3e5dd3dc21588fa20c02c5b8646d2f46ee73af/apps/server/src/core/auth/auth.controller.ts), [`setup.guard.ts`](https://github.com/docmost/docmost/blob/9b3e5dd3dc21588fa20c02c5b8646d2f46ee73af/apps/server/src/core/auth/guards/setup.guard.ts), [`signup.service.ts`](https://github.com/docmost/docmost/blob/9b3e5dd3dc21588fa20c02c5b8646d2f46ee73af/apps/server/src/core/auth/services/signup.service.ts), [`workspace.service.ts`](https://github.com/docmost/docmost/blob/9b3e5dd3dc21588fa20c02c5b8646d2f46ee73af/apps/server/src/core/workspace/services/workspace.service.ts), [`page.controller.ts`](https://github.com/docmost/docmost/blob/9b3e5dd3dc21588fa20c02c5b8646d2f46ee73af/apps/server/src/core/page/page.controller.ts), [`page.service.ts`](https://github.com/docmost/docmost/blob/9b3e5dd3dc21588fa20c02c5b8646d2f46ee73af/apps/server/src/core/page/services/page.service.ts), and [`attachment.controller.ts`](https://github.com/docmost/docmost/blob/9b3e5dd3dc21588fa20c02c5b8646d2f46ee73af/apps/server/src/core/attachment/attachment.controller.ts).

## First-owner/login request shape and safe assertions

- Setup requires `name`, `email`, and `password`; `workspaceName` and `hostname` are optional. The setup DTO constrains name to 1–50 characters, email to a valid email, password to 8–70 characters, workspaceName to 1–50, and hostname to 4–50. No credential values are included here.
- Setup success is HTTP 200 with the global envelope `{ data: <workspace>, success: true, status: 200 }` and `Set-Cookie`. The returned workspace has nonsecret `id`, `name`, and `defaultSpaceId` fields suitable for narrow assertions; do not log the full workspace object.
- Fresh login is `POST /api/auth/login` with required `email` and `password`. On the ordinary password-success path the controller sets the cookie and returns no value; safely assert HTTP 200, the success/status envelope if emitted, and cookie-jar presence without printing the cookie or relying on a `data` field.
- There is no setup-state GET endpoint in the pinned auth controller/API routes. `POST /api/auth/setup` itself is the state check: it succeeds only before workspace creation and returns 403 after setup (or for cloud).
- No endpoint-level `Origin` check or CSRF token/header is present. `main.ts` excludes setup from the workspace-id pre-handler and calls `enableCors()` without explicit origin options. A raw HTTP client does not need a browser `Origin` header based on the route code; browser cross-origin behavior was not tested.

## Session and CSRF mechanics

- Successful setup/login set `authToken` as an `HttpOnly`, `SameSite=Lax`, `Path=/` cookie; `Secure` is enabled when the server considers the configured URL HTTPS. A raw HTTP client can keep the `Set-Cookie` value in a cookie jar without exposing it to application JavaScript.
- The JWT strategy reads `req.cookies.authToken` first, then an `Authorization: Bearer` token. Page and upload routes are guarded by that strategy.
- No CSRF token/header is used in these route paths. A source search for `csrf`/`xsrf` under the v0.96.0 server/client source found no implementation; cookie SameSite behavior is the relevant browser-side protection. The setup response is the workspace object inside the global envelope, while password login returns no controller value on its non-MFA path.

Sources: [`auth.controller.ts`](https://github.com/docmost/docmost/blob/9b3e5dd3dc21588fa20c02c5b8646d2f46ee73af/apps/server/src/core/auth/auth.controller.ts), [`jwt.strategy.ts`](https://github.com/docmost/docmost/blob/9b3e5dd3dc21588fa20c02c5b8646d2f46ee73af/apps/server/src/core/auth/strategies/jwt.strategy.ts), [`main.ts`](https://github.com/docmost/docmost/blob/9b3e5dd3dc21588fa20c02c5b8646d2f46ee73af/apps/server/src/main.ts).

## Stability and recommendation

- The official [API guide](https://docmost.com/docs/user-guide/api) marks REST API access as Enterprise-only and requires an active license. The current [API reference](https://docmost.com/api-docs) is OpenAPI v1.1.0, while the application pinned here is v0.96.0; do not infer that the latest reference is a compatibility contract for the pinned server.
- v0.96.0’s cookie-backed handlers are usable for a controlled, source-pinned headless adapter, but route DTOs, multipart parsing, session policy, and response shapes can change without the guarantees of the documented Enterprise API. The attachment upload route is especially fragile because it is not part of that public API surface.
- Recommendation: retain browser-based first-owner acceptance as the supported setup/verification boundary. If a headless Community flow is still needed, treat it as a pinned-version experiment and add runtime acceptance against an isolated disposable instance before relying on it; do not claim this source review proves it works. For supported API automation, use an Enterprise license and its documented API credentials.
