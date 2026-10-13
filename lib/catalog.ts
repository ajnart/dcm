import type { DockerTool } from "@/lib/docker-tools"
import {
  SELFHOST_ICON_BASE,
  getSelfHostId,
  selfHostApps,
  selfHostRecipes,
} from "@/lib/selfhost"

export interface CatalogEntry extends DockerTool {
  selfhostId?: string
  selfhostOnly?: boolean
  port?: number
  links?: string[]
  recipes?: string[]
}

export interface CatalogRecipe {
  id: string
  name: string
  description: string
  apps: string[]
  entryIds: string[]
}

export interface Catalog {
  entries: CatalogEntry[]
  recipes: CatalogRecipe[]
}

const CATEGORY_ALIASES: Record<string, string> = {
  Download: "Downloads",
  Database: "Databases",
  Backup: "Backups",
  "Home Automation": "Home automation",
  Network: "Networking",
}

export function selfHostIcon(path?: string): string | undefined {
  return path ? `${SELFHOST_ICON_BASE}${path}` : undefined
}

export function buildCatalog(tools: DockerTool[]): Catalog {
  const appsById = new Map(selfHostApps.map((app) => [app.id, app]))
  const recipesByApp = new Map<string, string[]>()
  for (const recipe of selfHostRecipes) {
    for (const appId of recipe.apps) {
      recipesByApp.set(appId, [...(recipesByApp.get(appId) ?? []), recipe.id])
    }
  }

  const entryIdBySelfHost = new Map<string, string>()
  const entries: CatalogEntry[] = tools.map((tool) => {
    const selfhostId = getSelfHostId(tool.id)
    const app = selfhostId ? appsById.get(selfhostId) : undefined
    if (!selfhostId || !app) {
      return {
        ...tool,
        category: CATEGORY_ALIASES[tool.category] ?? tool.category,
      }
    }
    if (!entryIdBySelfHost.has(selfhostId) || tool.id === selfhostId) {
      entryIdBySelfHost.set(selfhostId, tool.id)
    }
    return {
      ...tool,
      description: app.d,
      category: app.c,
      icon: tool.icon ?? selfHostIcon(app.i),
      selfhostId,
      port: app.p || undefined,
      links: app.l,
      recipes: recipesByApp.get(selfhostId) ?? [],
    }
  })

  for (const app of selfHostApps) {
    if (entryIdBySelfHost.has(app.id)) continue
    entryIdBySelfHost.set(app.id, app.id)
    entries.push({
      id: app.id,
      name: app.name,
      description: app.d,
      category: app.c,
      tags: [],
      icon: selfHostIcon(app.i),
      selfhostId: app.id,
      selfhostOnly: true,
      port: app.p || undefined,
      links: app.l,
      recipes: recipesByApp.get(app.id) ?? [],
    })
  }

  entries.sort((a, b) => a.name.localeCompare(b.name))

  const recipes = selfHostRecipes.map((recipe) => ({
    id: recipe.id,
    name: recipe.name,
    description: recipe.d,
    apps: recipe.apps,
    entryIds: recipe.apps
      .map((appId) => entryIdBySelfHost.get(appId))
      .filter((id): id is string => id !== undefined),
  }))

  return { entries, recipes }
}

export function canGenerateYaml(entry: CatalogEntry): boolean {
  return Boolean(entry.composeContent) && !entry.isUnsupported
}

export interface ResolvedSelection {
  entries: CatalogEntry[]
  recipes: CatalogRecipe[]
  yamlTools: CatalogEntry[]
  yamlMissing: CatalogEntry[]
}

export function resolveSelection(
  ids: string[],
  catalog: Catalog,
): ResolvedSelection {
  const entryById = new Map(catalog.entries.map((entry) => [entry.id, entry]))
  const recipeById = new Map(
    catalog.recipes.map((recipe) => [recipe.id, recipe]),
  )

  const entries: CatalogEntry[] = []
  const recipes: CatalogRecipe[] = []
  const yamlIds = new Set<string>()
  const missingIds = new Set<string>()

  const pick = (entry: CatalogEntry) => {
    if (canGenerateYaml(entry)) yamlIds.add(entry.id)
    else missingIds.add(entry.id)
  }

  for (const id of ids) {
    const entry = entryById.get(id)
    if (entry) {
      entries.push(entry)
      pick(entry)
      continue
    }
    const recipe = recipeById.get(id)
    if (!recipe) continue
    recipes.push(recipe)
    for (const entryId of recipe.entryIds) {
      const member = entryById.get(entryId)
      if (member) pick(member)
    }
  }

  return {
    entries,
    recipes,
    yamlTools: [...yamlIds].flatMap((id) => entryById.get(id) ?? []),
    yamlMissing: [...missingIds]
      .filter((id) => !yamlIds.has(id))
      .flatMap((id) => entryById.get(id) ?? []),
  }
}

export function toSelfHostIds(ids: string[], catalog: Catalog): string[] {
  const entryById = new Map(catalog.entries.map((entry) => [entry.id, entry]))
  const recipeIds = new Set(catalog.recipes.map((recipe) => recipe.id))
  const result = new Set<string>()
  for (const id of ids) {
    if (recipeIds.has(id)) result.add(id)
    const selfhostId = entryById.get(id)?.selfhostId
    if (selfhostId) result.add(selfhostId)
  }
  return [...result]
}
