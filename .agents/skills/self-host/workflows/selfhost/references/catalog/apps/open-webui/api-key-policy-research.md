# Open WebUI v0.11.4 API-key policy

- Checked: `2026-10-04T02:33:29Z`
- Status: `pass`; official source only
- Version: release `v0.11.4`, commit `8bd8b4fac5e059578ac0c74b3c18d11139f88b7d`
- Browser/live deployment: not used
- Allowlist: `github.com`, `api.github.com`

## Pinned sources

- [v0.11.4 release](https://github.com/open-webui/open-webui/releases/tag/v0.11.4)
- [31-key map and read helper](https://github.com/open-webui/open-webui/blob/8bd8b4fac5e059578ac0c74b3c18d11139f88b7d/backend/open_webui/routers/auths.py#L104-L164)
- [GET/POST model and normalization](https://github.com/open-webui/open-webui/blob/8bd8b4fac5e059578ac0c74b3c18d11139f88b7d/backend/open_webui/routers/auths.py#L1204-L1296)
- [per-key defaults, reads, and upserts](https://github.com/open-webui/open-webui/blob/8bd8b4fac5e059578ac0c74b3c18d11139f88b7d/backend/open_webui/models/config.py#L101-L220)
- [boot defaults](https://github.com/open-webui/open-webui/blob/8bd8b4fac5e059578ac0c74b3c18d11139f88b7d/backend/open_webui/config.py#L3082-L3158)
- [API-key auth policy](https://github.com/open-webui/open-webui/blob/8bd8b4fac5e059578ac0c74b3c18d11139f88b7d/backend/open_webui/utils/auth.py#L509-L564), [key routes](https://github.com/open-webui/open-webui/blob/8bd8b4fac5e059578ac0c74b3c18d11139f88b7d/backend/open_webui/routers/auths.py#L1517-L1581), and [replacement storage](https://github.com/open-webui/open-webui/blob/8bd8b4fac5e059578ac0c74b3c18d11139f88b7d/backend/open_webui/models/users.py#L863-L887)

## Route, payload, and response

The auth router is mounted at `/api/v1/auths`. Both policy operations are on
`/api/v1/auths/admin/config`: authenticated-admin `GET` reads the complete
configuration; authenticated-admin `POST` bulk-upserts it and returns the same
complete current object after writing. There is no narrow policy PATCH.

The exact 31-field POST model is:

- Required booleans: `SHOW_ADMIN_DETAILS`, `ENABLE_SIGNUP`, `ENABLE_API_KEYS`,
  `ENABLE_API_KEYS_ENDPOINT_RESTRICTIONS`, `ENABLE_COMMUNITY_SHARING`,
  `ENABLE_MESSAGE_RATING`, `ENABLE_FOLDERS`, `ENABLE_AUTOMATIONS`,
  `ENABLE_CHANNELS`, `ENABLE_CALENDAR`, `ENABLE_MEMORIES`,
  `ENABLE_MEMORY_SYSTEM_CONTEXT`, `ENABLE_NOTES`, `ENABLE_USER_WEBHOOKS`,
  `ENABLE_USER_STATUS`.
- Required strings: `WEBUI_URL`, `API_KEYS_ALLOWED_ENDPOINTS`,
  `DEFAULT_USER_ROLE`, `DEFAULT_GROUP_ID`, `JWT_EXPIRES_IN`.
- Defaulted/nullable: `ADMIN_EMAIL=null`, `ENABLE_LOGIN_FORM=true`,
  `DEFAULT_INTERFACE_SETTINGS=null`, `I18N=null`,
  `FOLDER_MAX_FILE_COUNT=null`, `AUTOMATION_MAX_COUNT=null`,
  `AUTOMATION_MIN_INTERVAL=null`, `CHANNEL_MODEL_RESPONSE_MODE="thread"`,
  `PENDING_USER_OVERLAY_TITLE=null`, `PENDING_USER_OVERLAY_CONTENT=null`,
  `RESPONSE_WATERMARK=null`. Explicit `I18N=null` fails validation.

With environment inputs unset and default `WEBUI_AUTH=true`, the GET baseline is:

- `true`: admin details, login, signup, community sharing, message rating,
  folders, automations, calendar, memories, memory system context, notes, and
  user status.
- `false`: API keys, API-key endpoint restrictions, channels, and user webhooks.
- `null`: admin email. Empty objects: default interface settings and I18N.
- `"pending"`: default role; `"thread"`: channel mode; `"4w"`: JWT expiry.
- Empty strings: WebUI URL, allowed endpoints, default group, all three count/
  interval fields, both pending-user overlay fields, and response watermark.

Those are boot defaults, not a write template. `Config.get_many` returns stored
values before defaults, so the live GET is authoritative. A successful POST is
HTTP 200 with the complete 31-field post-write object, not a one-field response.

## Preservation-safe enable contract

1. Serialize against all other admin-config writers. Upstream has no revision,
   ETag, or compare-and-swap field.
2. GET with the verified administrator JWT. If `ENABLE_API_KEYS` is already
   `true`, do not POST.
3. Require exactly the 31 known keys and model-compatible types. Reject drift.
4. Reject a null/non-object `DEFAULT_INTERFACE_SETTINGS`. Require each count/
   interval field to be `""` or a nonzero JSON integer. POST maps every falsy
   value to `""` and every truthy value through `int(...)`; null, zero, numeric
   strings, and other strings therefore do not round-trip exactly.
5. Copy the snapshot, remove `I18N` and `ENABLE_LOGIN_FORM`, and change only
   `ENABLE_API_KEYS` to `true`. The route explicitly preserves those two fields
   when omitted. Any other omitted defaulted field is still dumped and written
   with its model default. Omitting I18N also avoids translation normalization.
6. Persist exact canonical preimage/postimage digests and a before-send
   once-only attempted marker. POST once. Accept only the exact expected
   postimage in the response and a confirming GET.

Invalid default roles, channel modes, and JWT-expiry strings are silently left
unchanged, not rejected; exact postimage comparison remains mandatory. Upsert
also changes timestamps for every included key even when its value is unchanged.

For timeout, disconnect, or lost response, never repeat POST. One GET may
reconcile only an exact expected postimage as success. Exact preimage or any
other state remains unresolved for operator reconciliation; the attempted marker
permanently blocks automatic replay. Replaying the stale bulk body could erase a
concurrent administrator change.

## Security and key replay effects

Enabling the global switch immediately makes already stored keys eligible for
authentication. Administrators bypass the per-user `features.api_keys`
permission, but no key bypasses preserved endpoint restrictions. Non-admin users
need both the global switch and that permission.

`POST /api/v1/auths/api_key` deletes the owner's existing row before inserting
and returning a new `sk-` plus hyphenless UUID4 key. Replaying it rotates and
invalidates the first result. `GET` returns the current plaintext owner key or
404; reconcile an ambiguous creation by GET, never by another POST. API-key
authentication also updates account last-active state.

Redaction scan applied; sensitive values found: `0`. No private data, raw API
payload, authentication, Docker, browser, or live-service evidence was used.
Confidence is high for pinned source behavior only.
