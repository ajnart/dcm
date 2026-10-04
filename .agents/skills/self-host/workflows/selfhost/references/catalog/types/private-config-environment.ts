export type PrivateConfigDeclaration = {
  id: string;
  officialUrl: string;
  parts: Array<{ literal: string } | { fileId: string }>;
};

/** Node's decoder is permissive; require the exact canonical padded encoding. */
export function isCanonicalPrivateBase64(value: string, bytes: number): boolean {
  if (!Number.isInteger(bytes) || bytes < 32 || bytes > 128
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  const decoded = Buffer.from(value, "base64");
  return decoded.length === bytes && decoded.toString("base64") === value;
}

/** Literal assembly only: neither an expression language nor an app-specific serializer. */
export function checkedPrivateConfigEnvironment(binding: unknown,
  configs: ReadonlyMap<string, PrivateConfigDeclaration>): PrivateConfigDeclaration {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    throw new Error("Private configuration environment binding is invalid");
  }
  const value = binding as Record<string, unknown>;
  if (Object.keys(value).sort().join(",") !== "fileId,format,name,officialUrl"
    || value.format !== "private-config" || typeof value.fileId !== "string"
    || typeof value.name !== "string" || !/^[A-Z][A-Z0-9_]{0,127}$/.test(value.name)
    || value.name.endsWith("_FILE")) {
    throw new Error("Private configuration environment binding is invalid");
  }
  const config = configs.get(value.fileId);
  if (!config || value.officialUrl !== config.officialUrl || !config.officialUrl.startsWith("https://")) {
    throw new Error("Private configuration environment needs its exact declared official source");
  }
  let bytes = 0;
  let literal = "";
  const checkLiteral = () => {
    if (/[\u0000-\u001f\u007f'$\\]/.test(literal)
      || /(?:password|passwd|secret|token|credential|api[_-]?key|private[_-]?key)"?\s*[:=]\s*"?[^\s"',;\]}]/i.test(literal)
      || /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i.test(literal)) {
      throw new Error("Private configuration environment literals must be single-line and non-secret");
    }
    literal = "";
  };
  for (const part of config.parts) {
    if ("literal" in part) {
      literal += part.literal;
      bytes += Buffer.byteLength(part.literal);
    } else {
      checkLiteral();
      // Supported generated private sources are at most 128 random bytes.
      bytes += 256;
    }
  }
  checkLiteral();
  if (bytes > 4096) throw new Error("Private configuration environment exceeds its bounded size");
  return config;
}

export function serializePrivateConfigEnvironment(name: string, value: string): string {
  if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(name) || value.length === 0
    || Buffer.byteLength(value) > 4096 || /[\u0000-\u001f\u007f'$\\]/.test(value)) {
    throw new Error("Private configuration environment value is not single-line and literal-safe");
  }
  return `${name}='${value}'`;
}
