# Home Assistant traps

## Pitfalls

- Container mode does not provide the same add-on lifecycle as Home Assistant OS.
- Loopback-only bridge networking does not provide the LAN discovery behavior of the upstream host-network example.
- A smart-speaker experience also needs compatible audio hardware plus chosen wake-word, speech-to-text, and text-to-speech components; Home Assistant alone is not a physical speaker.
- Shared setup verifies the owner and integration token, but reports unfinished core_config, analytics and integration wizard steps separately. Core-config completion starts upstream provider flows; it is not silently approved by account creation or Homarr publication.

## Security

- The bounded Compose recipe exposes only the web UI on loopback; approve LAN access, host networking, USB radios, microphones, speakers, and public exposure separately.
