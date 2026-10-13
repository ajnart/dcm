# Audiobookshelf traps

## Pitfalls

- File ownership, metadata matching, and database plus media backup must be planned together.

## Security

- Protect accounts, listening history, library metadata, and remote access.
- Homarr's native Audio Stats client needs an administrator for online sessions.
  Its separate account disables media changes but still has role-based
  administrative access; do not call its key read-only or share the root token.
- Named API keys are shown only when created. Setup preserves owned credentials
  and stops for manual recovery instead of adopting matching account/key names
  or silently replacing revoked keys. See
  [the staged Homarr prerequisite](../../homarr-audiobookshelf-stage1.md).
