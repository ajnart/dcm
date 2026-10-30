import { describe, expect, test } from "bun:test"
import { buildCatalog, canGenerateYaml } from "../src/lib/catalog"
import { DEFAULT_SETTINGS } from "../src/lib/constants"
import {
  generateComposeContent,
  generateEnvFile,
} from "../src/lib/docker-compose/generators"
import type { DockerTool } from "../src/lib/docker-tools"
import { selfHostApps } from "../src/lib/selfhost"
import { tools } from "../src/tools"

const REFERENCE = /(?<!\$)\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?([-+?=])[^}]*)?\}/g

function required(compose: string): Set<string> {
  const names = new Set<string>()
  for (const line of compose.split("\n")) {
    if (line.trim().startsWith("#")) continue
    for (const match of line.matchAll(REFERENCE)) {
      const operator = match[2]
      if (operator === undefined || operator === "?") names.add(match[1])
    }
  }
  return names
}

function defined(env: string): Set<string> {
  return new Set(
    [...env.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)=/gm)].map((match) => match[1]),
  )
}

function undefinedVariables(selected: DockerTool[]): string[] {
  const { content } = generateComposeContent(selected, DEFAULT_SETTINGS, false)
  const env = defined(generateEnvFile(selected, DEFAULT_SETTINGS))
  return [...required(content)].filter((name) => !env.has(name))
}

const catalog = buildCatalog(tools)
const yamlEntries = catalog.entries.filter(canGenerateYaml)
const candidates = [
  ...tools.filter((tool) => tool.composeContent),
  ...yamlEntries,
]

describe("generated .env", () => {
  test("defines every variable the generated compose requires, per tool and App", () => {
    const failures = candidates.flatMap((tool) => {
      const missing = undefinedVariables([tool])
      return missing.length > 0 ? [`${tool.id}: ${missing.join(", ")}`] : []
    })
    expect(failures).toEqual([])
  })

  test("defines every required variable for the whole catalog at once", () => {
    expect(undefinedVariables(yamlEntries)).toEqual([])
  })

  test("never defines a variable twice", () => {
    const env = generateEnvFile(yamlEntries, DEFAULT_SETTINGS)
    const keys = [...env.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)=/gm)].map(
      (match) => match[1],
    )
    const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index)
    expect([...new Set(duplicates)]).toEqual([])
  })

  test("adds App-specific variables with a secret placeholder and a comment", () => {
    const app = selfHostApps.find(
      (item) => item.standalone && item.env.some((variable) => variable.secret),
    )
    if (!app) throw new Error("no standalone App with a secret")
    const entry = yamlEntries.find((item) => item.selfhostId === app.id)
    if (!entry) throw new Error(`${app.id} is not in the catalog`)

    const env = generateEnvFile([entry], DEFAULT_SETTINGS)
    const secret = app.env.find((variable) => variable.secret)
    expect(env).toContain(`# ${entry.name} specific environment variables`)
    expect(env).toContain("# Secret: replace before starting")
    expect(env).toContain(`${secret?.key}=change-me`)
    for (const key of ["PUID", "PGID", "CONFIG_PATH", "TZ"]) {
      expect(env.match(new RegExp(`^${key}=`, "gm"))?.length).toBe(1)
    }
  })
})
