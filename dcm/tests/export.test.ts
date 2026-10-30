import { describe, expect, test } from "bun:test"
import { parse } from "yaml"
import {
  type Catalog,
  type CatalogEntry,
  buildCatalog,
} from "../src/lib/catalog"
import { buildExport } from "../src/lib/export"
import { selfHostApps } from "../src/lib/selfhost"
import { DEFAULT_SETTINGS } from "../src/lib/settings"
import { getToolsFromTemplate } from "../src/lib/templates"
import { tools } from "../src/tools"

interface ComposeService {
  container_name?: string
  environment?: Record<string, string> | string[]
  labels?: Record<string, string>
  ports?: string[]
}

const REFERENCE = /(?<!\$)\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?([-+?=])[^}]*)?\}/g

const catalog = buildCatalog(tools)
const allIds = catalog.entries.map((entry) => entry.id)
const composable = catalog.entries.filter(
  (entry) => entry.composeContent && !entry.isUnsupported,
)

function entryById(id: string): CatalogEntry {
  const found = catalog.entries.find((entry) => entry.id === id)
  if (!found) throw new Error(`${id} is not in the catalog`)
  return found
}

function exportOf(ids: string[], source: Pick<Catalog, "entries"> = catalog) {
  return buildExport(ids, source, DEFAULT_SETTINGS)
}

const filledBytes = (length: number) => new Uint8Array(length).fill(0xab)

const GENERATE_HINT = /openssl rand -hex (\d+)/

function envValue(env: string, key: string): string | undefined {
  return env.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1]
}

function servicesOf(content: string): Record<string, ComposeService> {
  return parse(content).services
}

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

function definedKeys(env: string): string[] {
  return [...env.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)=/gm)].map(
    (match) => match[1],
  )
}

function undefinedVariables(ids: string[]): string[] {
  const exported = exportOf(ids)
  const defined = new Set(definedKeys(exported.env))
  return [...required(exported.compose)].filter((name) => !defined.has(name))
}

function portEntry(id: string, body: string): CatalogEntry {
  return {
    id,
    name: id,
    description: id,
    category: "test",
    tags: [],
    verbatim: true,
    composeContent: `services:\n  ${id}:\n    image: ${id}\n    ports:\n      - "8080:80"\n${body}\n`,
  }
}

function portConflict(first: string, second: string) {
  const entries = [portEntry("app-one", first), portEntry("app-two", second)]
  const exported = buildExport(
    ["app-one", "app-two"],
    { entries },
    DEFAULT_SETTINGS,
  )
  const services = servicesOf(exported.compose)
  return { exported, one: services["app-one"], two: services["app-two"] }
}

describe("buildExport: selection", () => {
  test("resolves ids against the catalog and reports unknown ones", () => {
    const exported = exportOf(["plex", "does-not-exist"])
    expect(exported.entries.map((entry) => entry.id)).toEqual(["plex"])
    expect(exported.unresolved).toEqual(["does-not-exist"])
  })

  test("returns an empty export for an empty selection", () => {
    const exported = exportOf([])
    expect(exported.entries).toEqual([])
    expect(exported.composable).toEqual([])
    expect(exported.selfHostCommand).toBeNull()
    expect(exported.notes).toEqual([])
    expect(exported.portChanges).toEqual([])
  })

  test("separates install-only Apps from composable ones", () => {
    const installOnly = catalog.entries.filter((entry) => entry.installOnly)
    expect(installOnly.length).toBeGreaterThan(0)
    for (const entry of installOnly) {
      expect(entry.selfhostId).toBe(entry.id)
      expect(entry.notes).toBeTruthy()
    }

    const sample = installOnly[0]
    const exported = exportOf([sample.id, "plex"])
    expect(exported.installOnly.map((entry) => entry.id)).toEqual([sample.id])
    expect(exported.composable.map((entry) => entry.id)).toEqual(["plex"])
    expect(exported.compose).not.toContain(`# ${sample.name}:`)
    expect(exported.selfHostIds).toContain(sample.id)
    expect(exported.notes.map((note) => note.id)).toContain(sample.id)
  })

  test("keeps the Container's own Compose when the App is not standalone", () => {
    const apps = selfHostApps.filter((app) => app.standalone === false)
    const overlap = catalog.entries.filter(
      (entry) =>
        entry.selfhostId &&
        !entry.selfhostOnly &&
        apps.some((app) => app.id === entry.selfhostId),
    )
    expect(overlap.length).toBeGreaterThan(0)
    for (const entry of overlap) {
      const tool = tools.find((item) => item.id === entry.id)
      expect(entry.verbatim).toBeFalsy()
      expect(entry.composeContent).toBe(tool?.composeContent)
    }
  })

  test("hides a Container whose services the self-host App already ships", () => {
    expect(allIds).toContain("authentik")
    expect(allIds).not.toContain("authentik-worker")
  })
})

