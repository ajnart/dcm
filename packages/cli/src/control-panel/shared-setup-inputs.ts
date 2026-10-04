export type SharedSetupInput = { appId: string; key: string; label: string };
export type SharedSetupStep = { appId: string; action: string; token: string; progress: string };

export function setupInputValueError(value: string): string | undefined {
  if (value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) {
    return "Use at most 512 characters without control characters";
  }
  return undefined;
}

/** Blank leaves an optional adapter choice unset; no infrastructure paths are invented. */
export async function collectSharedSetupInputArgs(value: unknown, selected: readonly string[],
  prompt: (field: SharedSetupInput) => Promise<string>): Promise<string[]> {
  if (!Array.isArray(value) || value.length > selected.length * 16) {
    throw new Error("Shared setup returned invalid input definitions");
  }
  const args: string[] = [];
  const seen = new Set<string>();
  for (const field of value) {
    if (!field || typeof field !== "object" || !selected.includes(field.appId)
      || typeof field.key !== "string" || !/^[a-z][a-z0-9-]{0,47}$/.test(field.key)
      || /(password|secret|token|cookie|api-?key)/i.test(field.key)
      || typeof field.label !== "string" || field.label.length < 1 || field.label.length > 120) {
      throw new Error("Shared setup returned invalid non-secret input definitions");
    }
    const id = `${field.appId}.${field.key}`;
    if (seen.has(id)) throw new Error("Shared setup returned duplicate input definitions");
    seen.add(id);
    const input = await prompt(field);
    if (typeof input !== "string" || setupInputValueError(input)) {
      throw new Error("Shared setup input is invalid");
    }
    if (input.length > 0) args.push("--input", `${id}=${input}`);
  }
  return args;
}

/** Validate the complete current approval round before presenting any of it. */
export function sharedSetupStepBatch(value: unknown, selected: readonly string[]): SharedSetupStep[] {
  if (!Array.isArray(value) || value.length > selected.length * 16) {
    throw new Error("First-run setup returned an invalid step approval batch");
  }
  const tokens = new Set<string>();
  for (const step of value) {
    if (!step || typeof step !== "object" || !selected.includes(step.appId)
      || typeof step.action !== "string" || !/^[a-z][a-z0-9-]*$/.test(step.action)
      || typeof step.token !== "string" || !/^[A-Z][A-Z0-9-]*:[a-z0-9_-]+:[0-9a-f]{64}$/.test(step.token)
      || typeof step.progress !== "string" || step.progress.length < 1 || step.progress.length > 1024
      || tokens.has(step.token)) {
      throw new Error("First-run setup returned an invalid step approval");
    }
    tokens.add(step.token);
  }
  return value;
}

export function sharedSetupOutcomeRecap(value: unknown, selected?: readonly string[]): string {
  if (!Array.isArray(value)) return "No first-run result was reported";
  if (value.length > 256) throw new Error("First-run setup returned too many outcomes");
  const seen = new Set<string>();
  const lines = value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)
      || typeof item.appId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.appId)
      || (selected && !selected.includes(item.appId)) || seen.has(item.appId)
      || !["ready", "deferred", "needs-inspection"].includes(item.state)
      || (item.detail !== undefined && (typeof item.detail !== "string" || item.detail.length > 1024))) {
      throw new Error("First-run setup returned an invalid app outcome");
    }
    seen.add(item.appId);
    let line = `${item.appId}: ${item.state}`;
    if (item.detail) line += `. ${item.detail.replace(/[\u0000-\u001f\u007f]/g, " ")}`;
    return line;
  });
  for (const appId of selected ?? []) {
    if (!seen.has(appId)) lines.push(`${appId}: result not reported; setup remains unverified`);
  }
  return lines.join("\n") || "No first-run result was reported";
}
