import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SetupRecord } from "../../../../.agents/skills/self-host/workflows/selfhost/references/catalog/types/setup.ts";
import { setupAdapterSource } from "./setup-contract.ts";

export type SharedAcceptanceContract = {
  sha256: string;
  inputs(value: Readonly<Record<string, string>>): Readonly<Record<string, string>>;
  beginEffect: string;
  finishEffect: string;
  cleanup: string;
  verified(result: SetupRecord): boolean;
};
const contracts = new Map<string, SharedAcceptanceContract>();
const CHECKS = ["application-health", "core-round-trip", "restart-persistence"];
function fail(): never { throw new Error("Packaged app acceptance contract is invalid or changed"); }
function exact(value: unknown, keys: string[]): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join() === [...keys].sort().join();
}
function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 96;
}
/** Exact packaged source only: callers supply only catalog app selection. */
export function readSharedAcceptanceSource(url: URL): string {
  const path = fileURLToPath(url);
  if (realpathSync(path) !== path) fail();
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.size < 1 || before.size > 1024 * 1024
      || (process.platform !== "win32" && (before.mode & 0o002))) fail();
    const bytes = readFileSync(fd, "utf8"); const after = fstatSync(fd); const named = lstatSync(path);
    if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs
      || named.ino !== before.ino || named.dev !== before.dev || named.isSymbolicLink()) fail();
    return bytes;
  } finally { closeSync(fd); }
}

/** Resolve beside the catalog-selected setup source; never accept supplied JSON. */
export async function loadSharedAcceptanceContract(appId: string): Promise<SharedAcceptanceContract | null> {
  const setup = await setupAdapterSource(appId);
  if (!setup) return null;
  const url = new URL(setup.url.href.replace(/setup\.(ts|js)$/, "acceptance-contract.json"));
  let bytes: string;
  try { bytes = readSharedAcceptanceSource(url); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const cached = contracts.get(appId);
  if (cached) { if (cached.sha256 !== sha256) fail(); return cached; }
  let value: unknown;
  try { value = JSON.parse(bytes); } catch { fail(); }
  if (!exact(value, ["schemaVersion", "appId", "dimension", "inputs", "beginEffect", "finishEffect", "cleanup", "checks"])
    || value.schemaVersion !== 1 || value.appId !== appId || value.dimension !== "liveRestart"
    || !identifier(value.cleanup) || !Array.isArray(value.inputs) || value.inputs.length > 8
    || !exact(value.checks, CHECKS)) fail();
  for (const effect of [value.beginEffect, value.finishEffect]) {
    if (typeof effect !== "string" || effect.length < 1 || effect.length > 256 || /[\r\n\0]/.test(effect)) fail();
  }
  const definitions = value.inputs as Record<string, any>[];
  for (const definition of definitions) {
    if (!definition || !identifier(definition.key)) fail();
    if (definition.format === "positive-integer") {
      if (!exact(definition, ["key", "format", "maximumDigits"]) || !Number.isSafeInteger(definition.maximumDigits)
        || definition.maximumDigits < 1 || definition.maximumDigits > 10) fail();
    } else if (definition.format === "uuid") {
      if (!exact(definition, ["key", "format"])) fail();
    } else if (definition.format === "opaque-id") {
      if (!exact(definition, ["key", "format", "maximumLength"]) || !Number.isSafeInteger(definition.maximumLength)
        || definition.maximumLength < 1 || definition.maximumLength > 128) fail();
    } else fail();
  }
  if (new Set(definitions.map((item) => item.key)).size !== definitions.length) fail();
  const checks = value.checks as Record<string, Record<string, unknown>>;
  for (const check of CHECKS) {
    const conditions = checks[check];
    if (!conditions || typeof conditions !== "object" || Array.isArray(conditions)
      || Object.keys(conditions).length < 1 || Object.keys(conditions).length > 8) fail();
    for (const [field, expected] of Object.entries(conditions)) {
      if (!/^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(field) || ["constructor", "prototype", "__proto__"].includes(field)
        || (expected !== true && !identifier(expected))) fail();
    }
  }
  if (checks["application-health"]!.appHealthObserved !== true
    || checks["restart-persistence"]!.restartPersistenceVerified !== true
    || !Object.values(checks["core-round-trip"]!).includes(true)) fail();
  const contract: SharedAcceptanceContract = {
    sha256, beginEffect: value.beginEffect, finishEffect: value.finishEffect, cleanup: value.cleanup,
    inputs(input) {
      if (!input || typeof input !== "object" || Array.isArray(input)
        || Object.keys(input).sort().join() !== definitions.map((item) => item.key).sort().join()) fail();
      const selected: Record<string, string> = {};
      for (const definition of definitions) {
        const text = input[definition.key];
        if (typeof text !== "string") fail();
        if (definition.format === "positive-integer") {
          if (!/^[1-9][0-9]*$/.test(text) || text.length > definition.maximumDigits
            || !Number.isSafeInteger(Number(text))) fail();
        } else if (definition.format === "uuid") {
          if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(text)) fail();
        } else if (!/^[A-Za-z0-9_-]+$/.test(text) || text.length > definition.maximumLength) fail();
        selected[definition.key] = text;
      }
      return selected;
    },
    verified(result) {
      return result.cleanup === value.cleanup && CHECKS.every((check) =>
        Object.entries(checks[check]!).every(([field, expected]) => Object.hasOwn(result, field) && result[field] === expected));
    },
  };
  if (readSharedAcceptanceSource(url) !== bytes) fail();
  contracts.set(appId, contract);
  return contract;
}

/** Synchronous ledger checks use only the already loaded, checked app contract. */
export function sharedAcceptanceContract(appId: string): SharedAcceptanceContract | null {
  return contracts.get(appId) ?? null;
}
