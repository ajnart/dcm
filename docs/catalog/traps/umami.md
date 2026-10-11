# Umami traps

## Pitfalls

- Auxiliary Compose services use App-owned names: `umami-db`. Keep these names in connection settings and dependencies; persistent data paths stay unchanged.
- Self-hosting does not remove consent, retention, or data-governance duties.
- The seeded administrator is reachable on the selected loopback origin until the separately approved password-rotation setup completes; never expose it more broadly before rotation is verified.
- Setup also prepares a separate `view-only` Homarr account and an empty owned `self-host.invalid` fixture website. It installs no tracking script, records no visits, and never adopts a matching manual account or website.
- Retry existing Projects with `self-host setup umami`, then `self-host setup homarr`. Lost saved passwords and changed ownership require an explicit review; Setup does not reset a valid account or transfer a person's website.
- Homarr's self-hosted API Address ends in `/api`; its browser Address does not. The native Umami chart needs the recorded website identifier. Homarr 2.4.1 has no Umami Stats provider.
- Empty counts must be explicit authenticated numbers. Homarr's active-visitors endpoint can turn failures into zero, so the Link also checks Umami directly. See the [source-only contract and remaining proof gaps](../../homarr-umami-source-proof.md).

## Security

- Keep administration private, change the seeded admin/umami password immediately, generate unique APP_SECRET and TWO_FACTOR_ENCRYPTION_KEY values, and minimize collected visitor data.
- Umami's `view-only` role is not a guarantee of immutable owned websites: 3.4.0 still permits owners to update or delete their own website. The generated account has no administrator or team access and is restricted to the disposable fixture, not any real visitor data.
