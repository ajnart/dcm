type Entry = Record<string, any>;
export type MutableConfigDeclaration = {
  id: string; filename: string; officialUrl: string; hook: "./mutable-config.ts";
  containerUid: number;
  containerUidEvidence: { image: string; uid: number; officialUrl: string };
  sourceFiles: string[];
  inputs?: Record<string, string | number | boolean>;
};
export type MutableConfigContext = {
  recipe: Entry; configId: string; inputs: Record<string, string | number | boolean>; readPrivateFile(id: string): Promise<string>;
};
export type MutableConfigHook = {
  initialize(context: MutableConfigContext): Promise<string>;
  validate(content: string, context: MutableConfigContext): Promise<void>;
};

/** Catalog-owned hooks handle semantics; the shared owner handles filesystem safety. */
export function checkedMutableConfigs(recipe: Entry): Map<string, MutableConfigDeclaration> {
  const declarations = new Map<string, MutableConfigDeclaration>();
  if (recipe.mutableConfigs === undefined) return declarations;
  if (!Array.isArray(recipe.mutableConfigs) || recipe.mutableConfigs.length < 1 || recipe.mutableConfigs.length > 8) {
    throw new Error("Mutable configuration declarations are invalid");
  }
  const used = new Set<string>();
  for (const config of recipe.mutableConfigs) {
    const keys = Object.keys(config ?? {}).filter((key) => key !== "inputs").sort().join(",");
    if (keys !== "containerUid,containerUidEvidence,filename,hook,id,officialUrl,sourceFiles"
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(config.id ?? "")
      || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(config.filename ?? "")
      || config.hook !== "./mutable-config.ts" || !Number.isInteger(config.containerUid)
      || config.containerUid < 0 || config.containerUid > 2147483647
      || !Array.isArray(config.sourceFiles) || config.sourceFiles.length < 1 || config.sourceFiles.length > 24
      || !config.sourceFiles.includes("mutable-config.ts") || new Set(config.sourceFiles).size !== config.sourceFiles.length
      || config.sourceFiles.some((file: unknown) => typeof file !== "string" || !/^[a-z0-9][a-z0-9-]*\.(?:ts|json)$/.test(file))
      || declarations.has(config.id)
      || [...(recipe.privateFiles ?? []), ...(recipe.privateConfigs ?? []), ...(recipe.configFiles ?? [])]
        .some((file: Entry) => file.id === config.id)) {
      throw new Error("Mutable configuration declaration is invalid");
    }
    if (config.inputs !== undefined && (config.inputs === null || Array.isArray(config.inputs)
      || typeof config.inputs !== "object" || Object.keys(config.inputs).length > 16
      || Object.entries(config.inputs).some(([key, value]) => !/^[a-z][a-zA-Z0-9-]{0,63}$/.test(key)
        || /password|secret|token|credential|api.?key/i.test(key)
        || !["string", "number", "boolean"].includes(typeof value)
        || (typeof value === "string" && (value.length > 2048 || /[\r\n\0]/.test(value)))
        || (typeof value === "number" && !Number.isFinite(value))))) {
      throw new Error("Mutable configuration inputs must be bounded non-secret selections");
    }
    const url = new URL(config.officialUrl);
    if (url.protocol !== "https:" || url.username || url.password
      || ![recipe.source, ...(recipe.imageSources ?? [])].includes(config.officialUrl)) {
      throw new Error("Mutable configuration requires recipe-bound official evidence");
    }
    declarations.set(config.id, config);
  }
  for (const service of recipe.services ?? []) {
    for (const mount of service.mounts ?? []) {
      if (mount.name === "mutable-configs") throw new Error("mutable-configs is reserved for owner-private mutable state");
      if (mount.kind !== "mutable-directory") continue;
      const config = declarations.get(mount.fileId);
      if (Object.keys(mount).sort().join(",") !== "fileId,kind,name,target" || !config
        || used.has(config.id) || mount.name !== config.id
        || !/^\/[A-Za-z0-9/_.-]+$/.test(mount.target ?? "")
        || mount.target.endsWith("/") || mount.target.includes("//")
        || mount.target.split("/").some((part: string) => part === "." || part === "..")) {
        throw new Error("Mutable configuration requires one exact writable directory binding");
      }
      const evidence = config.containerUidEvidence;
      if (Object.keys(evidence ?? {}).sort().join(",") !== "image,officialUrl,uid"
        || evidence.uid !== config.containerUid || evidence.image !== service.imageTag
        || !/@sha256:[a-f0-9]{64}$/.test(evidence.image ?? "")
        || ![recipe.source, service.imageSource, ...(recipe.imageSources ?? [])].includes(evidence.officialUrl)
        || !String(evidence.officialUrl).startsWith("https://")) {
        throw new Error("Mutable configuration requires immutable image-bound numeric UID evidence");
      }
      // Do not pretend a declared UID grants readability. It must match the
      // actual image user evidence, or an explicitly reviewed numeric user.
      let uid = service.user;
      if (uid === "host-selected" && service.imageUserEvidence?.reason === "official-image-runtime-contract"
        && [recipe.source, ...(recipe.imageSources ?? [])].includes(service.imageUserEvidence?.officialUrl)) uid = config.containerUid;
      if (uid === "image-default" && service.imageUserEvidence?.reason === "official-image-runtime-contract"
        && typeof service.imageUserEvidence?.officialUrl === "string"
        && [recipe.source, ...(recipe.imageSources ?? [])].includes(service.imageUserEvidence.officialUrl)) uid = config.containerUid;
      if (uid === "root") uid = 0;
      if (typeof uid === "string" && /^\d+(?::\d+)?$/.test(uid)) uid = Number(uid.split(":")[0]);
      if (uid !== config.containerUid) throw new Error("Mutable configuration image UID does not match its service user");
      used.add(config.id);
    }
  }
  if (used.size !== declarations.size) throw new Error("Every mutable configuration needs one writable directory binding");
  return declarations;
}
