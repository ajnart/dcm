export type InstallInputDefinition = { key: string; label: string; maxLength: number };
export type InstallInputChoice = { appId: string; installInputDefinitions?: readonly InstallInputDefinition[] };

export function installInputError(value: string, field: InstallInputDefinition): string | undefined {
  if (value.length === 0 || value.length > field.maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    return `Enter a non-secret choice of 1–${field.maxLength} characters without control characters`;
  }
  return undefined;
}

/** Preserve the declared input values verbatim in both installation review and apply. */
export async function collectSharedInstallInputArgs(choices: readonly InstallInputChoice[],
  selected: readonly string[], prompt: (appId: string, field: InstallInputDefinition) => Promise<string>): Promise<string[]> {
  const args: string[] = [];
  for (const appId of [...selected].sort()) {
    const choice = choices.find((item) => item.appId === appId);
    if (!choice) throw new Error("Installation input app differs from the selected recipes");
    const fields = choice.installInputDefinitions ?? [];
    if (!Array.isArray(fields) || fields.length > 16 || new Set(fields.map((field) => field.key)).size !== fields.length
      || fields.some((field) => !field || !/^[a-z][a-z0-9-]{0,47}$/.test(field.key)
        || /(password|secret|token|cookie|api-?key)/i.test(field.key)
        || typeof field.label !== "string" || field.label.length < 1 || field.label.length > 512
        || !Number.isInteger(field.maxLength) || field.maxLength < 1 || field.maxLength > 512)) {
      throw new Error("Installation input definitions are invalid or secret-bearing");
    }
    for (const field of fields) {
      const value = await prompt(appId, field);
      if (typeof value !== "string" || installInputError(value, field)) {
        throw new Error("The declared installation input is missing or invalid");
      }
      args.push("--input", `${appId}.${field.key}=${value}`);
    }
  }
  return args;
}
