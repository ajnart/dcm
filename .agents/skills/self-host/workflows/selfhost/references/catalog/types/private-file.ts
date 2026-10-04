/** `bytes` describes entropy, not the encoded credential's character count. */
export type GeneratedPrivateFileFormat = "base64url" | "alphanumeric" | "hex" | "base64-prefixed" | "base64";

/** A setup capability is not an administrator password or an application API key. */
export function checkedBootstrapCapability(recipe: Record<string, any>): Record<string, any> | null {
  const files = recipe.privateFiles?.filter((file: any) => file?.purpose === "bootstrap-capability") ?? [];
  if (!files.length) return null;
  const file = files[0];
  let source: URL;
  try { source = new URL(file.officialUrl); }
  catch { throw new Error("Bootstrap capability requires its declared publisher source"); }
  const bindings = (recipe.services ?? []).flatMap((service: any) =>
    (service.secretEnvironment ?? []).filter((binding: any) => binding.fileId === file.id)
      .map((binding: any) => ({ service, binding })));
  if (files.length !== 1 || Object.keys(file).sort().join(",") !== "bytes,format,id,officialUrl,purpose"
    || file.id !== "setup-capability" || file.bytes !== 16 || file.format !== "hex"
    || source.protocol !== "https:" || source.username || source.password || source.hash
    || ![recipe.source, ...(recipe.imageSources ?? [])].includes(file.officialUrl)
    || recipe.onboarding?.fileId === file.id || bindings.length !== 1
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(bindings[0].service.id)
    || Object.keys(bindings[0].binding).sort().join(",") !== "fileId,name"
    || !/^[A-Z][A-Z0-9_]{0,127}$/.test(bindings[0].binding.name)
    || bindings[0].binding.name.endsWith("_FILE")
    || (recipe.services ?? []).some((service: any) => (service.fileEnvironment ?? [])
      .some((binding: any) => binding.fileId === file.id))
    || (recipe.privateConfigs ?? []).some((config: any) => config.parts?.some((part: any) => part.fileId === file.id))) {
    throw new Error("Bootstrap capability requires one exact generated hexadecimal setup binding");
  }
  return file;
}

export function generatedPrivateFileLength(bytes: number, format: GeneratedPrivateFileFormat): number {
  if (!Number.isInteger(bytes) || bytes < 32 || bytes > 128) {
    throw new Error("Generated private file entropy is outside the supported range");
  }
  if (format === "hex") return bytes * 2;
  if (format === "alphanumeric") return Math.ceil(bytes * 8 / Math.log2(62));
  if (format === "base64-prefixed") return 7 + Math.ceil(bytes / 3) * 4;
  if (format === "base64") return Math.ceil(bytes / 3) * 4;
  if (format === "base64url") return Math.ceil(bytes / 3) * 4 - ((3 - bytes % 3) % 3);
  throw new Error("Generated private file format is unsupported");
}
