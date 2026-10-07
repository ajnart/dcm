# Emby traps

## Pitfalls

- License and hardware-transcoding features must be checked before selection.
- First-owner setup remains manual: complete the wizard with username admin and this project's generated password before headless setup. The official authenticated System/Configuration DTO exposes IsStartupWizardCompleted, but public system info does not. No safe unauthenticated untouched-state gate is established, so the adapter never reads or writes Startup/User or Startup/Complete. After exact admin-policy and completion readback, it creates and privately saves one project-labeled Auth/Keys token, never the login session token. Incomplete/duplicate/inactive inventories and ambiguous missing keys stop without replay. Fresh-image, media playback, restart persistence, and Homarr integration remain untested.

## Security

- Keep administration private and review remote access.
