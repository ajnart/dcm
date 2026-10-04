/** Bounded, data-only read contracts shipped with the catalog; never runtime input. */
export const homarrVerificationSourceCommit = "c8c0a72bb016a2c46aa447d74eeba3e05fa7b070";
export type HomarrReadShape = "number" | "string" | "boolean" | "array" | "object"
  | { type: "object"; fields: Record<string, HomarrReadShape> }
  | { type: "array"; items: HomarrReadShape; minLength?: number; maxLength?: number }
  | { type: "nullable"; value: HomarrReadShape }
  | { type: "binding"; value: "integrationId" }
  | { type: "literal"; value: string | number | boolean };
const prerequisiteNames = ["immichAlbumId", "beszelSystemId", "umamiWebsiteId", "homeAssistantEntityId", "homeAssistantAutomationId"] as const;
export type HomarrWidgetRead = {
  kind: string; procedure: string; inputMode: "one" | "many";
  input?: Record<string, unknown>;
  inputBindings?: Record<string, typeof prerequisiteNames[number]>;
  dateBindings?: Record<string, "year" | "month">;
  envelope?: "direct";
  field: string | null; shape: HomarrReadShape;
};
export type HomarrReadVerification = { sourceCommit: string; widgets: HomarrWidgetRead[] };
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function invalid(): never { throw new Error("Catalog Homarr read contract is malformed"); }
function fields(value: Record<string, unknown>, names: string[]) {
  if (Object.keys(value).some((key) => !names.includes(key))) invalid();
}
function key(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(value)
    && !["constructor", "prototype", "__proto__"].includes(value);
}
function shape(value: unknown, depth = 0): void {
  if (depth > 6) invalid();
  if (typeof value === "string" && ["number", "string", "boolean", "array", "object"].includes(value)) return;
  if (!record(value)) invalid();
  if (value.type === "object") {
    fields(value, ["type", "fields"]);
    if (!record(value.fields) || Object.keys(value.fields).length > 32) invalid();
    for (const [name, child] of Object.entries(value.fields)) { if (!key(name)) invalid(); shape(child, depth + 1); }
  } else if (value.type === "array") {
    fields(value, ["type", "items", "minLength", "maxLength"]); shape(value.items, depth + 1);
    if (value.minLength !== undefined && (!Number.isInteger(value.minLength) || Number(value.minLength) < 0 || Number(value.minLength) > 1000)) invalid();
    if (value.maxLength !== undefined && (!Number.isInteger(value.maxLength) || Number(value.maxLength) < 0 || Number(value.maxLength) > 1000)) invalid();
    if (value.minLength !== undefined && value.maxLength !== undefined && Number(value.minLength) > Number(value.maxLength)) invalid();
  } else if (value.type === "nullable") {
    fields(value, ["type", "value"]); shape(value.value, depth + 1);
  } else if (value.type === "binding") {
    fields(value, ["type", "value"]); if (value.value !== "integrationId") invalid();
  } else if (value.type === "literal") {
    fields(value, ["type", "value"]);
    if (!["string", "number", "boolean"].includes(typeof value.value)
      || (typeof value.value === "string" && value.value.length > 80)
      || (typeof value.value === "number" && !Number.isFinite(value.value))) invalid();
  } else invalid();
}
function inputValue(value: unknown, depth = 0): void {
  if (depth > 3) invalid();
  if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return;
  if (typeof value === "string" && value.length <= 80 && /^[a-zA-Z0-9_. -]*$/.test(value)) return;
  if (Array.isArray(value) && value.length <= 16) { for (const child of value) inputValue(child, depth + 1); return; }
  invalid();
}
export function decodeHomarrReadVerification(value: unknown, widgetKinds: string[]): HomarrReadVerification {
  if (!record(value)) invalid(); fields(value, ["sourceCommit", "widgets"]);
  if (value.sourceCommit !== homarrVerificationSourceCommit || !Array.isArray(value.widgets) || value.widgets.length > 16) invalid();
  const kinds = new Set<string>();
  for (const contract of value.widgets) {
    if (!record(contract)) invalid();
    fields(contract, ["kind", "procedure", "inputMode", "input", "inputBindings", "dateBindings", "envelope", "field", "shape"]);
    if (typeof contract.kind !== "string" || !widgetKinds.includes(contract.kind) || kinds.has(contract.kind)
      || typeof contract.procedure !== "string" || !/^widget\.[a-zA-Z][a-zA-Z0-9]*\.[a-zA-Z][a-zA-Z0-9]*$/.test(contract.procedure)
      || /^(?:create|update|delete|mutate|enable|disable|execute|trigger|test)/i.test(contract.procedure.split(".").at(-1) ?? "")
      || !["one", "many"].includes(String(contract.inputMode))
      || (contract.field !== null && !key(contract.field))
      || (contract.envelope !== undefined && contract.envelope !== "direct")) invalid();
    kinds.add(contract.kind); shape(contract.shape);
    const inputKeys = new Set<string>();
    for (const name of ["input", "inputBindings", "dateBindings"]) {
      const object = contract[name]; if (object === undefined) continue;
      if (!record(object) || Object.keys(object).length > 16) invalid();
      for (const [inputKey, input] of Object.entries(object)) {
        if (!key(inputKey) || ["integrationId", "integrationIds"].includes(inputKey) || inputKeys.has(inputKey)) invalid(); inputKeys.add(inputKey);
        if (name === "input") inputValue(input);
        else if (name === "inputBindings" && !prerequisiteNames.includes(input as typeof prerequisiteNames[number])) invalid();
        else if (name === "dateBindings" && !["year", "month"].includes(String(input))) invalid();
      }
    }
  }
  return value as unknown as HomarrReadVerification;
}
export function homarrReadShapeMatches(value: unknown, contract: HomarrReadShape,
  bindings?: { integrationId: string }): boolean {
  if (typeof contract === "string") {
    if (contract === "number") return typeof value === "number" && Number.isFinite(value);
    if (contract === "array") return Array.isArray(value);
    if (contract === "object") return record(value);
    return typeof value === contract;
  }
  if (contract.type === "literal") return value === contract.value;
  if (contract.type === "binding") return typeof bindings?.integrationId === "string" && value === bindings.integrationId;
  if (contract.type === "nullable") return value === null || homarrReadShapeMatches(value, contract.value, bindings);
  if (contract.type === "array") return Array.isArray(value)
    && (contract.minLength === undefined || value.length >= contract.minLength)
    && (contract.maxLength === undefined || value.length <= contract.maxLength)
    && value.every((child) => homarrReadShapeMatches(child, contract.items, bindings));
  return record(value) && Object.entries(contract.fields).every(([name, child]) =>
    Object.hasOwn(value, name) && homarrReadShapeMatches(value[name], child, bindings));
}
