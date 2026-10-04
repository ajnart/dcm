# Emby 4.10.0.40 bootstrap contract

Inspected 2026-09-30 without starting Docker or a browser. The official
`docker.io/emby/embyserver:4.10.0.40` linux/amd64 manifest resolves to
`sha256:ee12307d15ab8927c05fb4c4d9818cd2bf199b79b907018806a69fa57eb307b1`.
Its server/UI layer is
`sha256:54cc8fac99c4c8fbdc233237327acc2a4afcf26a02ca0aadd7c4091cf2a19e52`;
the downloaded compressed bytes matched that digest. Paths below are within
that layer, under `system/dashboard-ui/`.

## Established requests

- `wizard/wizarduserpage.js` reads `GET Startup/User`, taking `user.Name`,
  then sends `POST Startup/User` with `Name` and `Password`.
- `wizard/wizardfinishpage.js` sends a bodyless `POST Startup/Complete` and
  then navigates to login. It does not independently read completion state.
- `modules/emby-apiclient/apiclient.js` authenticates with
  `POST Users/authenticatebyname`, fields `Username` and `Pw`.
- `modules/emby-apiclient/fetchhelper.js` serializes those object bodies as
  `application/x-www-form-urlencoded; charset=UTF-8`, not JSON.
- `apikeys/apikeys.js` invokes `createApiKey({App: value})`;
  `apiclient.js` sends a bodyless `POST Auth/Keys?App=<label>`, then inventories
  keys using `GET Auth/Keys`. It consumes `Items`, `AppName`, and `AccessToken`.
  This is a distinct persistent-key UI, not the authentication session token.

These are pinned shipped-client contracts, not a vendor promise that startup
API automation is supported. HTTP success status numbers,
pre-wizard authorization rules, complete response DTOs, and
server-side transitions were not established by these client modules.

## Remaining adapter blocker

