#!/usr/bin/env node

import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_INPUT_BYTES = 64 * 1024;
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MEDIA_CONNECTIONS = Object.freeze([
  "seerr",
  "sonarr",
  "radarr",
  "prowlarr",
  "qbittorrent",
  "jellyfin",
]);
const CLASSIFICATIONS = new Set([
  "official-integration",
  "app-tile-only",
  "unsupported",
]);
const REQUIRED_OFFICIAL_APPS = new Set([...MEDIA_CONNECTIONS, "immich"]);
const DEFAULT_MAPPING = Object.freeze(Object.fromEntries(
  [...REQUIRED_OFFICIAL_APPS].map((name) => [name, "official-integration"]),
));
const COVERAGE_ENTRY_KEYS = new Set([
  "status",
  "surface",
  "identifier",
  "displayName",
  "appId",
  "appName",
  "lifecycle",
  "automation",
]);

function isRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseJson(encoded, label) {
  if (Buffer.byteLength(encoded, "utf8") > MAX_INPUT_BYTES) {
    throw new Error(`${label} is too large`);
  }
  let parsed;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    throw new Error(`${label} is invalid JSON`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`${label} must be an object`);
  }
  return parsed;
}

function readJsonFile(path, label) {
  const normalized = resolve(path);
  const stat = lstatSync(normalized);
  if (
    !stat.isFile()
    || stat.isSymbolicLink()
    || stat.nlink !== 1
    || realpathSync(normalized) !== normalized
    || stat.size < 1
    || stat.size > MAX_INPUT_BYTES
  ) {
    throw new Error(`${label} file is invalid`);
  }
  return parseJson(readFileSync(normalized, "utf8"), label);
}

async function readJsonStdin(label) {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.byteLength;
    if (size > MAX_INPUT_BYTES) {
      throw new Error(`${label} is too large`);
    }
    chunks.push(chunk);
  }
  return parseJson(Buffer.concat(chunks).toString("utf8"), label);
}

