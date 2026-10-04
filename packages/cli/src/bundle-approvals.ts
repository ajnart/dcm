type AdapterCommand = (args: string[]) => Promise<void>;
type Dependencies = {
  media: AdapterCommand;
  immich: AdapterCommand;
  docmost: AdapterCommand;
  vaultwarden: AdapterCommand;
  homarrAttach?: AdapterCommand;
};
type BundleCommand = (args: string[], dependencies: Dependencies) => Promise<void>;
type JsonObject = Record<string, any>;

const MAX_OUTPUT = 128 * 1024;
const REVIEW_PHASES = new Set(["plan", "owner-plan", "accept-plan", "status"]);

function fail(message: string): never { throw new Error(message); }

function parse(args: string[]): { root: string; input?: string } {
  const flags: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name || !["--project-root", "--input"].includes(name) || flags[name]
      || !value || value.startsWith("--")) {
      fail(`Invalid or repeated bundle approvals option: ${name ?? "(missing)"}`);
    }
    flags[name] = value;
  }
  if (!flags["--project-root"]) fail("bundle approvals needs --project-root; use --input when several bundles exist");
  return { root: flags["--project-root"], input: flags["--input"] };
}

async function capture(command: () => Promise<void>): Promise<JsonObject> {
  const previousLog = console.log;
  const previousError = console.error;
  const previousStdout = process.stdout.write;
  const previousStderr = process.stderr.write;
  const previousExitCode = process.exitCode;
  let output = "";
  const append = (value: string): void => {
    if (Buffer.byteLength(output) > MAX_OUTPUT) fail("Bundle review output exceeded its safe limit");
    output += value;
    if (Buffer.byteLength(output) > MAX_OUTPUT) fail("Bundle review output exceeded its safe limit");
  };
  console.log = (...values: unknown[]) => { append(`${values.map(String).join(" ")}\n`); };
  console.error = (...values: unknown[]) => { append(`${values.map(String).join(" ")}\n`); };
  process.stdout.write = ((chunk: string | Uint8Array) => {
    append(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    append(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stderr.write;
  try {
    await command();
  } finally {
    console.log = previousLog;
    console.error = previousError;
    process.stdout.write = previousStdout;
    process.stderr.write = previousStderr;
    process.exitCode = previousExitCode;
  }
  let parsed: unknown;
  try { parsed = JSON.parse(output); }
  catch { fail("Bundle review command returned invalid JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("Bundle review command returned an invalid object");
  }
  return parsed as JsonObject;
}

/** Share only exact status observations while building one read-only inbox. */
function reviewDependencies(dependencies: Dependencies): Dependencies {
  function wrap(command: AdapterCommand): AdapterCommand {
    const observations = new Map<string, { value: JsonObject } | { error: unknown }>();
    return async (args) => {
      if (args[0] !== "status" && !(args[0] === "accept" && args[1] === "status")) {
        await command(args);
        return;
      }
      const key = JSON.stringify(args);
      let observation = observations.get(key);
      if (!observation) {
        try {
          observation = { value: await capture(() => command(args)) };
        } catch (error) {
          observation = { error };
        }
        observations.set(key, observation);
      }
      if ("error" in observation) throw observation.error;
      console.log(JSON.stringify(observation.value));
    };
  }
  return { media: wrap(dependencies.media), immich: wrap(dependencies.immich),
    docmost: wrap(dependencies.docmost), vaultwarden: wrap(dependencies.vaultwarden), homarrAttach: dependencies.homarrAttach };
}

function exactCommand(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((part) => typeof part !== "string")) return null;
  if (value[0] !== "self-host" || value[1] !== "bundle") return null;
  return value as string[];
}

function reviewToken(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 8 || value.length > 256) return null;
  return value;
}

function selectedAdapterToken(next: JsonObject, detail: JsonObject): string | null {
  const checkpoint = next.checkpoint;
  if (checkpoint === "review-media-plan") return reviewToken(next.review?.approvalDigest);
  if (checkpoint === "review-vaultwarden-plan") return reviewToken(detail.bootstrap?.approvalDigest);
  if (checkpoint === "review-docmost-owner-plan") return reviewToken(detail.approval);
  if (checkpoint === "review-docmost-acceptance-plan") {
    if (typeof detail.approval !== "string" || detail.approval !== next.apiAcceptance?.approval
      || !/^ACCEPT-DOCMOST:[a-z0-9][a-z0-9_-]{0,39}:[0-9a-f]{64}$/.test(detail.approval)) return null;
    return detail.approval;
  }
  if (checkpoint === "review-docmost-plan") return reviewToken(detail.approval);
  if (typeof checkpoint === "string" && checkpoint.startsWith("review-immich-")) {
    const phase = checkpoint.slice("review-immich-".length);
    if (phase === "apply" || phase === "bootstrap" || phase === "close-setup") {
      let key = phase;
      if (phase === "close-setup") key = "closeSetup";
      return reviewToken(detail.approvals?.[key]);
    }
  }
  return null;
}

function readOnlyReviewCommand(next: JsonObject): string[] | null {
  const command = exactCommand(next.command);
  if (!command || command[2] !== "stage") return null;
  const phaseIndex = command.indexOf("--phase");
  if (phaseIndex < 0 || !REVIEW_PHASES.has(command[phaseIndex + 1])) return null;
  if (command.includes("--approve") || command.includes("--stage-approve")) return null;
  return command;
}

function record(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

function identifier(value: unknown): string | null {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value)) return null;
  return value;
}

function mediaSelection(value: unknown): JsonObject {
  const selection = record(value);
  if (!selection || !["create", "adopt"].includes(selection.mode)
    || typeof selection.runId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(selection.runId)
    || !["127.0.0.1", "0.0.0.0", null].includes(selection.bind)
    || !["bundle-selection", "cli-managed-media-info"].includes(selection.source)
    || !(selection.approvalDigest === null
      || (typeof selection.approvalDigest === "string" && /^[0-9a-f]{64}$/.test(selection.approvalDigest)))) {
    fail("Bundle plan did not contain one reviewable media selection");
  }
  return { mode: selection.mode, runId: selection.runId, bind: selection.bind,
    source: selection.source, approvalDigest: selection.approvalDigest };
}

function attachmentInbox(value: unknown, root: string, input: unknown): JsonObject | null {
  const guidance = record(value);
  if (!guidance || guidance.mutation !== false
    || !["fresh-read-only-attached-prefix", "unavailable"].includes(guidance.observation)
    || (guidance.firstUnresolved !== undefined && guidance.firstUnresolved !== null
      && !["immich", "docmost", "vaultwarden", "immich-native"].includes(guidance.firstUnresolved))) return null;
  function command(value: unknown): string[] | null {
    if (!Array.isArray(value) || value.some((part) => typeof part !== "string" || part.length > 4096)
      || value[0] !== "self-host" || value[1] !== "homarr" || value[2] !== "attach") return null;
    let actionIndex = 3;
    if (value[3] === "immich") actionIndex += 1;
    if (!["plan", "status"].includes(value[actionIndex])) return null;
    const expected = ["--input", "--api-key-file"];
    if (actionIndex === 4) expected.push("--immich-api-key-file", "--acceptance-file");
    const args = value.slice(actionIndex + 1);
    if (args.length !== expected.length * 2 || expected.some((flag, index) => args[index * 2] !== flag
      || !args[index * 2 + 1].startsWith(`${root}/`) || args[index * 2 + 1].split("/").includes(".."))) return null;
    return value;
  }
  let inspectCommand: string[] | null = null;
  if (typeof input === "string" && input.startsWith(`${root}/`)
    && /^\/\.selfhost\/bundles\/[a-z0-9][a-z0-9_-]{0,39}\/household-bundle\.json$/.test(input.slice(root.length))) {
    const expected = ["self-host", "bundle", "homarr-attach", "status", "--project-root", root, "--input", input, "--inspect"];
    if (JSON.stringify(guidance.inspectCommand) === JSON.stringify(expected)) inspectCommand = expected;
  }
  return { observation: guidance.observation, mutation: false, firstUnresolved: guidance.firstUnresolved ?? null,
    inspectCommand,
    planCommand: command(guidance.planCommand), statusCommand: command(guidance.statusCommand),
    nextActionCommand: command(guidance.nextActionCommand),
    approvalScope: "Separate direct adapter approval; fresh plan after each attachment. No aggregate or automatic apply.",
    routeSelection: "Missing inputs require selection of the original approved route; preserve exact shared-Caddy ownership." };
}

// Only these typed facts cross the adapter boundary. Never spread a plan:
// Compose claims can include secret references and adapters may add private fields.
function safeReview(next: JsonObject, detail: JsonObject): JsonObject | null {
  if (next.checkpoint === "review-docmost-acceptance-plan") {
    const status = record(next.apiAcceptance);
    const synthetic = record(detail.synthetic);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!status || status.status !== "planned" || status.replayAllowed !== true
      || status.evidence !== "recorded-api-proof-not-live-recheck"
      || detail.schemaVersion !== 1 || detail.kind !== "docmost-v0.96.0-acceptance-plan"
      || detail.mutation !== false || detail.status !== "ready-for-approval" || detail.attemptConsumed !== false
      || detail.project !== status.project || detail.runId !== status.runId || !identifier(detail.project)
      || !identifier(detail.runId) || detail.approval !== status.approval
      || detail.digest !== status.approval.split(":").at(-1)
      || detail.contract !== "9b3e5dd3dc21588fa20c02c5b8646d2f46ee73af:accept-v2-mime-charset"
      || typeof detail.nonce !== "string" || !/^[0-9a-f]{24}$/.test(detail.nonce)
      || typeof detail.workspaceId !== "string" || !uuid.test(detail.workspaceId)
      || typeof detail.spaceId !== "string" || !uuid.test(detail.spaceId)
      || !synthetic || synthetic.title !== `Self-host acceptance ${detail.nonce}`
      || synthetic.fileName !== `selfhost-acceptance-${detail.nonce}.txt`
      || synthetic.disposition !== "retained-for-inspection" || !Number.isInteger(synthetic.byteLength)
      || synthetic.byteLength < 1 || synthetic.byteLength > 1024
      || [synthetic.initialHash, synthetic.editedHash, synthetic.byteHash].some((value) => typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value))) return null;
    return { summaryOnly: true, kind: detail.kind, project: detail.project, runId: detail.runId,
      contract: detail.contract, workspaceId: detail.workspaceId, spaceId: detail.spaceId,
      synthetic: { title: synthetic.title, fileName: synthetic.fileName, byteLength: synthetic.byteLength,
        byteHash: synthetic.byteHash, disposition: "retained-for-inspection" },
      attemptConsumed: false, browserHomarrRestoreAccepted: false };
  }
  if (next.checkpoint === "review-media-plan") {
    const review = record(next.review);
    if (!review || !identifier(review.composeProject) || !["0.0.0.0", "127.0.0.1"].includes(review.bind)
      || !/^[0-9a-f]{64}$/.test(review.composeSha256) || !/^[0-9a-f]{64}$/.test(review.runtimeSha256)) return null;
    const ports = record(review.ports);
    const names = ["PROWLARR_PORT", "RADARR_PORT", "SONARR_PORT", "QBITTORRENT_PORT", "JELLYFIN_PORT", "SEERR_PORT", "HOMARR_PORT"];
    if (!ports || names.some((name) => typeof ports[name] !== "string" || !/^[0-9]{1,5}$/.test(ports[name])
      || Number(ports[name]) < 1 || Number(ports[name]) > 65535)) return null;
    return { summaryOnly: true, composeProject: review.composeProject, bind: review.bind,
      ports: Object.fromEntries(names.map((name) => [name, ports[name]])),
      composeSha256: review.composeSha256, runtimeSha256: review.runtimeSha256 };
  }
  const kinds = new Set(["immich-v3.2.2-cli-plan", "docmost-v0.96.0-cli-plan",
    "docmost-v0.96.0-owner-plan", "vaultwarden-plan-checkpoint-status"]);
  if (detail.schemaVersion !== 1 || !kinds.has(detail.kind) || !identifier(detail.runId)) return null;
  let expectedKind = "";
  if (next.service === "immich") expectedKind = "immich-v3.2.2-cli-plan";
  if (next.checkpoint === "review-docmost-plan") expectedKind = "docmost-v0.96.0-cli-plan";
  if (next.checkpoint === "review-docmost-owner-plan") expectedKind = "docmost-v0.96.0-owner-plan";
  if (next.checkpoint === "review-vaultwarden-plan") expectedKind = "vaultwarden-plan-checkpoint-status";
  if (detail.kind !== expectedKind) return null;
  const review: JsonObject = { summaryOnly: true, kind: detail.kind, runId: detail.runId };
  if (detail.kind === "vaultwarden-plan-checkpoint-status") {
    if (detail.runtimeInspected !== false || typeof detail.bootstrap?.applied !== "boolean") return null;
    review.bootstrapApplied = detail.bootstrap.applied;
    review.runtimeInspected = false;
  } else {
    if (detail.mutation !== false) return null;
    const compose = record(detail.compose);
    if (detail.kind === "docmost-v0.96.0-owner-plan") {
      if (detail.experimental !== true || !identifier(detail.project)
        || typeof detail.alreadyRecorded !== "boolean" || detail.request?.setup !== "POST /api/auth/setup"
        || detail.request?.loginProof !== "POST /api/auth/login") return null;
      review.project = detail.project;
      review.experimental = true;
      review.alreadyRecorded = detail.alreadyRecorded;
      review.request = { setup: "POST /api/auth/setup", loginProof: "POST /api/auth/login" };
    } else {
      const project = record(compose?.project);
      if (!compose || compose.schemaVersion !== 1 || compose.kind !== "selfhost-compose-plan"
        || compose.status !== "pass" || !/^[0-9a-f]{16}$/.test(compose.planId)
        || !project || !identifier(project.id) || !["default", "rootless"].includes(project.dockerContext)
        || !["new", "verified-existing"].includes(project.ownership)
        || compose.execution?.performed !== false) return null;
      review.compose = { planId: compose.planId, status: "pass", project: {
        id: project.id, dockerContext: project.dockerContext, ownership: project.ownership },
        executionPerformed: false };
      const claims = record(compose.claims);
      if (!claims || !Array.isArray(claims.services) || claims.services.length > 16) return null;
      const services = [];
      for (const value of claims.services) {
        const service = record(value);
        if (!service || !identifier(service.id) || typeof service.image !== "string"
          || !/^[a-zA-Z0-9][a-zA-Z0-9._/:+-]{1,200}@sha256:[0-9a-f]{64}$/.test(service.image)) return null;
        services.push({ id: service.id, image: service.image });
      }
      const ports = [];
      for (const key of ["privatePorts", "publicPorts"]) {
        if (!Array.isArray(claims[key]) || claims[key].length > 32) return null;
        for (const value of claims[key]) {
          const port = record(value);
          if (!port || !identifier(port.service) || typeof port.hostIp !== "string"
            || !/^[0-9a-fA-F:.]{1,45}$/.test(port.hostIp) || !["tcp", "udp"].includes(port.protocol)
            || !Number.isInteger(port.published) || port.published < 1 || port.published > 65535
            || !Number.isInteger(port.target) || port.target < 1 || port.target > 65535) return null;
          ports.push({ service: port.service, hostIp: port.hostIp, published: port.published,
            target: port.target, protocol: port.protocol });
        }
      }
      review.compose.services = services;
      review.compose.ports = ports;
    }
  }
  return review;
}

