import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import type { AcceptanceContext } from "../../types/acceptance";
import { createReadOnlyAcceptance } from "../../types/acceptance-lifecycle";
import { setupRecord } from "../../types/setup";

const SOURCE = "https://raw.githubusercontent.com/immich-app/immich/v3.2.2/server/src/controllers/asset-media.controller.ts";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Match setup.ts's saved Homarr key, without login, inventory, or key creation.
const PERMISSIONS = ["album.statistics", "album.read", "album.create", "user.read", "user.update",
  "asset.read", "asset.view", "asset.download", "asset.statistics", "server.statistics", "server.about"];

async function json(context: AcceptanceContext, path: string, secret: string) {
  const response = await context.http.request({ method: "GET", path, headers: { "x-api-key": secret } });
  if (response.status !== 200) throw new Error("Immich existing asset or authenticated identity is unavailable; no empty-library acceptance");
  return setupRecord(await response.json(), "Immich acceptance read");
}

function image(bytes: Buffer, mime: string): boolean {
  if (mime === "image/png") return bytes.length >= 20 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && bytes.subarray(-8, -4).toString("ascii") === "IEND";
  if (mime === "image/jpeg") return bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216
    && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217;
  if (mime === "image/gif") return bytes.length >= 14 && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))
    && bytes[bytes.length - 1] === 59;
  if (mime === "image/webp") return bytes.length >= 16 && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP" && bytes.readUInt32LE(4) + 8 === bytes.length;
  return false;
}

export default createReadOnlyAcceptance({
  appId: "immich", source: SOURCE, stage: "immich-existing-asset-read-acceptance",
  serviceIds: ["database", "immich", "immich-machine-learning", "redis"],
  cleanup: "read-only-existing-asset-no-cleanup",
  inputDefinitions: [{ key: "asset-id", label: "Exact existing administrator-owned image UUID (original at most 1 MiB)" }],
  async observe(context) {
    const assetId = context.inputs?.["asset-id"];
    if (!assetId || !UUID.test(assetId)) throw new Error("Immich acceptance requires one exact reviewed existing asset UUID; no empty-library acceptance");
    const secret = await context.secrets.readApiKey();
    if (!secret || secret.length < 24 || secret.length > 4096 || secret.trim() !== secret || /[\u0000-\u001f\u007f]/.test(secret)) {
      throw new Error("Immich acceptance requires the saved Homarr API key; do not create a replacement");
    }
    const key = await json(context, "/api/api-keys/me", secret);
    if (typeof key.id !== "string" || !UUID.test(key.id) || key.name !== "Homarr"
      || !Array.isArray(key.permissions) || key.permissions.length !== PERMISSIONS.length
      || JSON.stringify([...key.permissions].sort()) !== JSON.stringify([...PERMISSIONS].sort())) {
      throw new Error("Immich saved Homarr key identity or permissions differ");
    }
    const user = await json(context, "/api/users/me", secret);
    if (typeof user.id !== "string" || !UUID.test(user.id) || user.email !== "admin@example.test" || user.isAdmin !== true) {
      throw new Error("Immich saved key did not prove the exact administrator identity");
    }
    const asset = await json(context, `/api/assets/${assetId}`, secret);
    if (asset.id !== assetId || asset.ownerId !== user.id || asset.type !== "IMAGE"
      || asset.isOffline !== false || asset.isTrashed !== false) {
      throw new Error("Immich existing image identity, administrator ownership, or availability differs");
    }
    const mime = asset.originalMimeType;
    const filename = asset.originalFileName;
    if (typeof mime !== "string" || !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mime)
      || typeof filename !== "string" || filename.length < 1 || filename.length > 256 || /[\/\\\u0000-\u001f\u007f]/.test(filename)) {
      throw new Error("Immich reviewed original must be a bounded PNG, JPEG, GIF, or WebP image");
    }
    // No thumbnail, edited/shared-link query, Range request, or upload fallback.
    const response = await context.http.request({ method: "GET", path: `/api/assets/${assetId}/original`,
      headers: { "x-api-key": secret } });
    if (response.status !== 200 || response.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() !== mime
      || response.headers.get("Content-Range") !== null
      || response.headers.get("Content-Disposition") !== `inline; filename*=UTF-8''${encodeURIComponent(filename)}`) {
      throw new Error("Immich original download status, content type, or file identity differs");
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const length = response.headers.get("Content-Length");
    if (bytes.length === 0 || bytes.length > 1024 * 1024 || (length !== null && length !== String(bytes.length)) || !image(bytes, mime)) {
      throw new Error("Immich original download is empty, oversized, truncated, or not the declared image");
    }
    return { baseline: { assetId, ownerId: user.id, apiKeyId: key.id, originalBytes: bytes.length,
      originalSha256: createHash("sha256").update(bytes).digest("hex"),
      originalIdentityHash: createHash("sha256").update(JSON.stringify({ mime, filename })).digest("hex") },
      result: { existingAssetReadVerified: true, authenticatedOwnerVerified: true, originalBytesVerified: true,
        appHealthObserved: true, healthSource: "authenticated-owned-original-image-read",
        uploadVerified: false, clientBrowsingVerified: false, machineLearningVerified: false } };
  },
});
