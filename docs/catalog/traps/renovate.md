# Renovate traps

## Pitfalls

- The open-source image needs an external cron-like scheduler; a continuously running Compose service is not the documented execution model.
- Repository selection and token permissions require an explicit operator choice before scheduling any update job.
- RENOVATE_TOKEN is documented, but a generic RENOVATE_TOKEN_FILE input is not established here; do not fabricate a file variable or put a Personal Access Token in process arguments.
- An image update PR does not prove migration or restore compatibility.

## Security

- A Forgejo deployment requires a dedicated Renovate account and user-created Personal Access Token with the documented repository permissions; setup cannot safely generate or infer that token.
- Scope repository and registry tokens to the minimum required access, and pass them only at the job's secret boundary.
