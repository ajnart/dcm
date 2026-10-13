## Blocked work

Blocks native NZBGet acceptance in #290 and draft #335. Keep Homarr Link preflight retryable Manual before creating or updating credentials; standalone NZBGet readiness and Link removal remain separate.

## Source-confirmed conditional logging risk

At both researched Homarr source `ebbd4876d25a51151444a009ab596e1154d62880` and recorded image OCI-source revision `3d4150e59f600876b7e308f857b2f21572b75348`, the NZBGet adapter embeds its username/password in the RPC path. A rejected request can retain that Address through the original `ResponseError` cause into downstream logs without credential-path redaction.

- [Adapter, lines 116–123](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/integrations/src/download-client/nzbget/nzbget-integration.ts#L116-L123): credential-bearing RPC path.
- [ResponseError, lines 5–10](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/common/src/errors/http/response-error.ts#L5-L10): retains response Address.
- [Integration settling, lines 39–44](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/api/src/settle-integrations.ts#L39-L44): logs rejected cause.
- [Error formatting, lines 22–53](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/core/src/infrastructure/logs/format/error.ts#L22-L53) and [metadata formatting, lines 9–14](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/core/src/infrastructure/logs/format/metadata.ts#L9-L14): recursively format causes and string properties without path redaction.

The [integration error decorator](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/integrations/src/base/errors/decorator.ts#L37-L145) sanitizes its own log copy, but rethrows the original cause; that does not protect downstream sinks. Ordinary connection-test 401/403 response payloads omit the Address and are not the established surface here.

The formatted text reaches the [Console transport](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/core/src/infrastructure/logs/transports/index.ts#L7). With Redis logging and log-view permission, it can also reach [Redis log history](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/core/src/infrastructure/logs/transports/redis-transport.ts#L28-L51), the [log API](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/packages/api/src/router/log.ts#L55-L60), and the [browser log terminal](https://github.com/homarr-labs/homarr/blob/3d4150e59f600876b7e308f857b2f21572b75348/apps/nextjs/src/app/%5Blocale%5D/manage/tools/logs/terminal.tsx#L159-L165).

Every cited file was independently compared byte-for-byte at the two source revisions. This is source evidence, not attestation of built-image contents. No real credentials, rejected-credential runtime probe, log read or observed live leak was involved. Dedicated blocker searches found no duplicate; #332 and #350 cover different boundaries.

## Resolution and acceptance

- Establish a supported upstream transport using HTTP Basic headers, or complete credential-path redaction across every downstream error/log sink. Do not invent a configuration switch, disable authentication, add a proxy framework, or substitute direct App data for native Homarr data.
- Reconcile any changed Homarr version/image with the shared compatibility contract and review its exact source before activation.
- Only then authorize bounded native data, negative-auth/privacy and rendered/lifecycle verification with owned disposable credentials and redacted evidence. Source agreement and a currently valid login are insufficient acceptance.

This ticket is private tracker coordination, not public disclosure, runtime permission, native completion or approval to publish private source.
