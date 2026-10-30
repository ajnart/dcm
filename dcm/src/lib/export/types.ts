import type { CatalogEntry } from "@/lib/catalog"

export const EXPORT_FILENAMES = {
  compose: "docker-compose.yaml",
  env: ".env",
} as const

export interface PortChange {
  service: string
  keptBy: string
  from: number
  to: number
}

export interface SkippedService {
  service: string
  providedBy: string
}

export interface ExportNote {
  id: string
  name: string
  text: string
}

export type SecretFor = (key: string, bytes: number) => string

export interface ExportOptions {
  recipe?: string
  secretFor?: SecretFor
}

export interface ExportResult {
  entries: CatalogEntry[]
  unresolved: string[]
  installOnly: CatalogEntry[]
  composable: CatalogEntry[]
  compose: string
  composeInterpolated: string
  env: string
  notes: ExportNote[]
  skipped: SkippedService[]
  portChanges: PortChange[]
  selfHostIds: string[]
  selfHostCommand: string | null
}