describe("buildExport: whole catalog", () => {
  for (const interpolated of [false, true]) {
    test(`has no duplicate service or container names (interpolated: ${interpolated})`, () => {
      const exported = exportOf(allIds)
      const services = servicesOf(
        interpolated ? exported.composeInterpolated : exported.compose,
      )
      const containerNames = Object.values(services).flatMap((service) =>
        service.container_name ? [service.container_name] : [],
      )
      expect(new Set(containerNames).size).toBe(containerNames.length)
      expect(Object.keys(services).length).toBeGreaterThan(
        exported.composable.length,
      )
    })
  }

  test("keeps every standalone App's services", () => {
    const services = servicesOf(exportOf(allIds).compose)
    const standalone = selfHostApps.filter((app) => app.standalone)
    expect(standalone.length).toBeGreaterThan(0)
    for (const app of standalone) {
      for (const name of Object.keys(servicesOf(app.compose))) {
        expect(services).toHaveProperty([name])
      }
    }
  })

  test("defines every variable the compose requires, per entry", () => {
    const failures = composable.flatMap((entry) => {
      const missing = undefinedVariables([entry.id])
      return missing.length > 0 ? [`${entry.id}: ${missing.join(", ")}`] : []
    })
    expect(failures).toEqual([])
  })

  test("defines every required variable for the whole catalog at once", () => {
    expect(undefinedVariables(allIds)).toEqual([])
  })

  test("never defines a variable twice", () => {
    const keys = definedKeys(exportOf(allIds).env)
    const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index)
    expect([...new Set(duplicates)]).toEqual([])
  })
})

describe("buildExport: env", () => {
  test("adds App-specific variables with a generated secret and a comment", () => {
    const app = selfHostApps.find(
      (item) =>
        item.standalone &&
        item.env.some(
          (variable) =>
            variable.secret && GENERATE_HINT.test(variable.description),
        ),
    )
    if (!app) throw new Error("no standalone App with a generated secret")
    const entry = composable.find((item) => item.selfhostId === app.id)
    if (!entry) throw new Error(`${app.id} is not in the catalog`)
    const secret = app.env.find(
      (variable) => variable.secret && GENERATE_HINT.test(variable.description),
    )
    const bytes = Number(secret?.description.match(GENERATE_HINT)?.[1])

    const { env } = buildExport([entry.id], catalog, DEFAULT_SETTINGS, {
      randomBytes: filledBytes,
    })
    expect(env).toContain(`# ${entry.name} specific environment variables`)
    expect(env).toContain(
      "# Secret: generated in your browser, keep it private",
    )
    expect(envValue(env, secret?.key ?? "")).toBe("ab".repeat(bytes))
    for (const key of ["PUID", "PGID", "CONFIG_PATH", "TZ"]) {
      expect(env.match(new RegExp(`^${key}=`, "gm"))?.length).toBe(1)
    }
  })

  test("generates every secret a standalone App can generate, and only those", () => {
    let generated = 0
    let placeholders = 0
    for (const app of selfHostApps.filter((item) => item.standalone)) {
      const entry = composable.find((item) => item.selfhostId === app.id)
      if (!entry) continue
      const { env } = buildExport([entry.id], catalog, DEFAULT_SETTINGS, {
        randomBytes: filledBytes,
      })
      for (const variable of app.env.filter((item) => item.secret)) {
        const value = envValue(env, variable.key)
        if (value === undefined) continue
        const bytes = variable.description.match(GENERATE_HINT)?.[1]
        if (bytes) {
          expect(value).toBe("ab".repeat(Number(bytes)))
          generated += 1
        } else {
          expect(value).toBe("change-me")
          placeholders += 1
        }
      }
    }
    expect(generated).toBeGreaterThan(0)
    expect(placeholders).toBeGreaterThan(0)
  })

  test("generates the admin password of an App instead of a placeholder", () => {
    const app = selfHostApps.find(
      (item) =>
        item.standalone &&
        composable.some((entry) => entry.selfhostId === item.id) &&
        item.env.some((variable) => variable.key === "ADMIN_PASSWORD") &&
        /^ADMIN_PASSWORD=/m.test(
          exportOf([
            composable.find((entry) => entry.selfhostId === item.id)?.id ?? "",
          ]).env,
        ),
    )
    if (!app) throw new Error("no standalone App exports ADMIN_PASSWORD")
    const entry = composable.find((item) => item.selfhostId === app.id)
    const { env } = exportOf([entry?.id ?? ""])
    expect(envValue(env, "ADMIN_PASSWORD")).toMatch(/^[0-9a-f]{32}$/)
  })

  test("gives each secret its own value and a new one on every export", () => {
    const ids = ["authentik", "nextcloud"].filter((id) =>
      composable.some((entry) => entry.id === id),
    )
    const secretsOf = (env: string) =>
      [
        ...env.matchAll(
          /^[A-Z0-9_]*(?:SECRET|PASSWORD|KEY)[A-Z0-9_]*=([0-9a-f]+)$/gm,
        ),
      ].map((match) => match[1])

    const first = secretsOf(exportOf(ids).env)
    const second = secretsOf(exportOf(ids).env)
    expect(first.length).toBeGreaterThan(1)
    expect(new Set(first).size).toBe(first.length)
    expect(first).not.toEqual(second)
  })

  test("writes the globals from the given settings", () => {
    const { env } = buildExport(["plex"], catalog, {
      ...DEFAULT_SETTINGS,
      puid: "4242",
      timezone: "Europe/Paris",
    })
    expect(env).toContain("PUID=4242")
    expect(env).toContain("TZ=Europe/Paris")
  })

  test("interpolates settings into the interpolated compose only", () => {
    const exported = buildExport(["plex"], catalog, {
      ...DEFAULT_SETTINGS,
      configPath: "/srv/config",
    })
    expect(exported.compose).toContain("${CONFIG_PATH}")
    expect(exported.composeInterpolated).toContain("/srv/config")
    expect(exported.composeInterpolated).not.toContain("${CONFIG_PATH}")
  })
})