/** Collects existing read-only bundle decisions; this command never supplies an approval to a mutating stage. */
export async function bundleApprovalsCommand(
  args: string[], dependencies: Dependencies, bundleCommand: BundleCommand,
): Promise<void> {
  const parsed = parse(args);
  const common = ["--project-root", parsed.root];
  if (parsed.input) common.push("--input", parsed.input);
  const reviewedDependencies = reviewDependencies(dependencies);

  const plan = await capture(() => bundleCommand(["plan", ...common], reviewedDependencies));
  if (plan.kind !== "household-bundle-plan" || plan.mutation !== false
    || typeof plan.approval !== "string" || typeof plan.bundle !== "string") {
    fail("Bundle plan did not return a safe exact review token");
  }
  const selectedMedia = mediaSelection(plan.mediaSelection);
  const status = await capture(() => bundleCommand(["status", ...common], reviewedDependencies));
  if (status.kind !== "household-bundle-status" || status.mutation !== false
    || status.bundle !== plan.bundle || status.projectRoot !== plan.projectRoot
    || !Array.isArray(status.services)) {
    fail("Bundle status did not match the reviewed bundle");
  }
  const next = await capture(() => bundleCommand(["next", ...common, "--approve", plan.approval], reviewedDependencies));
  if (next.kind !== "household-bundle-next" || next.mutation !== false
    || next.executionPerformed !== false || next.bundle !== plan.bundle
    || next.projectRoot !== plan.projectRoot
    || !next.next || typeof next.next !== "object" || Array.isArray(next.next)) {
    fail("Bundle next did not return a safe decision for the reviewed bundle");
  }

  const checkpoint = next.next as JsonObject;
  const reviewCommand = readOnlyReviewCommand(checkpoint);
  let detail: JsonObject = {};
  let adapterToken = selectedAdapterToken(checkpoint, {});
  if (reviewCommand) {
    detail = await capture(() => bundleCommand(reviewCommand.slice(2), reviewedDependencies));
    adapterToken = selectedAdapterToken(checkpoint, detail);
  }
  const review = safeReview(checkpoint, detail);
  let runAfterReview: string[] | null = null;
  if (review && adapterToken && /^(?:(?:APPLY|BOOTSTRAP|CLOSE_SETUP|OWNER|ACCEPT-DOCMOST):[a-zA-Z0-9_.-]{1,128}:|sha256:)?[0-9a-f]{64}$/.test(adapterToken)
    && /^BUNDLE:[a-zA-Z0-9_.-]{1,128}:[0-9a-f]{64}$/.test(plan.approval)
    && typeof plan.input === "string" && plan.input.startsWith(`${plan.projectRoot}/`)) {
    runAfterReview = ["self-host", "bundle", "run", "--project-root", plan.projectRoot,
      "--input", plan.input, "--approve", plan.approval, "--stage-approve", adapterToken];
  }
  const services = status.services.map((entry: JsonObject) => ({
    service: entry.service,
    phase: entry.phase,
    statusCheck: entry.statusCheck,
    incompleteGates: entry.incompleteGates,
  }));
  const planCommand = ["self-host", "bundle", "plan", ...common];
  const statusCommand = ["self-host", "bundle", "status", ...common];
  const nextCommand = ["self-host", "bundle", "next", ...common, "--approve", plan.approval];
  console.log(JSON.stringify({
    schemaVersion: 1,
    kind: "household-bundle-approvals",
    bundle: plan.bundle,
    projectRoot: plan.projectRoot,
    status: "review-required",
    mutation: false,
    executionPerformed: false,
    bundleApproval: plan.approval,
    bundleReview: { mediaExposure: plan.mediaExposure, mediaPorts: plan.mediaPorts,
      mediaSelection: selectedMedia,
      inputFingerprints: plan.inputFingerprints, command: planCommand },
    services,
    statusErrors: status.errors,
    privateHttps: { ready: status.privateHttps?.ready === true, lifecycle: status.privateHttps?.lifecycle },
    current: {
      checkpoint: checkpoint.checkpoint,
      service: checkpoint.service,
      reason: checkpoint.reason ?? null,
      reviewCommand,
      review,
      requiresReview: true,
      runAfterReview,
      adapterApproval: adapterToken,
      command: exactCommand(checkpoint.command),
      afterApproval: checkpoint.afterApproval ?? null,
      afterVerification: checkpoint.afterVerification ?? null,
      prohibitedAutomation: checkpoint.prohibitedAutomation ?? [],
      homarrAttachments: attachmentInbox(checkpoint.homarrAttachments, plan.projectRoot, plan.input),
    },
    deferredGates: next.deferredGates,
    commands: { plan: planCommand, status: statusCommand, next: nextCommand },
    observationScope: "Identical adapter status arguments share one observation only inside this read-only invocation; new commands and mutation preflights obtain fresh observations.",
    scope: "Read-only review inbox. Review the full plan or reviewCommand facts before using any exact token. No adapter apply, browser, private-HTTPS, Homarr, direct acceptance, or recovery gate is automated.",
  }, null, 2));
}
