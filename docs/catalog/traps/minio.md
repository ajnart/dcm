# MinIO AIStor (licensed) traps

## Pitfalls

- S3 compatibility does not make one-node storage highly available or a backup.
- The community repository is archived and source-only; do not infer a maintained image from historical Docker examples.
- AIStor uses separate S3 API (9000) and console (9001) ports. A private API listener alone does not provide console access or secure either endpoint.
- AIStor requires an operator-obtained license file supplied through --license or the documented MINIO_LICENSE file-path variable. It is not an application-generated API key. The explicit derived recipe imports this file independently of root onboarding and uses MINIO_ROOT_PASSWORD_FILE for the generated secret. Neither file preparation nor S3 root authentication proves a valid license. Do not invent MINIO_LICENSE_FILE or use file: URI syntax.
- Additional private port descriptors already represent S3 9000 and console 9001, but setup HTTP still uses one saved origin. Authenticate the S3 API with a canonical signed request; console HTTP 200, unauthenticated health, and root credentials are not a newly provisioned scoped durable API key.
- AIStor Free does not provide distributed high availability or server-side encryption at rest.

## Security

- Set unique, long, random root credentials before startup; AIStor otherwise defaults both values to minioadmin. Protect bucket policies, TLS, and administrative access; expose the S3 API and console only on approved private paths.
