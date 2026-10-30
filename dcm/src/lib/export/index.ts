import type { Catalog, CatalogEntry } from "@/lib/catalog"
import { buildSelfHostCommand } from "@/lib/selfhost"
import type { DockerSettings } from "@/lib/settings"
import { interpolate, placeTools, renderCompose } from "./compose"
import { renderEnv } from "./env"
import { fixPortConflicts } from "./ports"
import type { ExportNote, ExportOptions, ExportResult } from "./types"

export { EXPORT_FILENAMES } from "./types"
export type {
  ExportNote,
  ExportOptions,
  ExportResult,
  PortChange,
  RandomBytes,
  SkippedService,
} from "./types"

function canGenerateYaml(entry: CatalogEntry): boolean {
  return Boolean(entry.composeContent) && !entry.isUnsupported
}

function notesOf(entries: CatalogEntry[]): ExportNote[] {
  return entries.flatMap((entry) =>
    entry.notes ? [{ id: entry.id, name: entry.name, text: entry.notes }] : [],
  )
}

function selfHostIdsOf(
  entries: CatalogEntry[],
  options: ExportOptions,
): string[] {
  if (options.recipe) return [options.recipe]
  const ids = entries.flatMap((entry) =>
    entry.selfhostId ? [entry.selfhostId] : [],
  )
  return [...new Set(ids)]
}

export function buildExport(
  ids: string[],
  catalog: Pick<Catalog, "entries">,
  settings: DockerSettings,
  options: ExportOptions = {},
): ExportResult {
  const entryById = new Map(catalog.entries.map((entry) => [entry.id, entry]))
  const entries = ids.flatMap((id) => entryById.get(id) ?? [])
  const composable = entries.filter(canGenerateYaml)
  const placed = placeTools(composable)

  const compose = fixPortConflicts(renderCompose(placed, (body) => body))
  const composeInterpolated = fixPortConflicts(
    renderCompose(placed, (body) => interpolate(body, settings)),
  )

  const selfHostIds = selfHostIdsOf(entries, options)

  return {
    entries,
    unresolved: ids.filter((id) => !entryById.has(id)),
    installOnly: entries.filter((entry) => !canGenerateYaml(entry)),
    composable,
    compose: compose.content,
    composeInterpolated: composeInterpolated.content,
    env: renderEnv(placed, settings, options.randomBytes),
    notes: notesOf(entries),
    skipped: placed.flatMap((item) => item.skipped),
    portChanges: compose.changes,
    selfHostIds,
    selfHostCommand:
      selfHostIds.length > 0 ? buildSelfHostCommand(selfHostIds) : null,
  }
}
