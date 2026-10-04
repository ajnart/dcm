import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import type { AcceptanceContext } from "../../types/acceptance";
import { createReadOnlyAcceptance } from "../../types/acceptance-lifecycle";
import { appliedStatus, setupRecord, type SetupRecord } from "../../types/setup";

const SOURCE = "https://github.com/grafana/grafana/blob/v13.2.2/pkg/api/dashboard.go";
const CLEANUP = "not-required-existing-dashboard-read-only";

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error("Grafana dashboard has invalid stable numeric metadata or layout");
  }
  return value as number;
}

// Deliberately not a recursive options hash: plugin options can contain queries,
// URLs, credentials or raw text. Only these display scalars enter the hash.
function displayConfig(panel: SetupRecord): SetupRecord {
  const selected: SetupRecord = {};
  if (panel.transparent !== undefined) {
    if (typeof panel.transparent !== "boolean") throw new Error("Grafana panel transparency is invalid");
    selected.transparent = panel.transparent;
  }
  if (panel.options !== undefined) {
    const options = setupRecord(panel.options, "Grafana panel options");
    const enums: Record<string, readonly string[]> = {
      orientation: ["auto", "horizontal", "vertical"],
      graphMode: ["none", "area"], colorMode: ["none", "value", "background", "background_solid"],
      textMode: ["auto", "value", "value_and_name", "name", "none"], justifyMode: ["auto", "center"],
    };
    for (const [key, values] of Object.entries(enums)) {
      if (options[key] === undefined) continue;
      if (typeof options[key] !== "string" || !values.includes(options[key] as string)) {
        throw new Error("Grafana selected display configuration is invalid");
      }
      selected[key] = options[key];
    }
    if (options.showHeader !== undefined) {
      if (typeof options.showHeader !== "boolean") throw new Error("Grafana panel header configuration is invalid");
      selected.showHeader = options.showHeader;
    }
  }
  return selected;
}

function panels(value: unknown): { layout: SetupRecord[]; count: number } {
  const ids = new Set<number>();
  let visualizationCount = 0;
  function read(items: unknown, depth: number): SetupRecord[] {
    if (!Array.isArray(items) || depth > 4 || items.length > 256) throw new Error("Grafana panels are invalid or unbounded");
    return items.map((item) => {
      const panel = setupRecord(item, "Grafana panel");
      const id = integer(panel.id, 1);
      if (ids.has(id) || ids.size >= 256) throw new Error("Grafana panel IDs are duplicate or unbounded");
      ids.add(id);
      if (typeof panel.type !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(panel.type)) {
        throw new Error("Grafana panel type is invalid");
      }
      const grid = setupRecord(panel.gridPos, "Grafana grid position");
      const position = { x: integer(grid.x, 0, 23), y: integer(grid.y, 0, 1_000_000),
        w: integer(grid.w, 1, 24), h: integer(grid.h, 1, 1_000_000) };
      if (position.x + position.w > 24) throw new Error("Grafana panel exceeds the dashboard grid");
      const selected: SetupRecord = { id, type: panel.type, gridPos: position, config: displayConfig(panel) };
      if (panel.type === "row") {
        if (typeof panel.collapsed !== "boolean") throw new Error("Grafana row collapse configuration is invalid");
        selected.collapsed = panel.collapsed;
        if (panel.panels !== undefined) selected.panels = read(panel.panels, depth + 1);
      } else {
        visualizationCount += 1;
        if (panel.panels !== undefined) throw new Error("Grafana nested panels require a row");
      }
      return selected;
    });
  }
  const layout = read(value, 0);
  if (visualizationCount === 0) throw new Error("Grafana acceptance requires a nonempty existing dashboard with valid visualization panels");
  return { layout, count: ids.size };
}