describe("buildExport: a Container that overlaps an App", () => {
  const authentik = entryById("authentik")
  const worker = tools.find((tool) => tool.id === "authentik-worker")
  if (!worker) throw new Error("authentik-worker is missing")
  const source = { entries: [...catalog.entries, worker] }

  for (const order of [
    ["authentik", "authentik-worker"],
    ["authentik-worker", "authentik"],
  ]) {
    test(`skips the duplicate worker (${order.join(" then ")})`, () => {
      const exported = exportOf(order, source)
      expect(Object.keys(servicesOf(exported.compose))).toContain(
        "authentik-worker",
      )
      expect(exported.compose).toContain(
        `${worker.name} skipped: already provided by ${authentik.name}`,
      )
      expect(exported.skipped).toEqual([
        { service: "authentik-worker", providedBy: authentik.name },
      ])
    })

    test(`gives a skipped worker no env requirements (${order.join(" then ")})`, () => {
      const { env } = exportOf(order, source)
      expect(env).not.toContain(`# ${worker.name} specific environment`)
      expect(env).not.toContain("REDIS_HOST=")
      expect(env).not.toContain("POSTGRESQL_HOST=")
      expect(envValue(env, "AUTHENTIK_SECRET_KEY")).toMatch(/^[0-9a-f]{64}$/)
      expect(env.match(/^AUTHENTIK_SECRET_KEY=/gm)?.length).toBe(1)
    })
  }

  test("defines every variable the deduplicated compose requires", () => {
    const exported = exportOf(["authentik-worker", "authentik"], source)
    const defined = new Set(definedKeys(exported.env))
    const missing = [...required(exported.compose)].filter(
      (name) => !defined.has(name),
    )
    expect(missing).toEqual([])
  })
})

