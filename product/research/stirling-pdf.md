# Stirling PDF candidate (2026-09-29)

Status: discovery-only. The catalog already has a guided `stirling-pdf` manifest, but no Compose recipe or first-run setup adapter. Do not advertise it as an installable recipe or a native Homarr integration.

| Contract fact | Current source | Gate |
| --- | --- | --- |
| Upstream v3.0.0 is released | [Release](https://github.com/Stirling-Tools/Stirling-PDF/releases/tag/v3.0.0) | Verify an exact image tag and immutable digest on supported architectures; the official Compose example still uses floating `latest`. |
| Minimal container uses port 8080 and persistent `/configs`; expanded setup also mounts OCR, logs, and pipeline paths | [Official Docker guide](https://docs.stirlingpdf.com/Installation/Docker%20Install/) | Choose and pin the intended feature set and storage semantics before adding a recipe. |
| Fresh login defaults to `admin` / `stirling` and forces a password change | [Official security configuration](https://docs.stirlingpdf.com/Configuration/Security/System%20and%20Security/) | Confirm a deterministic private first-run rotation route on a fresh pinned image. Do not leave the default credential active. |
| Initial credentials can be configured with `SECURITY_INITIALLOGIN_USERNAME` and `SECURITY_INITIALLOGIN_PASSWORD` | [Official security configuration](https://docs.stirlingpdf.com/Configuration/Security/System%20and%20Security/) | These are plain environment values; the current project secret-file contract cannot safely pass them without a proved alternative. |
| A secured API uses `X-API-KEY`; user keys are created in Settings → Preferences → API Keys, or a global key can be configured | [Official API docs](https://docs.stirlingpdf.com/API/) | Verify key creation/extraction and a harmless authenticated read; do not infer a key from the UI route name. |
| Upstream's developer Compose example has a compound API-status plus login-page health check | [Developer guide](https://github.com/Stirling-Tools/Stirling-PDF/blob/main/DeveloperGuide.md) | The current Compose health contract supports only argv-form `CMD`; use a documented compatible check or report health unknown. |
| No current native Homarr mapping was found | [Homarr integration index](https://homarr.dev/docs/category/integrations/) | Offer only a separately verified generic app tile, not an integration or widget. |

Fresh-instance acceptance still needed: resolve a pinned v3.0.0 image, prove its platform; run an isolated loopback Compose with disposable `/configs`; rotate the initial password privately; prove the default login fails; obtain and verify a user API key; transform a synthetic PDF; restart the exact project and verify persistence. None of those live checks were run for this candidate.
