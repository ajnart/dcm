# Linkwarden traps

## Pitfalls

- Auxiliary Compose services use App-owned names: `linkwarden-postgres`, `linkwarden-meilisearch`. Keep these names in connection settings and dependencies; persistent data paths stay unchanged.
- Captured content can create storage growth and legal retention questions.
- Shared setup checkpoints first-owner login and a saved API token before an exact reviewed Compose environment transition. Rerun shared setup after transition for saved-login, token, and anonymous registration-denial readback; a failed denial probe may create an extra account and requires inspection. Archive roundtrip and restart persistence remain separate acceptance checks.

## Security

- Keep the service private, use distinct random NEXTAUTH_SECRET, POSTGRES_PASSWORD, and MEILI_MASTER_KEY values, and protect archived content and access tokens.
