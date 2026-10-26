# Home Assistant traps

## Pitfalls

- Container mode does not provide the same add-on lifecycle as Home Assistant OS.
- Loopback-only bridge networking does not provide the LAN discovery behavior of the upstream host-network example.
- A smart-speaker experience also needs compatible audio hardware plus chosen wake-word, speech-to-text, and text-to-speech components; Home Assistant alone is not a physical speaker.
- Setup creates the owner, then saves the remaining wizard steps with the web UI's default choices: default core configuration, no analytics sharing, no integration picked. A wrong Admin login password is a failure; only a multi-factor prompt is Manual.
- Homarr uses a dedicated local-only Read Only user and a long-lived access token, never the onboarding authorization code, short-lived access token or OAuth refresh token. An existing conflicting identity or lost token remains a retryable Manual step; Setup never adopts or resets someone else's user.
- An Entity State widget needs an actual available entity. Setup discovers an existing Sun or text helper, or accepts an explicitly selected `homarr_entity_id`; it creates no synthetic device, guesses no sensor ID and enables no toggles or automations. See [the Home Assistant Link contract](../../home-assistant-homarr-contract.md).

## Security

- The bounded Compose recipe exposes only the web UI on loopback; approve LAN access, host networking, USB radios, microphones, speakers, and public exposure separately.
