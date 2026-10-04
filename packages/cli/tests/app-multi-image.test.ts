import assert from "node:assert/strict";
import { pinnedImageFromManifest } from "../src/app.ts";

const indexDigest = `sha256:${"a".repeat(64)}`;
const platformDigest = `sha256:${"b".repeat(64)}`;
const manifest = {
  schemaVersion: 2,
  mediaType: "application/vnd.oci.image.index.v1+json",
  digest: indexDigest,
  manifests: [{ digest: platformDigest, platform: { os: "linux", architecture: "amd64" } }],
};
assert.deepEqual(pinnedImageFromManifest("ghcr.io/paperless-ngx/paperless-ngx:3.2.1", "amd64", manifest), {
  image: `ghcr.io/paperless-ngx/paperless-ngx:3.2.1@${indexDigest}`,
  indexDigest,
  platformDigest,
});
assert.throws(() => pinnedImageFromManifest("example:1", "arm64", manifest), /unique Linux manifest/);
assert.throws(() => pinnedImageFromManifest("example:1", "amd64", {
  ...manifest, manifests: [...manifest.manifests, ...manifest.manifests],
}), /unique Linux manifest/);
assert.throws(() => pinnedImageFromManifest("example:1", "amd64", {
  ...manifest, digest: "sha256:invalid",
}), /immutable multi-platform index/);

process.stdout.write("multi-service image resolution checks passed\n");
