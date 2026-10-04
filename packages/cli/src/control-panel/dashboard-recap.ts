type Row = Record<string, unknown>;

function row(value: unknown): value is Row {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function checkHint(reason: unknown): string | null {
  if (typeof reason !== "string") return null;
  const status = /^homarr-query-http-(400|401|403|404|405|408|429|500|502|503|504)$/.exec(reason)?.[1];
  if (status === "401" || status === "403") {
    return `Homarr returned HTTP ${status}; review the saved API key's access permissions.`;
  }
  if (status === "404" || status === "405" || status === "400") {
    return `Homarr returned HTTP ${status}; check the running API's route and input contract.`;
  }
  if (status === "408" || status === "429") {
    return `Homarr returned HTTP ${status}; the query timed out or was rate-limited.`;
  }
  if (status) {
    return `Homarr returned HTTP ${status}; check its connection to this app and the running API contract. The status alone does not identify the cause.`;
  }
  if (reason === "homarr-server-http-failed" || reason === "homarr-server-query-failed") {
    return "Homarr could not verify the saved server URL; check the app's address and private network from inside Homarr.";
  }
  if (reason === "service-query-invalid-data") {
    return "The widget query returned unexpected data; check compatibility with the running app and Homarr versions.";
  }
  if (reason === "saved-server-target-mismatch") {
    return "Ping was skipped because the saved target differs from this app's Compose address; review Homarr dashboard setup before probing.";
  }
  return null;
}

/** Consume only the redacted read-only command, never raw Homarr inventories. */
export function dashboardRecap(value: unknown, root: string, projectId: string,
  selected: readonly string[]): string {
  if (!row(value) || value.command !== "app shared homarr-status" || value.mutation !== false
    || value.projectRoot !== root || value.projectId !== projectId
    || !["attached", "needs-attachment", "attached-with-native-pending"].includes(String(value.status))
    || value.apiKeyAuthorizationVerified !== true || value.serviceRuntimeVerified !== false
    || value.renderedContentVerified !== false || !Array.isArray(value.services)
    || !Array.isArray(value.preparedJobs)
    || (value.pendingConnectors !== undefined && !Array.isArray(value.pendingConnectors))
    || (value.pendingDaemons !== undefined && !Array.isArray(value.pendingDaemons))
    || (value.nonBrowserServices !== undefined && !Array.isArray(value.nonBrowserServices))
    || (value.pendingNativeIntegrations !== undefined && !Array.isArray(value.pendingNativeIntegrations))) {
    throw new Error("Dashboard readback does not match this saved project");
  }
  const services = value.services;
  const jobs = value.preparedJobs;
  const connectors = value.pendingConnectors ?? [];
  const daemons = value.pendingDaemons ?? [];
  const nonBrowserServices = value.nonBrowserServices ?? [];
  const ids = [...services, ...jobs, ...connectors, ...daemons, ...nonBrowserServices]
    .map((service) => row(service) && service.id);
  if (ids.some((id) => typeof id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))
    || new Set(ids).size !== ids.length
    || JSON.stringify([...ids].sort()) !== JSON.stringify([...selected].sort())) {
    throw new Error("Dashboard readback differs from the selected apps");
  }
  const nativePending = new Map<string, Row>();
  for (const pending of value.pendingNativeIntegrations ?? []) {
    if (!row(pending) || Object.keys(pending).sort().join(",") !== "id,integrationKind,reasonCode,requirement"
      || typeof pending.id !== "string" || nativePending.has(pending.id)
      || !services.some((service) => row(service) && service.id === pending.id)
      || typeof pending.integrationKind !== "string" || !/^[a-z][a-zA-Z0-9-]{0,63}$/.test(pending.integrationKind)
      || !["native-auth-contract-unsupported", "native-admin-api-disabled", "native-recipe-contract-changed",
        "native-owned-https-unverified"].includes(String(pending.reasonCode))
      || typeof pending.requirement !== "string" || pending.requirement.length < 1 || pending.requirement.length > 400
      || /[\u0000-\u001f\u007f<>]/.test(pending.requirement)) {
      throw new Error("Dashboard pending native integration readback is invalid");
    }
    nativePending.set(pending.id, pending);
  }
  if ((value.status === "attached-with-native-pending" && nativePending.size === 0)
    || (value.status === "attached" && nativePending.size > 0)) {
    throw new Error("Dashboard pending native integration status is inconsistent");
  }
  const lines = ["Saved Homarr API key: verified"];
  for (const service of services) {
    const pending = row(service) && nativePending.get(String(service.id));
    if (row(service) && service.status === "resource-readback-failed") {
      const verified = ["metadataVerified", "structureVerified", "notebookContentVerified",
        "notebookLayoutVerified", "integrationStructureVerified", "widgetStructureVerified"];
      if (verified.some((field) => service[field] !== false)) {
        throw new Error("Failed dashboard readback has inconsistent verification claims");
      }
      lines.push(`${service.id}: dashboard resources could not be read; configuration remains unverified. This is not proof that resources are missing.`);
      if (pending) lines.push(`${service.id}: native integration pending; integration and widgets unverified. ${pending.requirement}`);
      continue;
    }
    if (!row(service) || !Array.isArray(service.widgets)
      || service.widgets.some((widget) => !row(widget) || typeof widget.present !== "boolean")) {
      throw new Error("Dashboard widget readback is invalid");
    }
    const checks = [];
    if (service.metadataVerified === true && service.structureVerified === true) checks.push("app link present");
    else checks.push("app link needs attention");
    if (pending || service.nativeIntegrationPending === true) {
      if (!pending || service.nativeIntegrationPending !== true || service.tileOnly !== false
        || service.integrationKind !== pending.integrationKind
        || service.nativeIntegrationReason !== pending.reasonCode
        || service.nativeIntegrationRequirement !== pending.requirement
        || service.integrationStructureVerified !== false || service.widgetStructureVerified !== false
        || service.widgets.length !== 0) {
        throw new Error("Dashboard blocked native integration has inconsistent verification claims");
      }
      checks.push("native integration pending; integration and widgets unverified");
    }
    else if (service.tileOnly === true) checks.push("no native integration");
    else if (service.integrationStructureVerified === true) checks.push("integration configured");
    else checks.push("integration missing");
    const present = service.widgets.filter((widget) => widget.present === true).length;
    if (service.widgets.length > 0) checks.push(`${present}/${service.widgets.length} widgets present`);
    if (service.notebookContentVerified === true && service.notebookLayoutVerified === true) checks.push("recap present");
    else checks.push("recap needs attention");
    lines.push(`${service.id}: ${checks.join("; ")}`);
    if (pending) lines.push(`  ${pending.requirement}`);
  }
  for (const job of jobs) {
    if (!row(job) || job.executed !== false || job.browserUrl !== null) {
      throw new Error("Dashboard manual-job readback is invalid");
    }
    lines.push(`${job.id}: prepared, not executed; no dashboard app link`);
  }
  for (const connector of connectors) {
    if (!row(connector) || connector.state !== "connector-applied-unverified"
      || connector.enrollmentStatus !== "pending" || connector.enrollmentVerified !== false
      || connector.clientAccessVerified !== false || connector.browserUrl !== null
      || connector.integrationKind !== null || connector.apiKeyFile !== null
      || connector.notebookStatus !== "not-published") {
      throw new Error("Dashboard connector readback is invalid");
    }
    lines.push(`${connector.id}: private connector; enrollment pending; client access unverified; no browser URL, dashboard app link or app API key`);
  }
  for (const daemon of daemons) {
    if (!row(daemon) || daemon.state !== "daemon-applied-unverified"
      || daemon.enrollmentStatus !== "pending" || daemon.enrollmentVerified !== false
      || daemon.clientAccessVerified !== false || daemon.runtimeVerified !== false
      || daemon.browserUrl !== null || daemon.integrationKind !== null
      || daemon.apiKeyFile !== null || daemon.notebookStatus !== "not-published") {
      throw new Error("Dashboard daemon readback is invalid");
    }
    lines.push(`${daemon.id}: private daemon; runtime, enrollment and client access unverified; no browser URL, dashboard app link or app API key`);
  }
  for (const service of nonBrowserServices) {
    if (!row(service) || service.state !== "tcp-applied-unverified"
      || service.browserUrl !== null || service.integrationKind !== null
      || service.notebookStatus !== "not-published") {
      throw new Error("Dashboard TCP-service readback is invalid");
    }
    lines.push(`${service.id}: private TCP service; runtime and client access unverified; no browser URL or dashboard app link`);
  }
  if (value.functional !== undefined) {
    const functionalServices = services.filter((service) => row(service) && !nativePending.has(String(service.id)));
    if (!Array.isArray(value.functional) || value.functional.length !== functionalServices.length) {
      throw new Error("Dashboard live checks differ from the selected services");
    }
    const observed = new Set<string>();
    let failures = 0;
    let pending = nativePending.size;
    let missingIntegrationTests = 0;
    for (const result of value.functional) {
      if (!row(result) || typeof result.serviceId !== "string" || observed.has(result.serviceId)
        || !functionalServices.some((service) => row(service) && service.id === result.serviceId)
        || !row(result.checks) || !row(result.checks.reachability) || !Array.isArray(result.widgets)) {
        throw new Error("Dashboard live checks have an invalid service identity");
      }
      observed.add(result.serviceId);
      const reachability = result.checks.reachability.status;
      if (!["pass", "fail", "not-run"].includes(String(reachability))) {
        throw new Error("Dashboard reachability check is invalid");
      }
      let failed = 0;
      let passed = 0;
      let unchecked = 0;
      const hints = new Set<string>();
      if (reachability !== "pass") {
        const hint = checkHint(result.checks.reachability.reason);
        if (hint) hints.add(hint);
      }
      const integration = result.checks.integrationTest;
      const service = functionalServices.find((entry) => row(entry) && entry.id === result.serviceId);
      if (integration === undefined && row(service) && service.tileOnly !== true) {
        pending += 1;
        missingIntegrationTests += 1;
        lines.push(`${result.serviceId}: stored integration connection not checked`);
      }
      if (integration !== undefined) {
        if (!row(integration) || !["pass", "fail", "not-run"].includes(String(integration.status))) {
          throw new Error("Dashboard integration test is invalid");
        }
        if (row(service) && service.tileOnly === true) {
          if (integration.status !== "not-run") throw new Error("Tile-only app cannot claim a native integration test");
        } else {
          let integrationState = "not checked";
          if (integration.status === "pass") integrationState = "verified";
          if (integration.status === "fail") {
            integrationState = "failed";
            failures += 1;
          }
          if (integration.status === "not-run") pending += 1;
          lines.push(`${result.serviceId}: stored integration connection ${integrationState}`);
          if (integration.reason === "stored-integration-auth-denied") {
            hints.add("Homarr's integration test was denied; review its saved API key permissions.");
          }
          if (integration.reason === "stored-integration-route-unavailable-or-inaccessible") {
            hints.add("The running Homarr image's integration-test route is unavailable or inaccessible; the connection remains unverified.");
          }
        }
      }
      for (const widget of result.widgets) {
        if (!row(widget) || !row(widget.data)
          || !["pass", "fail", "not-run"].includes(String(widget.data.status))) {
          throw new Error("Dashboard widget data check is invalid");
        }
        if (widget.data.status === "pass") passed += 1;
        if (widget.data.status === "fail") {
          failed += 1;
          const hint = checkHint(widget.data.reason);
          if (hint) hints.add(hint);
        }
        if (widget.data.status === "not-run") unchecked += 1;
      }
      let reachable = "not checked";
      if (reachability === "pass") reachable = "verified";
      if (reachability === "fail") reachable = "failed";
      lines.push(`${result.serviceId}: Homarr reachability ${reachable}; widget data ${passed} passed, ${failed} failed, ${unchecked} not checked`);
      for (const hint of hints) lines.push(`  ${hint}`);
      failures += failed;
      pending += unchecked;
      if (reachability === "fail") failures += 1;
      if (reachability === "not-run") pending += 1;
    }
    if (failures > 0) lines.push("Live dashboard checks failed. This stack is not fully verified.");
    else if (pending > 0) lines.push("Some live dashboard checks remain unverified.");
    else lines.push("Requested reachability, integration connection and widget data checks passed; browser rendering and restart acceptance remain separate.");
    if (missingIntegrationTests > 0 && failures === 0 && pending === missingIntegrationTests) {
      lines.push("Requested reachability and widget data checks passed; integration tests without reported evidence remain unverified.");
    }
    lines.push("Service health, browser rendering and restart acceptance remain separate checks.");
  } else lines.push("Configuration readback only. Service health and live widget data are separate checks.");
  return lines.join("\n");
}
