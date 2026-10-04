import type { SavedImage } from "./project-snapshot.ts";

type Report = Record<string, unknown>;
type ImageChange = { serviceId: string; from: string; to: string };
type Review = Report & { services: string[]; changes: ImageChange[]; approval: string };
type Dependencies = {
  readOnlyCliJson(args: string[]): Promise<unknown>;
  runJsonCli(args: string[], progress: string): Promise<Report>;
  confirm(): Promise<boolean>;
  note(message: string, title: string): void;
  beforeApply(): void;
};

const pin = /^[a-zA-Z0-9][a-zA-Z0-9._/:+-]{0,447}@sha256:[0-9a-f]{64}$/;
const digest = /^[0-9a-f]{64}$/;

function ownedServices(appId: string, image: SavedImage): string[] {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(appId) || !image || typeof image !== "object") {
    throw new Error("Image update needs the selected app's saved service inventory");
  }
  const ids = Object.keys(image);
  if (ids.length === 0 || ids.length > 32
    || ids.some((id) => !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || !pin.test(image[id]!))) {
    throw new Error("Image update needs valid saved service pins");
  }
  return ids.map((id) => {
    if (id === appId) return id;
    return `${appId}-${id}`;
  }).sort();
}

function ownedReport(value: unknown, root: string, projectId: string,
  appId: string, services: string[], action: string, mutation: boolean): Report {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Image update returned no saved-owner report");
  }
  const report = value as Report;
  if (report.command !== `app shared ${action}` || report.projectRoot !== root
    || report.projectId !== projectId || report.appId !== appId || report.mutation !== mutation
    || report.dataPreserved !== true || report.credentialsRegenerated !== false
    || report.acceptanceVerified !== false
    || JSON.stringify(report.services) !== JSON.stringify(services)
    || typeof report.fromManifestHash !== "string" || !digest.test(report.fromManifestHash)
    || typeof report.toManifestHash !== "string" || !digest.test(report.toManifestHash)
    || report.fromManifestHash === report.toManifestHash) {
    throw new Error("Image update differs from the selected saved app unit");
  }
  return report;
}

/** Review fresh pins through the existing owner-bound engine; never apply an async update hint. */
export async function runSharedImageUpdate(root: string, projectId: string,
  app: { id: string; image: SavedImage }, dependencies: Dependencies): Promise<boolean> {
  const { readOnlyCliJson, runJsonCli, confirm, note, beforeApply } = dependencies;
  const services = ownedServices(app.id, app.image);
  const coordinates = ["--project-root", root, "--project-id", projectId, "--app", app.id];
  let value: unknown;
  try {
    value = await readOnlyCliJson(["app", "shared", "image-transition-plan", ...coordinates, "--json"]);
  } catch {
    note("No compatible image-only update could be reviewed. Nothing changed. The image may be current, "
      + "the registry unavailable, or the saved recipe/checkpoint may need inspection.\n"
      + "Use app shared image-transition-plan with this project's root, ID and selected app for the exact failure.",
    "Image update unavailable");
    return false;
  }
  const review = ownedReport(value, root, projectId, app.id, services, "image-transition-plan", false) as Review;
  const resumeReviewed = review.status === "resume-reviewed";
  if ((review.status !== "review" && !resumeReviewed) || review.resumeReviewed !== resumeReviewed
    || typeof review.approval !== "string"
    || !new RegExp(`^IMAGE-TRANSITION:${app.id}:[a-f0-9]{64}$`).test(review.approval)
    || !Array.isArray(review.changes) || review.changes.length === 0
    || review.changes.length > services.length
    || review.changes.some((change) => !change || !services.includes(change.serviceId)
      || typeof change.from !== "string" || typeof change.to !== "string"
      || !pin.test(change.from) || !pin.test(change.to) || change.from === change.to)
    || new Set(review.changes.map((change) => change.serviceId)).size !== review.changes.length) {
    throw new Error("Image update returned no exact digest review");
  }
  let title = "Review app image update";
  if (resumeReviewed) title = "Resume reviewed app image update";
  note(`Services: ${services.join(", ")}\n`
    + review.changes.map((change) => `${change.serviceId}\n  from ${change.from}\n  to   ${change.to}`).join("\n")
    + "\nOnly this running app unit is briefly recreated. Settings, ports, data and saved credentials remain.", title);
  if (!await confirm()) return false;
  beforeApply();
  const applied = ownedReport(await runJsonCli(["app", "shared", "image-transition-apply", ...coordinates,
    "--approve", review.approval, "--json"], "Updating only the reviewed app images"),
  root, projectId, app.id, services, "image-transition-apply", true);
  if (applied.status !== "updated-unverified" || applied.resumeReviewed !== review.resumeReviewed
    || applied.fromManifestHash !== review.fromManifestHash || applied.toManifestHash !== review.toManifestHash
    || JSON.stringify(applied.changes) !== JSON.stringify(review.changes)) {
    throw new Error("Image update outcome differs from its review; inspect saved status before retrying");
  }
  note("App images updated; data and saved credentials retained. Recheck existing login, application function "
    + "and any Homarr integrations/widgets. This update does not prove those checks.", "Image update recorded");
  return true;
}
