# Firefly III traps

## Pitfalls

- Auxiliary Compose services use App-owned names: `firefly-iii-db`. Keep these names in connection settings and dependencies; persistent data paths stay unchanged.
- A recoverable installation needs the database, uploads, and configuration backed up together; changing database credentials after initialization can break access.
- The shared setup adapter uses the pinned web-session registration and personal-token routes; a lost one-time token response requires inspection, and the example admin@example.test login is not a usable recovery inbox. Compose start is not completed onboarding.

## Security

- Protect finance records, application secrets, database credentials, and any importer credentials.
- Keep registration and the personal-access-token creation flow private; the first registered user becomes the owner.
