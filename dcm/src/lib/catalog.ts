import type { DockerTool } from "@/lib/docker-tools"
import { serviceNames } from "@/lib/export/services"
import type { CatalogMode } from "@/lib/modes"
import {
  type SelfHostApp,
  type SelfHostEnvVar,
  getSelfHostId,
  selfHostApps,
  selfHostIcon,
  selfHostRecipes,
} from "@/lib/selfhost"
import type { Template } from "@/lib/templates"

export const RECIPE_CATEGORY = "self-host Recipe"
const RECIPE_PREFIX = "recipe-"

export interface CatalogEntry extends DockerTool {
  selfhostId?: string
  selfhostOnly?: boolean
  port?: number
  docsUrl?: string
  env?: SelfHostEnvVar[]
  notes?: string
  installOnly?: boolean
}

export interface Catalog {
  entries: CatalogEntry[]
  recipes: Template[]
}

function fromSelfHost(app: SelfHostApp): CatalogEntry {
  const standalone = app.standalone !== false
  return {
    id: app.id,
    name: app.name,
    description: app.description,
    category: app.category,
    tags: [],
    icon: selfHostIcon(app.icon),
    composeContent: standalone ? app.compose : undefined,
    verbatim: standalone,
    selfhostId: app.id,
    selfhostOnly: true,
    installOnly: !standalone,
    port: app.port,
    docsUrl: app.docs,
    env: app.env,
    notes: app.notes,
  }
}

function mergeWithSelfHost(tool: DockerTool, app: SelfHostApp): CatalogEntry {
  const exact = tool.id === app.id
  const shared = {
    ...tool,
    name: exact ? tool.name : app.name,
    description: exact ? tool.description : app.description,
    icon: tool.icon ?? selfHostIcon(app.icon),
    selfhostId: app.id,
    port: app.port,
    docsUrl: app.docs,
  }
  if (app.standalone === false) return shared
  return {
    ...shared,
    composeContent: app.compose,
    verbatim: true,
    isUnsupported: false,
    env: app.env,
    notes: app.notes,
  }
}

function coveredByApp(tool: DockerTool, apps: SelfHostApp[]): boolean {
  if (!tool.composeContent) return false
  const names = serviceNames(tool.composeContent)
  if (names.length === 0) return false
  return apps.some((app) => {
    if (app.standalone === false || !tool.id.startsWith(`${app.id}-`)) {
      return false
    }
    const provided = serviceNames(app.compose)
    return names.every((name) => provided.includes(name))
  })
}

function recipeTemplates(entries: CatalogEntry[]): Template[] {
  const idBySelfHost = new Map(
    entries.flatMap((entry) =>
      entry.selfhostId ? [[entry.selfhostId, entry.id] as const] : [],
    ),
  )
  return selfHostRecipes.map((recipe) => ({
    id: `${RECIPE_PREFIX}${recipe.id}`,
    name: recipe.name,
    description: recipe.description,
    category: RECIPE_CATEGORY,
    tools: recipe.apps.flatMap((appId) => idBySelfHost.get(appId) ?? []),
  }))
}

export function buildCatalog(tools: DockerTool[]): Catalog {
  const appsById = new Map(selfHostApps.map((app) => [app.id, app]))
  const claimed = new Set<string>()
  const merged = new Map<string, CatalogEntry>()

  for (const tool of tools) {
    const app = appsById.get(tool.id)
    if (!app) continue
    claimed.add(app.id)
    merged.set(tool.id, mergeWithSelfHost(tool, app))
  }

  for (const tool of tools) {
    if (merged.has(tool.id)) continue
    const appId = getSelfHostId(tool.id)
    const app = appId ? appsById.get(appId) : undefined
    if (!app || claimed.has(app.id)) continue
    claimed.add(app.id)
    merged.set(tool.id, mergeWithSelfHost(tool, app))
  }

  const dcmEntries: CatalogEntry[] = tools
    .filter((tool) => merged.has(tool.id) || !coveredByApp(tool, selfHostApps))
    .map((tool) => merged.get(tool.id) ?? tool)
  const selfHostOnly = selfHostApps
    .filter((app) => !claimed.has(app.id))
    .map(fromSelfHost)
  const entries = [...dcmEntries, ...selfHostOnly]

  const ordered = [
    ...entries.filter((entry) => entry.selfhostId),
    ...entries.filter((entry) => !entry.selfhostId),
  ]

  return { entries: ordered, recipes: recipeTemplates(ordered) }
}

export function entriesForMode(
  catalog: Catalog,
  mode: CatalogMode,
): CatalogEntry[] {
  if (mode === "compose") return catalog.entries
  return catalog.entries.filter((entry) => entry.selfhostId)
}

export function partitionSelection(
  ids: string[],
  catalog: Catalog,
  entries: CatalogEntry[],
): { visibleIds: string[]; hiddenCount: number } {
  const visible = new Set(entries.map((entry) => entry.id))
  const known = new Set(catalog.entries.map((entry) => entry.id))
  return {
    visibleIds: ids.filter((id) => visible.has(id)),
    hiddenCount: ids.filter((id) => known.has(id) && !visible.has(id)).length,
  }
}

export function allTemplates(
  catalog: Catalog,
  dcmTemplates: Template[],
  mode: CatalogMode,
): Template[] {
  if (mode === "self-host") return catalog.recipes
  return [...catalog.recipes, ...dcmTemplates]
}

export function selfHostRecipeId(template: Template): string | undefined {
  if (!template.id.startsWith(RECIPE_PREFIX)) return undefined
  return template.id.slice(RECIPE_PREFIX.length)
}
