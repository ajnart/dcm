import { confirm, note, select } from "@clack/prompts";
import { pickCatalogApps } from "./catalog-picker.ts";
import { bundledCanonicalOrigin } from "../lib/shared-canonical-origin-settings.ts";

type Dependencies = {
  runJsonCli(args: string[], progress: string): Promise<Record<string, unknown>>;
  stopIfCancelled<T>(value: T | symbol): T;
};

function ownerReport(report: Record<string, unknown>, root: string, projectId: string,
  action: string): void {
  if (report.command !== `app shared ${action}` || report.projectRoot !== root
    || report.projectId !== projectId || report.dataPreserved !== true
    || report.dnsVerified !== false || report.clientTrustVerified !== false
    || report.applicationVerified !== false || report.trustStoreMutation !== false) {
    throw new Error("Private HTTPS response differs from the selected shared project");
  }
}

/** Host-only HTTPS is separate from client trust, remote access, and app setup. */
export async function runSharedPrivateHttps(root: string, projectId: string,
  apps: readonly { id: string; manualJob?: boolean; publishedPort?: number | null }[],
  { runJsonCli, stopIfCancelled }: Dependencies): Promise<void> {
  const coordinates = ["--project-root", root, "--project-id", projectId];
  if (!apps.some((app) => app.id === "caddy")) {
    const selected = await pickCatalogApps(apps.filter((app) => !app.manualJob)
      .map((app) => ({ id: app.id, name: app.id, selected: false,
        description: `Private HTTPS at ${app.id}.localhost on this host` })));
    if (!selected?.length) return;
    selected.sort();
    const usedPorts = new Set(apps.map((app) => app.publishedPort));
    let port = 4443;
    while (usedPorts.has(port) && port < 65535) port += 1;
    const routes = [...coordinates, ...selected.flatMap((id) => ["--app", id]),
      "--https-port", String(port)];
    const review = await runJsonCli(["app", "shared", "https-plan", ...routes, "--json"],
      "Reviewing private HTTPS for the selected installed apps");
    ownerReport(review, root, projectId, "https-plan");
    if (review.status !== "review" || review.mutation !== false || review.applyAvailable !== true
      || typeof review.approval !== "string"
      || !new RegExp(`^SHARED-HTTPS-ADD:${projectId}:[a-f0-9]{64}$`).test(review.approval)
      || JSON.stringify(review.added) !== JSON.stringify(["caddy"])
      || JSON.stringify(review.services) !== JSON.stringify(["caddy"])
      || !Array.isArray(review.routes) || review.routes.length !== selected.length) {
      throw new Error("Private HTTPS returned no exact Caddy-only addition review");
    }
    const urls = review.routes.map((route: Record<string, unknown>) => {
      if (!route || !selected.includes(String(route.appId))
        || route.hostname !== `${route.appId}.localhost`) {
        throw new Error("Private HTTPS route differs from the selected host-only names");
      }
      return `https://${route.hostname}:${port}`;
    });
    if (!Array.isArray(review.caddyNetworkAliases)
      || review.caddyNetworkAliases.length !== selected.length
      || review.caddyNetworkAliases.some((entry: Record<string, unknown>) =>
        !entry || entry.network !== "front"
        || !selected.some((id) => entry.alias === `${id}.localhost`))
      || new Set(review.caddyNetworkAliases.map((entry: Record<string, unknown>) => entry.alias)).size !== selected.length) {
      throw new Error("Private HTTPS Caddy aliases differ from the selected same-owner route names");
    }
    const aliases = review.caddyNetworkAliases.map((entry: Record<string, unknown>) => entry.alias).join(", ");
    note(`${urls.join("\n")}\nOnly Caddy is added; existing apps, data and passwords remain.\n`
      + `Caddy shared-network aliases: ${aliases}. Container reachability and trust are unverified.\n`
      + "Browser links are host-only. No host/router DNS, browser trust or public access is changed.", "Review private HTTPS");
    if (!stopIfCancelled(await confirm({ message: "Add this private HTTPS proxy?", initialValue: false }))) return;
    const applied = await runJsonCli(["app", "shared", "https-apply", ...routes,
      "--approve", review.approval, "--json"], "Adding only the reviewed Caddy service");
    ownerReport(applied, root, projectId, "https-apply");
    if (applied.status !== "added-transport-unverified" || applied.mutation !== true) {
      throw new Error("Private HTTPS addition was not confirmed; inspect saved status before retrying");
    }
  }
  const review = await runJsonCli(["app", "shared", "https-proof", ...coordinates, "--json"],
    "Reviewing the saved private HTTPS routes");
  ownerReport(review, root, projectId, "https-proof");
  if (review.status !== "review" || review.mutation !== false || typeof review.approval !== "string"
    || !new RegExp(`^SHARED-HTTPS-PROOF:${projectId}:[a-f0-9]{64}$`).test(review.approval)) {
    throw new Error("Private HTTPS returned no exact transport-proof review");
  }
  note("Export only this proxy's public CA certificate and verify its bound hostnames with curl.\n"
    + "No client trust store is changed. Application setup and login remain separate.", "Review HTTPS verification");
  if (!stopIfCancelled(await confirm({ message: "Verify these private HTTPS routes?", initialValue: false }))) return;
  const proof = await runJsonCli(["app", "shared", "https-proof", ...coordinates,
    "--approve", review.approval, "--json"], "Verifying the owned certificate and hostnames");
  ownerReport(proof, root, projectId, "https-proof");
  let summary = "TLS verification is incomplete; inspect the exact route results before setup.";
  if (proof.transportVerified === true) {
    summary = "Private TLS routes verified. Continue app setup next; client trust, login and application function are not verified.";
  }
  note(summary, "Private HTTPS recap");
  if (proof.transportVerified !== true || !Array.isArray(proof.proofs)) return;
  const proofs = proof.proofs as Array<Record<string, unknown>>;
  const candidates = apps.filter((app) => bundledCanonicalOrigin(app.id)
    && proofs.some((route) => route.appId === app.id && route.verified === true));
  if (candidates.length === 0) return;
  if (!stopIfCancelled(await confirm({ message: "Review an app's canonical HTTPS setting next?", initialValue: false }))) return;
  let appId = candidates[0]!.id;
  if (candidates.length > 1) {
    appId = stopIfCancelled(await select({ message: "Which app's HTTPS setting?",
      options: candidates.map((app) => ({ value: app.id, label: app.id })) }));
  }
  const scoped = [...coordinates, "--app", appId];
  const settings = await runJsonCli(["app", "shared", "canonical-origin-plan", ...scoped, "--json"],
    "Reviewing the app's source-declared HTTPS setting");
  if (settings.command !== "app shared canonical-origin-plan" || settings.projectRoot !== root
    || settings.projectId !== projectId || settings.appId !== appId || settings.status !== "review"
    || settings.mutation !== false || settings.dataPreserved !== true || settings.credentialsRegenerated !== false
    || typeof settings.approval !== "string"
    || !new RegExp(`^CANONICAL-ORIGIN:${appId}:[a-f0-9]{64}$`).test(settings.approval)
    || !Array.isArray(settings.changes) || settings.changes.length < 1
    || !Array.isArray(settings.services) || settings.services.length < 1
    || settings.services.some((service: unknown) => typeof service !== "string"
      || (service !== appId && !service.startsWith(`${appId}-`)))
    || !proofs.some((route) => route.appId === appId && route.url === settings.origin)) {
    throw new Error("App HTTPS setting review differs from its verified bound route");
  }
  const services = settings.services as string[];
  const changes = settings.changes as Array<{ serviceId: string; name: string; to: string }>;
  if (changes.some((change) => !change || !services.includes(change.serviceId)
    || typeof change.name !== "string" || !/^[A-Z][A-Z0-9_]{0,127}$/.test(change.name)
    || change.to !== settings.origin)) throw new Error("App HTTPS review contains an unexpected setting");
  note(changes.map((change) => `${change.serviceId}: ${change.name}=${change.to}`).join("\n")
    + "\nOnly this app unit is recreated. Saved credentials and storage remain.", "Review app HTTPS setting");
  if (!stopIfCancelled(await confirm({ message: "Apply this app's HTTPS setting?", initialValue: false }))) return;
  const changed = await runJsonCli(["app", "shared", "canonical-origin-apply", ...scoped,
    "--approve", settings.approval, "--json"], "Recreating only the reviewed app unit");
  if (changed.command !== "app shared canonical-origin-apply" || changed.projectRoot !== root
    || changed.projectId !== projectId || changed.appId !== appId || changed.mutation !== true
    || changed.status !== "canonical-origin-applied-unverified" || changed.origin !== settings.origin
    || changed.dataPreserved !== true || changed.credentialsRegenerated !== false) {
    throw new Error("App HTTPS recreation was not confirmed; inspect saved status before retrying");
  }
  note("Canonical HTTPS setting saved. Continue scripted app setup to read it back; client trust and account enrollment remain separate.",
    "App HTTPS recap");
}
