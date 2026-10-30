import { describe, expect, test } from "bun:test"
import { parse } from "yaml"
import { buildCatalog, canGenerateYaml } from "../src/lib/catalog"
import { DEFAULT_SETTINGS } from "../src/lib/constants"
import { generateComposeContent } from "../src/lib/docker-compose/generators"
import { selfHostApps } from "../src/lib/selfhost"
import { tools } from "../src/tools"

interface ComposeService {
  container_name?: string
}

function servicesOf(content: string): Record<string, ComposeService> {
  return parse(content).services
}

const catalog = buildCatalog(tools)
const yamlEntries = catalog.entries.filter(canGenerateYaml)

describe("generated compose for the whole catalog", () => {
  for (const interpolated of [false, true]) {
    test(`has no duplicate service or container names (interpolated: ${interpolated})`, () => {
      const { content } = generateComposeContent(
        yamlEntries,
        DEFAULT_SETTINGS,
        interpolated,
      )
      const services = servicesOf(content)
      const containerNames = Object.values(services).flatMap((service) =>
        service.container_name ? [service.container_name] : [],
      )
      expect(new Set(containerNames).size).toBe(containerNames.length)
      expect(Object.keys(services).length).toBeGreaterThan(yamlEntries.length)
    })
  }

  test("keeps every standalone App's services", () => {
    const { content } = generateComposeContent(
      yamlEntries,
      DEFAULT_SETTINGS,
      false,
    )
    const services = servicesOf(content)
    const standalone = selfHostApps.filter((app) => app.standalone)
    expect(standalone.length).toBeGreaterThan(0)
    for (const app of standalone) {
      for (const name of Object.keys(servicesOf(app.compose))) {
        expect(services).toHaveProperty([name])
      }
    }
  })
})

describe("self-host overlap", () => {
  test("hides a Container whose services the self-host App already ships", () => {
    expect(catalog.entries.some((entry) => entry.id === "authentik")).toBe(true)
    expect(
      catalog.entries.some((entry) => entry.id === "authentik-worker"),
    ).toBe(false)
  })

  test("skips a Container whose services are already provided", () => {
    const authentik = catalog.entries.find((entry) => entry.id === "authentik")
    const worker = tools.find((tool) => tool.id === "authentik-worker")
    if (!authentik || !worker) throw new Error("authentik fixtures are missing")

    for (const order of [
      [authentik, worker],
      [worker, authentik],
    ]) {
      const { content } = generateComposeContent(order, DEFAULT_SETTINGS, false)
      const services = servicesOf(content)
      expect(Object.keys(services)).toContain("authentik-worker")
      expect(content).toContain(
        `${worker.name} skipped: already provided by ${authentik.name}`,
      )
    }
  })

  test("keeps the Container's own Compose when the App is not standalone", () => {
    const apps = selfHostApps.filter((app) => app.standalone === false)
    const merged = catalog.entries.filter(
      (entry) => entry.selfhostId && !entry.selfhostOnly,
    )
    const overlap = merged.filter((entry) =>
      apps.some((app) => app.id === entry.selfhostId),
    )
    expect(overlap.length).toBeGreaterThan(0)
    for (const entry of overlap) {
      const tool = tools.find((item) => item.id === entry.id)
      expect(entry.verbatim).toBeFalsy()
      expect(entry.composeContent).toBe(tool?.composeContent)
    }
  })

  test("lists non-standalone Apps without YAML but with an install command", () => {
    const installOnly = catalog.entries.filter((entry) => entry.installOnly)
    expect(installOnly.length).toBeGreaterThan(0)
    for (const entry of installOnly) {
      expect(canGenerateYaml(entry)).toBe(false)
      expect(entry.selfhostId).toBe(entry.id)
      expect(entry.notes).toBeTruthy()
    }
  })
})
