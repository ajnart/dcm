# PhotoPrism traps

## Pitfalls

- Indexing cost and database choice depend on library size.
- Public mode can return a successful session without validating the password. Setup requires anonymous session denial, exact active admin identity and role, and authenticated session readback; a session ID alone is not administrator proof.
- Setup saves one genuine user-bound API app password with read-only scope and a one-year lifetime. Disabled app passwords, expired credentials, lost creation output, or identity/scope/lifetime mismatch require inspection; setup never rotates or repeats an uncertain creation. Photo ingestion and restart persistence remain separate acceptance checks.

## Security

- Keep originals private and publish only through approved ingress.
