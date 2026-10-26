# Emby traps

## Pitfalls

- License and hardware-transcoding features must be checked before selection.
- First-owner setup is headless, as for Jellyfin: Setup posts Startup/Configuration, Startup/User, Startup/RemoteAccess and Startup/Complete with the Project Admin login while the wizard is open. Verified on emby/embyserver 4.10.2.0: once the wizard is complete every /Startup endpoint answers 401, so an existing owner cannot be reset or replaced. Setup only drives Startup when GET Startup/Configuration answers 200; any other status stays Manual. Sign-in (AuthenticateByName) and the authenticated IsStartupWizardCompleted readback prove the result. After exact admin-policy and completion readback, it creates and privately saves one project-labeled Auth/Keys token, never the login session token. Incomplete/duplicate/inactive inventories and ambiguous missing keys stop without replay. Fresh-image, media playback, restart persistence, and Homarr integration remain untested.
- The Homarr Link verifies authenticated Emby 4.10.0.40 and its dedicated key, then session/release source identity and supported item IDs. Media Releases requires a visible local user; absence remains Manual. Sessions without current playback and nullable timing remain valid. One central forced Stats refresh supplies the integral nonnegative `sessions` count in `count` units; independently cached native sessions are not required to match it. Source and focused HTTP fixtures do not establish rendered playback, licensing, hardware readiness or lifecycle acceptance.

## Security

- Keep administration private and review remote access.