function normalizedList(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be a list`);
  }
  const result = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string" || !NAME_PATTERN.test(item) || seen.has(item)) {
      throw new Error(`${label} contains an invalid or duplicate name`);
    }
    seen.add(item);
    result.push(item);
  }
  return result;
}

export function validateSelection(value) {
  const allowed = new Set([
    "selectedApps",
    "media",
    "connectedIntegrations",
    "generatedDashboard",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error("selection contains unsupported fields");
  }
  const selectedApps = normalizedList(value.selectedApps, "selectedApps");
  let media = false;
  if (value.media !== undefined) {
    if (typeof value.media !== "boolean") {
      throw new Error("media must be boolean");
    }
    media = value.media;
  }
  let connectedIntegrations = [];
  if (value.connectedIntegrations !== undefined) {
    connectedIntegrations = normalizedList(
      value.connectedIntegrations,
      "connectedIntegrations",
    );
  }
  let generatedDashboard = false;
  if (value.generatedDashboard !== undefined) {
    if (typeof value.generatedDashboard !== "boolean") {
      throw new Error("generatedDashboard must be boolean");
    }
    generatedDashboard = value.generatedDashboard;
  }
  return { selectedApps, media, connectedIntegrations, generatedDashboard };
}

function assertRequiredOfficial(mapping) {
  for (const name of REQUIRED_OFFICIAL_APPS) {
    if (mapping[name] !== "official-integration") {
      throw new Error("required Homarr integration coverage is missing");
    }
  }
}

export function validateMapping(value) {
  const mapping = { ...DEFAULT_MAPPING };
  for (const [name, classification] of Object.entries(value)) {
    if (!NAME_PATTERN.test(name) || !CLASSIFICATIONS.has(classification)) {
      throw new Error("integration mapping is invalid");
    }
    if (REQUIRED_OFFICIAL_APPS.has(name) && classification !== "official-integration") {
      throw new Error("integration mapping contradicts required official coverage");
    }
    mapping[name] = classification;
  }
  assertRequiredOfficial(mapping);
  return mapping;
}

function exactKeys(value, allowed) {
  const keys = Object.keys(value);
  return keys.length === allowed.size && keys.every((key) => allowed.has(key));
}

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

export function mappingFromCoverage(value) {
  const rootKeys = new Set(["checkedAt", "officialSources", "counts", "entries"]);
  if (!exactKeys(value, rootKeys)) {
    throw new Error("Homarr coverage handoff fields are invalid");
  }
  if (
    typeof value.checkedAt !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.checkedAt)
    || !Array.isArray(value.officialSources)
    || !value.officialSources.every((source) => nonEmptyString(source))
    || !isRecord(value.counts)
    || !Array.isArray(value.entries)
    || value.entries.length === 0
    || value.entries.length > 512
  ) {
    throw new Error("Homarr coverage handoff is invalid");
  }

  const mapping = {};
  for (const entry of value.entries) {
    if (!isRecord(entry) || !exactKeys(entry, COVERAGE_ENTRY_KEYS)) {
      throw new Error("Homarr coverage entry fields are invalid");
    }
    if (
      typeof entry.appId !== "string"
      || !NAME_PATTERN.test(entry.appId)
      || !nonEmptyString(entry.appName)
      || !nonEmptyString(entry.lifecycle)
      || !nonEmptyString(entry.automation)
      || entry.appId in mapping
    ) {
      throw new Error("Homarr coverage entry is invalid or duplicated");
    }
    if (entry.status === "supported") {
      if (
        (entry.surface !== "standard" && entry.surface !== "special")
        || !nonEmptyString(entry.identifier)
        || !nonEmptyString(entry.displayName)
      ) {
        throw new Error("supported Homarr coverage entry is invalid");
      }
      mapping[entry.appId] = "official-integration";
      continue;
    }
    if (
      entry.status !== "gap"
      || entry.surface !== null
      || entry.identifier !== null
      || entry.displayName !== null
    ) {
      throw new Error("gap Homarr coverage entry is invalid");
    }
    mapping[entry.appId] = "app-tile-only";
  }
  assertRequiredOfficial(mapping);
  return { mapping, checkedAt: value.checkedAt };
}

function displayClassification(classification) {
  if (classification === "official-integration") {
    return "official integration";
  }
  if (classification === "app-tile-only") {
    return "app-tile-only gap";
  }
  return "unsupported";
}

export function buildPlan(selection, mapping, classificationSource = null) {
  const classifications = selection.selectedApps.map((name) => {
    let classification = mapping[name];
    if (classification === undefined) {
      classification = "unsupported";
    }
    return {
      app: name,
      classification: displayClassification(classification),
    };
  });
  const connected = new Set(selection.connectedIntegrations);
  const missingConnections = [];
  if (selection.media) {
    for (const name of MEDIA_CONNECTIONS) {
      if (!connected.has(name)) {
        missingConnections.push(name);
      }
    }
  }
  let generatedDashboardGate = "not-requested";
  if (selection.generatedDashboard) {
    generatedDashboardGate = "ready-for-managed-evidence-check";
    if (selection.media && missingConnections.length > 0) {
      generatedDashboardGate = "blocked-missing-media-connections";
    }
  }

  return {
    schemaVersion: 1,
    operation: "read-only-plan",
    image: "ghcr.io/homarr-labs/homarr-test:v2",
    classificationSource,
    classifications,
    steps: [
      {
        id: "onboarding-integrations",
        action: "Configure each selected official integration during onboarding.",
      },
      {
        id: "auto-population",
        action: "Observe onboarding-created app tiles and widgets as separate outputs.",
      },
      {
        id: "app-links",
        action: "Collect managed evidence for each app tile navigation and ping target.",
      },
      {
        id: "widgets",
        action: "Collect managed evidence for widget presence, source, and rendered content.",
      },
      {
        id: "api-key",
        action: "Create Authentication under /manage/tools/api and store it through the stdin pipeline.",
      },
      {
        id: "mcp",
        action: "Verify ApiKey authentication on canonical /api/mcp before client installation.",
      },
    ],
    media: {
      enabled: selection.media,
      requiredConnections: MEDIA_CONNECTIONS,
      observedConnections: selection.connectedIntegrations,
      missingConnections,
      generatedDashboardRequested: selection.generatedDashboard,
      generatedDashboardGate,
    },
  };
}

export async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 && args.length !== 3) {
    throw new Error("selection input is required");
  }
  if (
    args.length === 3
    && args[1] !== "--mapping"
    && args[1] !== "--coverage"
  ) {
    throw new Error("classification option is invalid");
  }
  if (args.length === 3 && args[0] === "-" && args[2] === "-") {
    throw new Error("only one stdin input is supported");
  }

  let selectionInput;
  if (args[0] === "-") {
    selectionInput = await readJsonStdin("selection");
  } else {
    selectionInput = readJsonFile(args[0], "selection");
  }
  let mapping = validateMapping({});
  let classificationSource = {
    kind: "standalone-fallback",
    checkedAt: null,
  };
  if (args.length === 3) {
    let classificationInput;
    if (args[2] === "-") {
      classificationInput = await readJsonStdin("classification");
    } else {
      classificationInput = readJsonFile(args[2], "classification");
    }
    if (args[1] === "--coverage") {
      const handoff = mappingFromCoverage(classificationInput);
      mapping = handoff.mapping;
      classificationSource = {
        kind: "catalog-homarr",
        checkedAt: handoff.checkedAt,
      };
    } else {
      mapping = validateMapping(classificationInput);
      classificationSource = {
        kind: "normalized-mapping",
        checkedAt: null,
      };
    }
  }
  const selection = validateSelection(selectionInput);
  process.stdout.write(`${JSON.stringify(
    buildPlan(selection, mapping, classificationSource),
    null,
    2,
  )}\n`);
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main().catch(() => {
    process.stdout.write("FAIL Homarr integration plan\n");
    process.exitCode = 1;
  });
}