describe("buildExport: port conflicts", () => {
  test("rewrites the old host port in the moved service's environment URLs", () => {
    const { exported, one, two } = portConflict(
      "    environment:\n      APP_URL: http://${LAN_IP}:8080",
      "    environment:\n      APP_URL: http://${LAN_IP}:8080\n      OTHER: http://${LAN_IP:-localhost}:8080/path",
    )

    expect(exported.portChanges).toEqual([
      { service: "app-two", keptBy: "app-one", from: 8080, to: 8081 },
    ])
    expect(one.ports).toEqual(["8080:80"])
    expect(two.ports).toEqual(["8081:80"])
    expect(two.environment).toEqual({
      APP_URL: "http://${LAN_IP}:8081",
      OTHER: "http://${LAN_IP:-localhost}:8081/path",
    })
  })

  test("rewrites both the plain and the interpolated compose", () => {
    const { exported } = portConflict("", "")
    expect(exported.composeInterpolated).toContain('"8081:80"')
    expect(exported.compose).toContain('"8081:80"')
  })

  test("handles list-style environment", () => {
    const { one, two } = portConflict(
      "    environment:\n      - APP_URL=http://${LAN_IP}:8080",
      "    environment:\n      - APP_URL=http://${LAN_IP}:8080",
    )
    expect(one.environment).toEqual(["APP_URL=http://${LAN_IP}:8080"])
    expect(two.environment).toEqual(["APP_URL=http://${LAN_IP}:8081"])
  })

  test("leaves the kept service and container-side or unrelated ports alone", () => {
    const { one, two } = portConflict(
      "    environment:\n      APP_URL: http://${LAN_IP}:8080",
      [
        "    environment:",
        "      INTERNAL: http://localhost:8080",
        "      BIND: 0.0.0.0:8080",
        "      UPSTREAM: http://app-one:80",
        "      DATABASE: ${DB_HOST}:8080",
        "      LONGER: http://${LAN_IP}:80800",
        "      CONTAINER: http://${LAN_IP}:80",
      ].join("\n"),
    )

    expect(one.environment).toEqual({ APP_URL: "http://${LAN_IP}:8080" })
    expect(two.environment).toEqual({
      INTERNAL: "http://localhost:8080",
      BIND: "0.0.0.0:8080",
      UPSTREAM: "http://app-one:80",
      DATABASE: "${DB_HOST}:8080",
      LONGER: "http://${LAN_IP}:80800",
      CONTAINER: "http://${LAN_IP}:80",
    })
  })

  test("only rewrites the environment block, not other properties", () => {
    const { two } = portConflict(
      "    environment:\n      APP_URL: http://${LAN_IP}:8080",
      "    labels:\n      note: http://${LAN_IP}:8080",
    )
    expect(two.labels).toEqual({ note: "http://${LAN_IP}:8080" })
  })

  test("reports no change when nothing collides", () => {
    expect(exportOf(["plex"]).portChanges).toEqual([])
  })

  test("moves the second of two real Apps that share a host port", () => {
    const exported = exportOf(["emby", "jellyfin"])
    expect(exported.portChanges).toHaveLength(1)
    const [change] = exported.portChanges
    expect(change.from).toBe(8096)
    expect(change.to).toBe(8097)
    expect(change.service).not.toBe(change.keptBy)
  })
})

describe("buildExport: notes", () => {
  test("carries the notes of every selected entry that has one", () => {
    const withNotes = composable.filter((entry) => entry.notes).slice(0, 3)
    expect(withNotes.length).toBe(3)
    const exported = exportOf(withNotes.map((entry) => entry.id))
    expect(exported.notes).toEqual(
      withNotes.map((entry) => ({
        id: entry.id,
        name: entry.name,
        text: entry.notes ?? "",
      })),
    )
  })

  test("includes the notes of install-only Apps", () => {
    const sample = catalog.entries.find((entry) => entry.installOnly)
    if (!sample) throw new Error("no install-only App")
    const exported = exportOf([sample.id])
    expect(exported.notes.map((note) => note.id)).toEqual([sample.id])
    expect(exported.compose).not.toContain("image:")
  })

  test("a template export carries the notes of its Containers", () => {
    const recipe = catalog.recipes.find((item) => item.id === "recipe-media")
    if (!recipe) throw new Error("recipe-media is missing")
    const templateEntries = getToolsFromTemplate(recipe, catalog.entries)
    const exported = buildExport(
      recipe.tools,
      { entries: templateEntries },
      DEFAULT_SETTINGS,
      { recipe: "media" },
    )

    const expected = templateEntries.filter((entry) => entry.notes)
    expect(expected.length).toBeGreaterThan(0)
    expect(exported.notes.map((note) => note.id)).toEqual(
      expected.map((entry) => entry.id),
    )
  })
})

describe("buildExport: self-host command", () => {
  test("lists the self-host ids of the selection once", () => {
    const exported = exportOf(["plex", "emby", "plex"])
    expect(exported.selfHostIds).toEqual(
      [...new Set(exported.selfHostIds)].filter(Boolean),
    )
    expect(exported.selfHostCommand).toContain("self-host install")
    for (const id of exported.selfHostIds) {
      expect(exported.selfHostCommand).toContain(id)
    }
  })

  test("is null when the selection has no self-host App", () => {
    const dcmOnly = catalog.entries.find((entry) => !entry.selfhostId)
    if (!dcmOnly) throw new Error("no DCM-only entry")
    const exported = exportOf([dcmOnly.id])
    expect(exported.selfHostIds).toEqual([])
    expect(exported.selfHostCommand).toBeNull()
  })

  test("uses the recipe id for a recipe export", () => {
    const exported = buildExport(["plex"], catalog, DEFAULT_SETTINGS, {
      recipe: "media",
    })
    expect(exported.selfHostIds).toEqual(["media"])
    expect(exported.selfHostCommand).toContain("media")
  })
})
