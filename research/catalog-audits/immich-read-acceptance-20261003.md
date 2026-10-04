# Immich existing-asset read acceptance

Pinned recipe: Immich server/machine-learning v3.2.2. Scope is one explicitly reviewed existing administrator-owned PNG, JPEG, GIF, or WebP original at most 1 MiB. An absent asset or empty library fails, without upload or replacement API key.

Primary sources checked on 2026-10-03:

- [Asset controller](https://raw.githubusercontent.com/immich-app/immich/v3.2.2/server/src/controllers/asset.controller.ts): authenticated `GET /api/assets/:id` requires `asset.read`.
- [Asset response DTO](https://raw.githubusercontent.com/immich-app/immich/v3.2.2/server/src/dtos/asset-response.dto.ts): asset UUID, owner UUID, original MIME/name, type, offline/trashed state.
- [User controller](https://raw.githubusercontent.com/immich-app/immich/v3.2.2/server/src/controllers/user.controller.ts): authenticated `GET /api/users/me` requires `user.read`.
- [API key controller](https://raw.githubusercontent.com/immich-app/immich/v3.2.2/server/src/controllers/api-key.controller.ts): `GET /api/api-keys/me` authenticates the current saved key without key-inventory permission.
- [Asset media controller](https://raw.githubusercontent.com/immich-app/immich/v3.2.2/server/src/controllers/asset-media.controller.ts): authenticated `GET /api/assets/:id/original` requires `asset.download`.
- [Asset media service](https://raw.githubusercontent.com/immich-app/immich/v3.2.2/server/src/services/asset-media.service.ts): absent `edited` defaults false; original file path/name and MIME are served after access checks.
- [File utility](https://raw.githubusercontent.com/immich-app/immich/v3.2.2/server/src/utils/file.ts): original response MIME and UTF-8 encoded inline filename disposition.
- [Current original-download documentation](https://api.immich.app/endpoints/assets/downloadAsset), also retrieved through Context7: original download route; source-tag implementation controls the pinned behavior.

Implementation uses only saved-key authenticated GET requests. Key-me must match setup.ts's exact Homarr permissions; users/me must prove the configured administrator email/admin flag; metadata must identify the reviewed asset and that administrator as its owner. Original response must be full HTTP 200, match the metadata MIME and disposition, have consistent size, and pass a bounded image-format signature check. SHA-256 hashes of original bytes and MIME/filename identity are recorded, not raw bytes, paths, names, keys, or private metadata. Format checks are not a full image decoder or visual validation.

The common acceptance lifecycle binds the selection, baseline, and exact saved owner to trusted stop/start receipts. All four recipe services (`database`, `immich`, `immich-machine-learning`, `redis`) are required. A second HTTP read alone does not prove restart persistence. Including the machine-learning unit does not claim machine-learning functionality.

Validation: named synthetic fixture and adapter build only. No live instance, Docker, browser, client photo browsing, upload, machine-learning workload, or new-key creation was exercised. Source evidence and synthetic receipts earn no live acceptance credit. Existing-asset read is not upload/photo-roundtrip acceptance.
