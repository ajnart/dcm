import type { DockerSettings } from "@/lib/settings"
import { type EmittedTool, type PlacedTool, keptContent } from "./compose"
import { freshSecret } from "./secrets"
import type { SecretFor } from "./types"

const VARIABLE_REFERENCE =
  /(?<!\$)\$\{([A-Za-z_][A-Za-z0-9_]*)(:?[-+?=][^}]*)?\}/g

const ANY_REFERENCE = /(?<!\$)\$\{([A-Za-z_][A-Za-z0-9_]*)/g

function hasKey(content: string, key: string): boolean {
  return new RegExp(`^${key}=`, "m").test(content)
}

function activeLines(content: string): string[] {
  return content.split("\n").filter((line) => !line.trim().startsWith("#"))
}

function requiredVariables(content: string): string[] {
  const names = new Set<string>()
  for (const line of activeLines(content)) {
    for (const match of line.matchAll(VARIABLE_REFERENCE)) {
      const operator = match[2]?.replace(/^:/, "")[0]
      if (!operator || operator === "?") names.add(match[1])
    }
  }
  return [...names]
}

function referencedVariables(content: string): Set<string> {
  const names = new Set<string>()
  for (const line of activeLines(content)) {
    for (const match of line.matchAll(ANY_REFERENCE)) names.add(match[1])
  }
  return names
}

function globalVariables(settings: DockerSettings): string {
  return `# Docker Compose Environment Variables
# These can be overridden by setting them in your shell or in a .env file

# User/Group Identifiers
# These help avoid permission issues between host and container
PUID=${settings.puid}
PGID=${settings.pgid}
UMASK=${settings.umask}

# Container name prefix
CONTAINER_PREFIX=${settings.containerNamePrefix}

# Paths for persistent data
CONFIG_PATH=${settings.configPath}
DATA_PATH=${settings.dataPath}

# Container settings
TZ=${settings.timezone}
RESTART_POLICY=${settings.restartPolicy}
NETWORK_MODE=${settings.networkMode}
`
}

function appVariables(
  entry: EmittedTool,
  existing: string,
  secretFor: SecretFor,
): string {
  const content = keptContent(entry)
  const referenced = referencedVariables(content)
  const missing = (entry.tool.env ?? []).filter(
    (variable) =>
      referenced.has(variable.key) && !hasKey(existing, variable.key),
  )
  if (missing.length === 0) return ""
  const lines = missing.flatMap((variable) => {
    const note = variable.description ? [`# ${variable.description}`] : []
    if (variable.external) {
      return [
        ...note,
        "# External value: not generated, get it from the service it belongs to",
        `${variable.key}=`,
      ]
    }
    if (variable.secret && variable.bytes) {
      return [
        ...note,
        "# Secret: generated in your browser, keep it private",
        `${variable.key}=${secretFor(variable.key, variable.bytes)}`,
      ]
    }
    return [...note, `${variable.key}=${variable.default}`]
  })
  return `\n# ${entry.tool.name} specific environment variables\n${lines.join("\n")}\n`
}

function containerVariables(entry: EmittedTool, existing: string): string {
  const content = keptContent(entry)
  const lines: string[] = []
  const has = (key: string) =>
    hasKey(existing, key) || lines.some((line) => line.startsWith(`${key}=`))

  if (/environment:(?:\s*-\s*([A-Z0-9_]+)=.+)+/ms.test(content)) {
    for (const match of content.matchAll(/^\s*-\s*([A-Z0-9_]+)=(.+)$/gm)) {
      const value = match[2].trim().replace(/^(["'])(.*)\1$/, "$2")
      if (value.includes("${") || has(match[1])) continue
      lines.push(`${match[1]}=${value}`)
    }
  }

  const required = requiredVariables(content).filter((name) => !has(name))
  if (required.length > 0) {
    lines.push(
      "# Required: set a value before starting",
      ...required.map((name) => `${name}=`),
    )
  }

  if (lines.length === 0) return ""
  return `\n# ${entry.tool.name} specific environment variables\n${lines.join("\n")}\n`
}

export function renderEnv(
  placed: PlacedTool[],
  settings: DockerSettings,
  secretFor: SecretFor = freshSecret,
): string {
  let env = globalVariables(settings)
  for (const entry of placed) {
    if (entry.kind === "duplicate") continue
    env += entry.tool.verbatim
      ? appVariables(entry, env, secretFor)
      : containerVariables(entry, env)
  }
  return env
}
