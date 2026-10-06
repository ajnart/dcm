# FreshRSS traps

## Pitfalls

- Aggressive polling can trigger source rate limits or bans.
- The shared adapter never submits passwords in argv or URLs. Its exported API credential is the independent durable API password, not the Google Reader Auth value used only for verification. Foreign API passwords, lost private credentials, and incomplete uncertain writes block automatic replay. Browser form-login, feed operations, restart persistence and native Homarr integration remain unverified.

## Security

- Protect form-login credentials; enable the separate mobile API and its distinct API password only after explicit approval.
