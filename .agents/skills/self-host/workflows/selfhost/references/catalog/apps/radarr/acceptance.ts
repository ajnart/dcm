import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { createReadOnlyAcceptance } from "../../types/acceptance-lifecycle";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Radarr returned invalid library data");
  return value as Record<string, unknown>;
}

function positive(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error("Radarr returned invalid library ID or size");
  return value;
}

export default createReadOnlyAcceptance({
  appId: "radarr",
  source: "https://github.com/Radarr/Radarr/blob/v6.4.4.10685/src/Radarr.Api.V3/MovieFiles/MovieFileController.cs",
  stage: "existing-library-read",
  serviceIds: ["radarr"],
  cleanup: "not-required-existing-library-read-only",
  inputDefinitions: [{ key: "movie-id", label: "Existing movie ID with an imported movie-file record" }],
  async observe(context) {
    const selected = context.inputs?.["movie-id"];
    if (typeof selected !== "string" || !/^[1-9][0-9]{0,9}$/.test(selected)) throw new Error("Radarr requires a positive movie-id");
    const movieId = Number(selected);
    const status = object(await context.status());
    const key = await context.secrets.readApiKey();
    const keyPath = await context.secrets.apiKeyPath();
    if (status.command !== "app status" || status.appId !== "radarr" || status.projectRoot !== context.projectRoot
      || status.status !== "applied" || status.mutation !== false || object(status.runtime).state !== "running"
      || typeof status.privateFiles !== "string" || !isAbsolute(status.privateFiles)
      || keyPath !== join(status.privateFiles, "radarr-api-key") || typeof key !== "string" || !/^[0-9a-f]{32}$/.test(key)) {
      throw new Error("Radarr requires the exact running saved-key owner");
    }
    async function read(path: string, query?: Record<string, string>) {
      try {
        const response = await context.http.request({ method: "GET", path, query, headers: { "X-Api-Key": key as string } });
        if (response.status !== 200 || !response.ok) throw new Error();
        return await response.json();
      } catch { throw new Error("Radarr authenticated library read failed"); }
    }
    const host = object(await read("/api/v3/config/host"));
    if (host.username !== "admin" || host.authenticationMethod !== "forms" || host.authenticationRequired !== "enabled") {
      throw new Error("Radarr managed administrator policy differs");
    }
    const movie = object(await read(`/api/v3/movie/${movieId}`));
    if (positive(movie.id) !== movieId || typeof movie.monitored !== "boolean") throw new Error("Radarr selected movie differs");
    const files = await read("/api/v3/moviefile", { movieId: selected });
    if (!Array.isArray(files) || files.length !== 1) throw new Error("Radarr requires one existing imported movie-file record");
    const file = object(files[0]);
    const fileId = positive(file.id);
    if (positive(file.movieId) !== movieId || positive(movie.movieFileId) !== fileId) throw new Error("Radarr movie-file ownership differs");
    const librarySha256 = createHash("sha256").update(JSON.stringify({ hostId: positive(host.id), movieId,
      tmdbId: positive(movie.tmdbId), qualityProfileId: positive(movie.qualityProfileId), monitored: movie.monitored,
      fileId, size: positive(file.size) })).digest("hex");
    return { baseline: { movieId, librarySha256, fileCount: 1 }, result: {
      appHealthObserved: true, authenticatedOwnerPolicyVerified: true, existingLibraryReadVerified: true,
      workloadScope: "selected-existing-movie-and-imported-file-record", mediaBytesReadVerified: false,
      indexerSearchVerified: false, downloadImportVerified: false, playbackVerified: false,
    } };
  },
});