Do not copy Jellyfin's `StartupWizardCompleted` public-info gate. Emby's
[official public system-info response](https://dev.emby.media/reference/RestAPI/SystemService/getSystemInfoPublic.html)
lists only addresses, `ServerName`, `Version`, and `Id`; it provides no wizard
completion field. The pinned client contains no `StartupWizardCompleted` or
`IsStartupWizardCompleted` reference. The pinned server binaries contain an
`IsStartupWizardCompleted` symbol, but a symbol alone does not prove an
unauthenticated read route, DTO ownership, or serialization contract.

A fully automatic first-owner adapter still needs pinned server-side evidence for a read-only
untouched/partial/completed discriminator before the first startup write,
and independent completion readback. It also
needs an initial authorization contract. Preserve manual first-owner setup:
neither route names nor a successful client navigation justify startup writes.
No account, key, or runtime was created during this audit.

## 2026-10-03 authenticated post-bootstrap contract

The current vendor reference documents
[GET System/Configuration](https://dev.emby.media/reference/RestAPI/ConfigurationService/getSystemConfiguration.html)
with `IsStartupWizardCompleted`. This is authenticated, unlike the missing
public-info gate: it supports independent **post-login** completion readback,
not a fresh-instance discriminator. The vendor API index exposes no Startup
service reference. Absence from that index is not proof that the routes do not
exist or that a particular anonymous request is safe.

[AuthenticateByName](https://dev.emby.media/reference/RestAPI/UserService/postUsersAuthenticatebyname.html)
documents `Username`/`Pw`, `AccessToken`, `ServerId`, and the administrator's
`UserDto`. The [AuthenticationResult class](https://dev.emby.media/reference/pluginapi/MediaBrowser.Controller.Authentication.AuthenticationResult.html)
clarifies that `User` is one object, despite an erroneous array annotation in
the REST table. [GET Users/{Id}](https://dev.emby.media/reference/RestAPI/UserService/getUsersById.html)
independently exposes `Id`, `ServerId`, `Name`, `HasConfiguredPassword`, and
`Policy.IsAdministrator`/`IsDisabled`. Emby IDs are opaque strings, not a
Jellyfin GUID requirement.

[GET Auth/Keys](https://dev.emby.media/reference/RestAPI/SessionsService/getAuthKeys.html)
and [POST Auth/Keys](https://dev.emby.media/reference/RestAPI/SessionsService/postAuthKeys.html)
require administrator authentication; creation has the exact `App` query
parameter. The REST reference leaves the response content unspecified. The
previous pinned client inventory evidence supplies `Items`, `AppName`, and
`AccessToken`; the vendor
[AuthenticationInfo class](https://dev.emby.media/reference/pluginapi/MediaBrowser.Controller.Security.AuthenticationInfo.html)
also documents these properties and `IsActive`. The adapter additionally
requires `TotalRecordCount === Items.length` to fail closed on truncated or
unknown inventories; this requirement has no fresh-image acceptance evidence.

`setup.ts` therefore supports only a manually completed owner using the saved
generated password. It verifies login, exact enabled admin policy, and wizard
completion before checkpointing and creating a labeled durable key. An
uncertain create is reconciled by inventory, never resent; captured bytes are
saved privately and checkpointed before the next protected request. No public
startup field, startup configuration payload, GET Startup/User behavior, or
automatic first-owner transition is invented. The focused fixture proves these
local guards and replay rules, not actual Emby startup or restart acceptance.

## 2026-10-03 pinned storage inspection

The same digest-verified image layer was inspected as .NET metadata and IL,
without executing the server. `Emby.Api.dll` has SHA-256
`a8945acd065e0094f254754c81ed371aedaf8ea6479f2cdfb5b7f50e48d13f16`;
`Emby.Server.Implementations.dll` has SHA-256
`eb93fcd87f3b9221398aa4f0458446a7bcd636b1e3626c4a496508dd08a48eb1`.

- `BaseApplicationPaths.get_SystemConfigurationFilePath` (RVA `0x6b248`)
  combines the program-data path, `config`, and `system.xml`.
  `BaseConfigurationManager.SaveConfiguration` (RVA `0x6b5e4`) serializes the
  common configuration to that exact file. The startup-complete handler
  (RVA `0x55fb`) sets `IsStartupWizardCompleted`, calls `SetOptimalValues`,
  and saves configuration.
- `SqliteUserRepository` constructor (RVA `0x67ef0`) uses
  `<programdata>/data/users.db`. Its initialization (RVA `0x67f88`) creates
  `LocalUsersv2 (Id INTEGER PRIMARY KEY AUTOINCREMENT, guid BLOB NOT NULL,
  data TEXT NOT NULL) STRICT`, plus `UserSettingsKeys` and `UserSettings`.
  `RetrieveAllUsers` (RVA `0x68248`) selects `id,guid,data` from `LocalUsersv2`.
- `UserManager.Initialize` (RVA `0x37701`) calls `LoadUsers` (RVA `0x37c68`).
  An empty repository creates a user named after `Environment.UserName`,
  falling back to `MyEmbyUser`, and assigns administrator policy. Thus a
  running untouched server already has an administrator: an empty database
  or an administrator count is not a valid fresh-wizard discriminator.
- `StartupWizardService.Get(GetStartupUser)` (RVA `0x5688`) calls
  `GetUserList` with limit one and returns that user's name. The inspected
  handler contains no create/save/password mutation. Its POST state machine
  (RVA `0x163cc`) selects the same first user, changes its name, updates it,
  and then changes its password. These are separate writes; an interrupted
  POST can leave a partially renamed owner.

These facts do not establish a safe storage probe. The image startup mapping
from `/config` to program data, the complete persisted user/password and
policy schema, the distinction between the auto-created default and an
already modified owner, and pre-wizard authorization-filter behavior still
need pinned proof. A raw SQLite `data` value may contain credentials and must
never enter container stdout or ordinary evidence. Any future probe must
return only bounded non-secret identity/state, read the live SQLite WAL
consistently without creating files, and reconcile partial startup writes
through existing checkpoints. No storage command or startup write has been
added to the adapter on incomplete evidence.

## File integrity

| Layer-relative UI file | SHA-256 |
| --- | --- |
| `wizard/wizarduserpage.js` | `d821a82185f079566d55b0ee5b8c87ece130805a58513697ae399c8def6bf4f4` |
| `wizard/wizardstart.js` | `e8e7d9de0ddd376fea1507657031dc281be30788442f30dd4bb615b8aed27127` |
| `wizard/wizardremoteaccess.js` | `cf2588ff947c7f2470bbfbc32de19a00d39261c02c18b847acf20f64078b373f` |
| `wizard/wizardfinishpage.js` | `411d1ad6d202d4b8880036ad5c2d4a34315a7cff7324bd1ed12bf96cfda508ae` |
| `modules/emby-apiclient/apiclient.js` | `fcf6572576a2ba51af2b9a30eac345dde186511be47a03abe6626607ff11be46` |
| `modules/emby-apiclient/fetchhelper.js` | `a0904019105e7510e30e5c9abd13e73e8007547d3986dff1dcd1f10ef0a4e35d` |
| `apikeys/apikeys.js` | `6e7fad4b3a15770ab780b031afc87f7685339713957a378c71ad038a447156fd` |

## 2026-10-04 current official-evidence review

Emby's current installation guide still describes the first-run sequence as a
browser wizard: create the initial username/password, configure libraries and
remote access, accept the terms, complete the wizard, and then sign in. It does
not document a supported headless bootstrap or a read-only state endpoint
([Installation](https://emby.media/support/articles/Installation.html)). The
current users guide likewise says the setup wizard creates the administrator;
it does not define an API discriminator for untouched, partially updated, and
completed installations
([Users](https://emby.media/support/articles/Users.html)).

The official but unversioned `MediaBrowser/Emby` source confirms the historical
route shapes `GET/POST /Startup/Configuration`, `GET/POST /Startup/User`, and
`POST /Startup/Complete`, with service-level
`Authenticated(AllowBeforeStartupWizard = true, Roles = "Admin")`. Its startup
configuration body is `UICulture`, `MetadataCountryCode`, and
`PreferredMetadataLanguage`; its startup-user body is `Name` plus
`ConnectUserName`; completion has no body DTO. That old implementation changes
the first user's name but contains no password write, so it is not the pinned
4.10.0.40 password contract
([unversioned StartupWizardService.cs](https://github.com/MediaBrowser/Emby/blob/master/MediaBrowser.Api/StartupWizardService.cs)).
The pinned shipped client remains the authority for 4.10.0.40 here: it sends
form-encoded `Name` and `Password` to `POST Startup/User`, and a bodyless
`POST Startup/Complete`. Its first wizard page obtains
`GET Startup/Configuration`, changes only `UICulture`, and posts the complete
returned object to `POST Startup/Configuration`; this does not establish that
the historical three-field DTO is exhaustive in 4.10.0.40. The pinned
`wizardremoteaccess.js` sends `POST Startup/RemoteAccess` with only
`EnableAutomaticPortMapping` from its checkbox; that client request alone does
not prove the server's remote-access defaults or authorize exposure changes.
Both additional client files are identified in the integrity table above.
The historical
source may corroborate route names and configuration fields only; it cannot
establish pinned authorization behavior, status codes, response bodies, or
atomicity.

After manual completion, the current vendor reference supports the existing
flow: `POST Users/AuthenticateByName` takes `Username` and `Pw` and returns an
`AccessToken`, `ServerId`, and `User`; `GET System/Configuration` exposes
`IsStartupWizardCompleted`; and `GET/POST Auth/Keys` are administrator-only,
with `POST` taking the `App` query parameter
([AuthenticateByName](https://dev.emby.media/reference/RestAPI/UserService/postUsersAuthenticatebyname.html),
[system configuration](https://dev.emby.media/reference/RestAPI/ConfigurationService/getSystemConfiguration.html),
[list keys](https://dev.emby.media/reference/RestAPI/SessionsService/getAuthKeys.html),
[create key](https://dev.emby.media/reference/RestAPI/SessionsService/postAuthKeys.html)).
Because key creation's documented response content is unspecified, an uncertain
create must still be reconciled by authenticated inventory and must never be
blindly replayed; the pinned client supplies the `Items`, `AppName`, and
`AccessToken` inventory shape, while the current vendor class documents those
properties and `IsActive`
([AuthenticationInfo](https://dev.emby.media/reference/pluginapi/MediaBrowser.Controller.Security.AuthenticationInfo.html)).

The precise blocker is unchanged: no current official source proves a
non-mutating pinned-4.10.0.40 observation that uniquely separates untouched,
partially renamed/password-written, and completed state before any startup
write, nor the exact pre-wizard authentication gate and response contract for
each startup route. Even the current public-system-information reference labels
`GET System/Info/Public` as requiring user authentication while omitting any
wizard-completion field, so neither the route's name nor its present
documentation supplies that gate
([public system information](https://dev.emby.media/reference/RestAPI/SystemService/getSystemInfoPublic.html)).
`GET Startup/User` only reveals the first user's name in
both the pinned client/IL evidence and the historical source; completion is
currently proven readable through authenticated `System/Configuration`, not
through a proven anonymous discriminator. Therefore a
headless first-owner implementation remains unsafe. Keep bootstrap manual, then
use login, authenticated completion readback, uniquely labeled key inventory,
and checkpointed lost-response reconciliation as implemented in `setup.ts`.

For any future startup implementation, an uncertain `Startup/User` response
cannot be reconciled from the returned name alone: the pinned IL above shows
separate name and password writes. Login with the exact checkpointed intended
password plus enabled-administrator/identity readback can prove those desired
credentials, but failure cannot prove that neither write happened and must not
trigger an automatic repeat. An uncertain `Startup/Complete` needs authenticated
`IsStartupWizardCompleted === true` readback; a false value or unavailable login
is not authority to resend it. These are conservative recovery requirements,
not a newly proven startup protocol. Full configuration/user/key payloads must
not enter ordinary evidence or stdout.

Research status: **blocked** for automatic first-owner bootstrap; high confidence
in the documented post-login contract and rechecked pinned client bytes, no
live acceptance. Sources above are official/vendor sources; the GitHub server
source is explicitly historical, not pinned evidence. Context7's current
`/websites/dev_emby_media_doc` lookup returned authentication material, not a
startup discriminator. Public documentation reads succeeded, but browser link
envelopes/final redirects were not captured: link-envelope validation remains
blocked by this task's no-browser boundary. No browser session was opened
(cleanup not applicable); no runtime, private files, tests, or container were
accessed. Redaction: no private payload captured, count 0. The existing layer
digest is prior evidence, not a fresh registry verification on 2026-10-04.
