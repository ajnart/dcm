import type { CatalogMode } from "@/lib/modes"

export type CatalogId = string
type Source = "self-host" | "dcm"
type ComposeFile = "compose" | "env"

export type DcmEvent =
  | { name: "dcm_mode_changed"; mode: CatalogMode }
  | { name: "dcm_item_selected"; id: CatalogId; source: Source }
  | { name: "dcm_item_unselected"; id: CatalogId; source: Source }
  | {
      name: "dcm_compose_copied"
      count: number
      ids: CatalogId[]
      file: ComposeFile
    }
  | {
      name: "dcm_compose_downloaded"
      count: number
      ids: CatalogId[]
      file: ComposeFile
    }
  | { name: "dcm_share_copied"; count: number }
  | { name: "dcm_selfhost_command_copied"; count: number; ids: CatalogId[] }
  | { name: "dcm_template_opened"; id: string }
  | { name: "dcm_template_copied"; id: string }
  | { name: "dcm_search_opened" }
  | { name: "dcm_settings_opened" }
  | { name: "dcm_suggest_opened" }
  | { name: "dcm_suggest_prompt_copied" }
  | { name: "dcm_suggest_issue_opened" }

type Listener = (event: DcmEvent) => void

let listener: Listener | undefined

export function onTrack(next: Listener): void {
  listener = next
}

export function track(event: DcmEvent): void {
  listener?.(event)
}
