#!/usr/bin/env node

import { existsSync, writeSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function errorLine(message) {
  writeSync(2, `${message}\n`);
}

const builtEntry = new URL("../dist/workflows/selfhost/scripts/selfhost.js", import.meta.url);
const hostInspector = new URL("../dist/workflows/selfhost-host/scripts/inspect-host.sh", import.meta.url);
const householdBrowser = new URL("../dist/household-browser-credentials.js", import.meta.url);
const interactiveEntry = new URL("../dist/interactive.js", import.meta.url);
const primaryCommands = new Set(["bundle", "caddy-private", "config", "doctor", "docmost", "homarr", "immich", "vaultwarden", "info", "status", "up", "down", "resume", "help", "--help", "version", "--version"]);
const hostInspectAlias = process.argv[2] === "host" && process.argv[3] === "inspect";
if (process.argv[2] === "--interactive" || process.argv[2] === "interactive" || (process.argv.length === 2 && process.stdin.isTTY && process.stdout.isTTY)) {
  if (process.argv.length > 3 || (process.argv.length === 3 && !["--interactive", "interactive"].includes(process.argv[2]))) {
    errorLine("Interactive setup takes no additional arguments.");
    process.exitCode = 1;
  } else if (!existsSync(fileURLToPath(interactiveEntry))) {
    errorLine("Selfhost interactive setup is not built. Reinstall the package or run its build from a source checkout.");
    process.exitCode = 1;
  } else {
    try {
      const { interactive } = await import(interactiveEntry.href);
      await interactive();
    } catch (error) {
      errorLine(error instanceof Error ? error.message : "Interactive setup failed");
      process.exitCode = 1;
    }
  }
} else if (process.argv[2] === "inspect-host" || hostInspectAlias) {
  const inspectorPath = fileURLToPath(hostInspector);
  if (!existsSync(inspectorPath)) {
    errorLine("Selfhost CLI host inspector is not built. Reinstall the package or run its build from a source checkout.");
    process.exitCode = 1;
  } else {
    let inspectArgs = process.argv.slice(3);
    if (hostInspectAlias) inspectArgs = process.argv.slice(4);
    const result = spawnSync("bash", [inspectorPath, ...inspectArgs], { stdio: "inherit" });
    if (result.error) {
      errorLine("Host inspection could not start with bash.");
      process.exitCode = 1;
    } else {
      process.exitCode = result.status ?? 1;
      if (result.status === 0) {
        const outputIndex = inspectArgs.indexOf("--output");
        const reportPath = inspectArgs[outputIndex + 1];
        if (outputIndex >= 0 && reportPath && reportPath !== "-") {
          console.log(`Host report saved at ${JSON.stringify(reportPath)} (0600). Use it with bundle init --host-inspection.`);
        }
      }
    }
  }
} else if (process.argv[2] === "browser") {
  if (process.argv.length === 3 || ["help", "--help"].includes(process.argv[3])) {
    console.log("self-host browser fill|capture-api-key|login --project-root ABSOLUTE --run-id ID --service APP --origin PRIVATE_ORIGIN [--input FIELD=@eN | --selector @eN] [--browser-bin ABSOLUTE]\nLogin supports Vaultwarden only on its existing CA-trusted private HTTPS session. Use the isolated selfhost-household-ID agent-browser session. Pass --browser-bin when multiple installations exist; use the same executable to open the browser. Bun and agent-browser are required; values remain in the private handoff and browser stdin.");
  } else if (!existsSync(fileURLToPath(householdBrowser))) {
    errorLine("Selfhost browser credential helper is not built. Reinstall the package or run its build from a source checkout.");
    process.exitCode = 1;
  } else {
    const result = spawnSync("bun", [fileURLToPath(householdBrowser), ...process.argv.slice(3)], { stdio: "inherit" });
    if (result.error) {
      errorLine("Browser credential helper could not start with Bun; run self-host doctor.");
      process.exitCode = 1;
    } else {
      process.exitCode = result.status ?? 1;
    }
  }
} else if (process.argv[2] === "catalog" && process.argv[3] === "compatibility") {
  try {
    const { catalogCompatibilityCommand } = await import("../dist/catalog-compatibility.js");
    await catalogCompatibilityCommand(process.argv.slice(4));
  } catch (error) {
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify({ schemaVersion: 1, command: "catalog compatibility", status: "failed", mutation: false,
        error: { message: error instanceof Error ? error.message : "Compatibility inspection failed" } }, null, 2));
    } else errorLine(error instanceof Error ? error.message : "Compatibility inspection failed");
    process.exitCode = 1;
  }
} else if (process.argv[2] === "connect") {
  try {
    const { connectCommand } = await import("../dist/connect.js");
    await connectCommand(process.argv.slice(3));
  } catch (error) {
    errorLine(error instanceof Error ? error.message : "Connection command failed");
    process.exitCode = 1;
  }
} else if (process.argv[2] === "app") {
  let appModule;
  try {
    appModule = await import("../dist/app.js");
    await appModule.appCommand(process.argv.slice(3));
  } catch (error) {
    const action = process.argv[3];
    const validActions = new Set(["image", "plan", "apply", "resume", "status", "info", "up", "down",
      "onboard", "close-plan", "close-setup", "photo-check", "login-check", "document-check", "document-cleanup",
      "document-renew-plan", "document-renew", "monitor-list", "monitor-plan", "monitor-check",
      "monitor-create-plan", "monitor-create", "status-page-plan", "status-page-create", "status-page-status",
      "persistence-start", "persistence-finish",
      "account-plan", "account-prepare", "handoff", "homarr-input", "homarr-uptime-input", "homarr-paperless-input",
      "homarr-immich-input", "homarr-immich-key-plan", "homarr-immich-key-create",
      "paperless-token-plan", "paperless-token-create", "paperless-token-status"]);
    let stage = "command";
    if (validActions.has(action)) stage = action;
    const shared = action === "shared";
    const sharedActions = new Set(["plan", "apply", "add", "remove", "status", "resume", "setup", "handoff",
      "homarr-plan", "homarr-apply", "homarr-status", "homarr-trust-plan", "homarr-trust-apply", "transition-plan", "transition-apply",
      "job-plan", "job-run", "start", "stop", "https-plan", "https-apply", "https-proof",
      "canonical-origin-plan", "canonical-origin-apply", "acceptance-begin", "acceptance-finish",
      "recipe-migration-plan", "recipe-migration-apply", "image-transition-plan", "image-transition-apply",
      "authority-plan", "authority-apply", "authority-probe"]);
    if (shared) {
      const nested = process.argv[4];
      if (sharedActions.has(nested)) {
        stage = `shared ${nested}`;
      } else stage = "shared";
    }
    let readOnly = ["image", "plan", "status", "info", "close-plan", "login-check",
      "account-plan", "handoff", "monitor-list", "monitor-plan", "monitor-create-plan",
      "status-page-plan", "status-page-status",
      "document-renew-plan", "homarr-immich-key-plan", "paperless-token-plan",
      "paperless-token-status", "command"].includes(stage);
    if (shared) {
      readOnly = ["shared plan", "shared status", "shared handoff", "shared homarr-plan",
        "shared homarr-status", "shared homarr-trust-plan", "shared job-plan", "shared transition-plan", "shared recipe-migration-plan",
        "shared https-plan", "shared canonical-origin-plan", "shared image-transition-plan",
        "shared authority-plan"].includes(stage)
        || (["shared setup", "shared add", "shared start", "shared stop", "shared https-apply", "shared https-proof",
          "shared canonical-origin-apply", "shared acceptance-begin", "shared acceptance-finish",
          "shared authority-probe"].includes(stage)
          && !process.argv.includes("--approve"));
      if (stage === "shared remove") readOnly = !process.argv.includes("--apply");
    }
    const runtimeUnavailable = appModule && typeof appModule.ComposeRuntimeUnavailableError === "function"
      && error instanceof appModule.ComposeRuntimeUnavailableError;
    const runtimeMessage = "Bun 1.4.0 or newer must be available on PATH for Compose-backed app commands.";
    const runtimeNext = "Install Bun 1.4.0 or newer, ensure bun is on PATH, then run self-host doctor. Inspect saved status before retrying any approved write.";
    const known = appModule && ((typeof appModule.AppCommandError === "function"
      && error instanceof appModule.AppCommandError)
      || (typeof appModule.BatchCommandError === "function"
        && error instanceof appModule.BatchCommandError)
      || (typeof appModule.SharedProjectCommandError === "function"
        && error instanceof appModule.SharedProjectCommandError)
      || (typeof appModule.DockerApiAuthorityError === "function"
        && error instanceof appModule.DockerApiAuthorityError));
    const batch = action === "batch";
    if (batch) stage = ["plan", "apply", "status", "info", "resume-plan", "resume", "step-plan", "step"].includes(process.argv[4])
      ? `batch ${process.argv[4]}` : "batch";
    const batchReadOnly = stage === "batch plan" || stage === "batch status"
      || stage === "batch info" || stage === "batch resume-plan" || stage === "batch step-plan"
      || stage === "batch";
    if (process.argv.includes("--json")) {
      let code = "unexpected";
      if (runtimeUnavailable) code = "compose-bun-missing";
      else if (known && /^[a-z0-9-]{1,64}$/.test(error.code)) code = error.code;
      let commandName = `app ${stage}`;
      if (stage === "command") commandName = "app";
      let next = "Correct the local diagnostic, then retry this exact read-only app command.";
      if (!readOnly && !batchReadOnly) next = "Inspect this exact project's saved app status and owned resources before resume or retry.";
      if (batch) next = stage === "batch apply" || stage === "batch resume" || stage === "batch step"
        ? "Inspect the batch ledger and each exact app status before any recovery or retry."
        : "Correct the local diagnostic, then retry this exact read-only batch command.";
      if (!batch && (code === "app-lock-held" || code === "app-lock-ownership-changed")) {
        next = error.message;
      }
      if (!batch && code === "invalid-image-specification") {
        next = "Use one --image SERVICE=TAG@sha256:DIGEST for each service listed by catalog recipe, then review a fresh app plan.";
      }
      if (!batch && code === "shared-recipe-migration-required") {
        next = "The installed app's saved recipe differs from this CLI. Review an existing-project migration before verification; do not reset data, credentials or setup state.";
      }
      if (!batch && code === "expired-intent") {
        next = "Docker authority intent expired. Renewal is not supported; existing credentials and authority records were not replaced. Keep the saved project and inspect before retrying.";
      }
      if (runtimeUnavailable) next = runtimeNext;
      let partialWritePossible = !readOnly;
      if (batch) partialWritePossible = Boolean(known && error.partialWritePossible);
      else if (!runtimeUnavailable && known && typeof error.partialWritePossible === "boolean") {
        partialWritePossible = error.partialWritePossible;
      }
      const failure = { schemaVersion: 1, command: commandName, status: "failed",
        mutation: false, partialWritePossible, error: { code }, next };
      if (runtimeUnavailable) failure.error.message = runtimeMessage;
      if (batch && (stage === "batch apply" || stage === "batch resume" || stage === "batch step") && !known) failure.partialWritePossible = true;
      if (failure.partialWritePossible) failure.mutation = null;
      console.log(JSON.stringify(failure, null, 2));
    } else {
      let message = "App command failed unexpectedly; inspect this project before retrying.";
      if (runtimeUnavailable) message = `${runtimeMessage} ${runtimeNext}`;
      else if (known) message = error.message;
      errorLine(message);
    }
    process.exitCode = 1;
  }
} else if (process.argv[2] === "target") {
  try {
    const { targetCommand } = await import("../dist/target.js");
    targetCommand(process.argv.slice(3));
  } catch (error) {
    errorLine(error instanceof Error ? error.message : "Target command failed");
    process.exitCode = 1;
  }
} else if (process.argv[2] === "config" && process.argv[3] === "preferences") {
  if (process.argv.length === 4 || (process.argv.length === 5 && ["help", "--help"].includes(process.argv[4]))) {
    console.log(`self-host config preferences

  config preferences init (--project-root ABSOLUTE | --path ABSOLUTE) [--json]
  config preferences show (--project-root ABSOLUTE | --path ABSOLUTE) [--json]
  config preferences set <field> <value> (--project-root ABSOLUTE | --path ABSOLUTE) [--json]
  config preferences validate (--project-root ABSOLUTE | --path ABSOLUTE) [--json]`);
  } else {
    process.argv.splice(2, 2, "preferences");
    await import(builtEntry.href);
  }
} else if (primaryCommands.has(process.argv[2]) || process.argv.length === 2) {
  try {
    const [{ command }, { mediaCommand }, { immichCommand }, { vaultwardenCommand }, { homarrAttachCommand }, { homarrMcpCommand }, { docmostCommand }, { bundleCommand }] = await Promise.all([
      import("../dist/command.js"),
      import("../dist/media.js"),
      import("../dist/immich.js"),
      import("../dist/vaultwarden.js"),
      import("../dist/homarr-attach.js"),
      import("../dist/homarr-mcp.js"),
      import("../dist/docmost.js"),
      import("../dist/bundle.js"),
    ]);
    await command(process.argv.slice(2), mediaCommand, immichCommand, vaultwardenCommand, homarrAttachCommand, docmostCommand, bundleCommand, homarrMcpCommand);
  } catch (error) {
    const action = process.argv[2];
    const appLifecycle = ["info", "status", "up", "down", "resume"].includes(action);
    if (appLifecycle && process.argv.includes("--json")) {
      const readOnly = action === "info" || action === "status";
      const failure = { schemaVersion: 1, command: action, status: "failed",
        mutation: readOnly ? false : null, partialWritePossible: !readOnly,
        error: { code: "command-failed", message: error instanceof Error ? error.message : "Command failed" },
        next: readOnly ? "Select one exact saved project owner and retry." : "Inspect the exact saved project and owned resources before retrying." };
      console.log(JSON.stringify(failure, null, 2));
    } else errorLine(error instanceof Error ? error.message : "Command failed");
    process.exitCode = 1;
  }
} else if (process.argv[2] === "install" && process.argv[3] === "media") {
  try {
    const { mediaCommand } = await import("../dist/media.js");
    await mediaCommand(process.argv.slice(4));
  } catch (error) {
    errorLine(error instanceof Error ? error.message : "Media command failed");
    process.exitCode = 1;
  }
} else if (!existsSync(fileURLToPath(builtEntry))) {
  errorLine("Selfhost CLI is not built. Run `bun packages/cli/scripts/build.ts` from the source checkout.");
  process.exitCode = 1;
} else {
  await import(builtEntry.href);
}
