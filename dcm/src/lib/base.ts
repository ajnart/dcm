const base = (import.meta.env?.BASE_URL ?? "/").replace(/\/+$/, "")

const ABSOLUTE = /^([a-z][a-z0-9+.-]*:|\/\/)/i

export function withBase(path = "/"): string {
  if (ABSOLUTE.test(path)) return path
  const normalized = path.startsWith("/") ? path : `/${path}`
  return `${base}${normalized}`
}
