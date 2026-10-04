import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { createReadOnlyAcceptance } from "../../types/acceptance-lifecycle";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Sonarr returned invalid library data");
  return value as Record<string, unknown>;
}

function positive(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error("Sonarr returned invalid library ID or size");
  return value;
}

export default createReadOnlyAcceptance({
  appId: "sonarr",
  source: "https://github.com/Sonarr/Sonarr/blob/v4.0.19.2979/src/Sonarr.Api.V3/EpisodeFiles/EpisodeFileController.cs",
  stage: "existing-library-read",
  serviceIds: ["sonarr"],
  cleanup: "not-required-existing-library-read-only",
  inputDefinitions: [{ key: "series-id", label: "Existing series ID with imported episode-file records" }],
  async observe(context) {
    const selected = context.inputs?.["series-id"];
    if (typeof selected !== "string" || !/^[1-9][0-9]{0,9}$/.test(selected)) throw new Error("Sonarr requires a positive series-id");
    const seriesId = Number(selected);
    const status = object(await context.status());
    const key = await context.secrets.readApiKey();
    const keyPath = await context.secrets.apiKeyPath();
    if (status.command !== "app status" || status.appId !== "sonarr" || status.projectRoot !== context.projectRoot
      || status.status !== "applied" || status.mutation !== false || object(status.runtime).state !== "running"
      || typeof status.privateFiles !== "string" || !isAbsolute(status.privateFiles)
      || keyPath !== join(status.privateFiles, "sonarr-api-key") || typeof key !== "string" || !/^[0-9a-f]{32}$/.test(key)) {
      throw new Error("Sonarr requires the exact running saved-key owner");
    }
    async function read(path: string, query?: Record<string, string>) {
      try {
        const response = await context.http.request({ method: "GET", path, query, headers: { "X-Api-Key": key as string } });
        if (response.status !== 200 || !response.ok) throw new Error();
        return await response.json();
      } catch { throw new Error("Sonarr authenticated library read failed"); }
    }
    const host = object(await read("/api/v3/config/host"));
    if (host.username !== "admin" || host.authenticationMethod !== "forms" || host.authenticationRequired !== "enabled") {
      throw new Error("Sonarr managed administrator policy differs");
    }
    const series = object(await read(`/api/v3/series/${seriesId}`));
    if (positive(series.id) !== seriesId || typeof series.monitored !== "boolean") throw new Error("Sonarr selected series differs");
    const files = await read("/api/v3/episodefile", { seriesId: selected });
    if (!Array.isArray(files) || files.length === 0 || files.length > 10000) throw new Error("Sonarr requires existing imported episode-file records");
    const ids = new Set<number>();
    const metadata = files.map((value) => {
      const file = object(value);
      const id = positive(file.id);
      if (positive(file.seriesId) !== seriesId || ids.has(id) || typeof file.seasonNumber !== "number"
        || !Number.isSafeInteger(file.seasonNumber) || file.seasonNumber < 0) throw new Error("Sonarr episode-file ownership differs");
      ids.add(id);
      return { id, seriesId, seasonNumber: file.seasonNumber, size: positive(file.size) };
    }).sort((a, b) => a.id - b.id);
    const librarySha256 = createHash("sha256").update(JSON.stringify({ hostId: positive(host.id), seriesId,
      tvdbId: positive(series.tvdbId), qualityProfileId: positive(series.qualityProfileId), monitored: series.monitored, files: metadata })).digest("hex");
    return { baseline: { seriesId, librarySha256, fileCount: metadata.length }, result: {
      appHealthObserved: true, authenticatedOwnerPolicyVerified: true, existingLibraryReadVerified: true,
      workloadScope: "selected-existing-series-and-imported-file-records", mediaBytesReadVerified: false,
      indexerSearchVerified: false, downloadImportVerified: false, playbackVerified: false,
    } };
  },
});