async function observe(context: AcceptanceContext, afterRestart: boolean) {
  const uid = context.inputs?.["dashboard-uid"];
  if (!uid || !/^[A-Za-z0-9_-]{1,40}$/.test(uid)) throw new Error("Grafana needs a reviewed existing dashboard-uid");
  const status = appliedStatus(context, await context.status());
  if (status.username !== "admin" || typeof status.passwordFile !== "string" || !isAbsolute(status.passwordFile)) {
    throw new Error("Grafana has no exact saved administrator credential owner");
  }
  const password = await context.secrets.readAdminPassword();
  if (!password || password.length > 1024 || /[\r\n\u0000]/.test(password)) throw new Error("Grafana saved credential is invalid");
  const headers = { Authorization: `Basic ${Buffer.from(`admin:${password}`, "utf8").toString("base64")}`,
    "Cache-Control": "no-cache" };
  if (afterRestart) {
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      let response;
      try { response = await context.http.request({ method: "GET", path: "/api/user", headers, timeoutMs: 1_000 }); }
      catch { /* Bounded read-only startup retry, never a credential repair. */ }
      if (response?.ok && response.status === 200) { ready = true; break; }
      if (response && ![502, 503, 504].includes(response.status)) throw new Error("Grafana authenticated restart readiness was denied");
      if (attempt < 29) await new Promise<void>((resolve) => setTimeout(resolve, 500));
    }
    if (!ready) throw new Error("Grafana authenticated API did not become ready after restart");
  }
  async function read(path: string): Promise<SetupRecord> {
    const response = await context.http.request({ method: "GET", path, headers });
    if (!response.ok || response.status !== 200) throw new Error("Grafana authenticated dashboard acceptance read failed");
    return setupRecord(await response.json(), "Grafana acceptance response");
  }
  const user = await read("/api/user");
  if (user.login !== "admin" || user.isGrafanaAdmin !== true || user.isDisabled === true) {
    throw new Error("Grafana did not confirm the saved server administrator");
  }
  const userId = integer(user.id, 1);
  const orgId = integer(user.orgId, 1);
  const health = await read("/api/health");
  if (health.database !== "ok") throw new Error("Grafana database health is not ready");
  const response = await read(`/api/dashboards/uid/${uid}`);
  const dashboard = setupRecord(response.dashboard, "Grafana existing dashboard");
  const meta = setupRecord(response.meta, "Grafana dashboard metadata");
  if (dashboard.uid !== uid || meta.isFolder !== false || meta.canSave !== true || meta.canAdmin !== true) {
    throw new Error("Grafana selected dashboard identity or authenticated owner scope differs");
  }
  const dashboardId = integer(dashboard.id, 1);
  const version = integer(dashboard.version, 1);
  if (meta.version !== version) throw new Error("Grafana persisted dashboard version metadata differs");
  const schemaVersion = integer(dashboard.schemaVersion, 1);
  let folderId = "general";
  if (meta.folderUid !== undefined && meta.folderUid !== "") {
    if (typeof meta.folderUid !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(meta.folderUid)) {
      throw new Error("Grafana persisted folder identity is invalid");
    }
    folderId = meta.folderUid;
  }
  const selected = panels(dashboard.panels);
  const configSha256 = createHash("sha256").update(JSON.stringify({ dashboardId, uid, version, schemaVersion,
    folderId, panels: selected.layout })).digest("hex");
  return { baseline: { userId, orgId, dashboardId: uid, dashboardConfigSha256: configSha256, panelCount: selected.count },
    result: { appHealthObserved: true, authenticatedIdentityVerified: true, dashboardLayoutConfigReadVerified: true,
      workloadScope: "dashboard-layout-config-read", metricQueryVerified: false, datasourceVerified: false,
      renderedDashboardVerified: false, intendedClientAccessVerified: false } };
}

export default createReadOnlyAcceptance({ appId: "grafana", source: SOURCE, stage: "grafana-dashboard-read-acceptance",
  serviceIds: ["grafana"], cleanup: CLEANUP,
  inputDefinitions: [{ key: "dashboard-uid", label: "Existing authorized dashboard UID with nonempty valid panels" }], observe });
