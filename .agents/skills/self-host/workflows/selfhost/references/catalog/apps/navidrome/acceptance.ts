import { createHash } from "node:crypto";
import { createReadOnlyAcceptance } from "../../types/acceptance-lifecycle";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Navidrome returned invalid metadata");
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error("Navidrome returned an invalid opaque ID");
  return value;
}
function positive(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error("Navidrome returned invalid track metadata");
  return value;
}

// STAGED ONLY: no acceptance-contract.json. Authenticated metadata is not
// original-byte delivery and must never map to core-round-trip acceptance.
export default createReadOnlyAcceptance({
  appId: "navidrome",
  source: "https://github.com/navidrome/navidrome/blob/v0.64.0/server/nativeapi/native_api.go",
  stage: "existing-track-metadata-read",
  serviceIds: ["navidrome"],
  cleanup: "not-required-existing-track-metadata",
  inputDefinitions: [{ key: "track-id", label: "Exact authorized existing audio track opaque ID" }],
  authenticationRequests: [{ path: "/auth/login", action: "navidrome-acceptance-login" }],
  async observe(context) {
    const trackId = id(context.inputs?.["track-id"]);
    const password = await context.secrets.readAdminPassword();
    if (!/^[A-Za-z0-9]{32,128}$/.test(password)) throw new Error("Navidrome requires its saved administrator password");
    let login: Record<string, unknown>;
    let song: Record<string, unknown>;
    try {
      const response = await context.http.request({ method: "POST", path: "/auth/login",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ username: "admin", password }),
        approval: { action: "navidrome-acceptance-login", progress: "Authenticate the saved Navidrome administrator for selected-track metadata only" } });
      if (response.status !== 200 || !response.ok) throw new Error();
      login = object(await response.json());
      if (login.username !== "admin" || login.isAdmin !== true || typeof login.token !== "string"
        || login.token.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(login.token)) throw new Error();
      id(login.id);
      const metadata = await context.http.request({ method: "GET", path: `/api/song/${trackId}`,
        headers: { "X-ND-Authorization": `Bearer ${login.token}`, accept: "application/json" } });
      if (metadata.status !== 200 || !metadata.ok) throw new Error();
      song = object(await metadata.json());
    } catch { throw new Error("Navidrome protected administrator/session metadata read failed"); }
    if (id(song.id) !== trackId || song.missing !== false || typeof song.duration !== "number"
      || !Number.isFinite(song.duration) || song.duration <= 0 || song.duration > 86400) {
      throw new Error("Navidrome selected existing track metadata differs");
    }
    const size = positive(song.size);
    if (size > 1024 * 1024) throw new Error("Navidrome selected track exceeds the staged bounded workload size");
    const metadataSha256 = createHash("sha256").update(JSON.stringify({ id: trackId, size,
      duration: song.duration, bitRate: positive(song.bitRate), sampleRate: positive(song.sampleRate),
      channels: positive(song.channels) })).digest("hex");
    return { baseline: { userId: id(login.id), trackId, trackSize: size, metadataSha256 }, result: {
      appHealthObserved: true, authenticatedOwnerPolicyVerified: true, existingTrackMetadataReadVerified: true,
      workloadScope: "selected-existing-track-metadata-only", stagedOnly: true,
      mediaBytesReadVerified: false, playbackVerified: false, originalDeliveryVerified: false,
    } };
  },
});
