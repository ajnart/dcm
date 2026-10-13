# Emby traps

## Pitfalls

- License and hardware-transcoding features must be checked before selection.
- First-owner setup remains manual: complete the wizard with username admin and this project's generated password before headless setup. The official authenticated System/Configuration DTO exposes IsStartupWizardCompleted, but public system info does not. No safe unauthenticated untouched-state gate is established, so the adapter never reads or writes Startup/User or Startup/Complete. After exact admin-policy and completion readback, it creates and privately saves one project-labeled Auth/Keys token, never the login session token. Incomplete/duplicate/inactive inventories and ambiguous missing keys stop without replay. Fresh-image, media playback, restart persistence, and Homarr integration remain untested.
- The Homarr Link verifies authenticated Emby 4.10.0.40 and its dedicated key, then session/release source identity and supported item IDs. Media Releases requires a visible local user; absence remains Manual. Sessions without current playback and nullable timing remain valid. One central forced Stats refresh supplies the integral nonnegative `sessions` count in `count` units; independently cached native sessions are not required to match it. Source and focused HTTP fixtures do not establish rendered playback, licensing, hardware readiness or lifecycle acceptance.

## Security

- Keep administration private and review remote access.
