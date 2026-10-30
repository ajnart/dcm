import type { CatalogMode } from "@/lib/catalog"
import type { PostHog } from "posthog-js"

const PROJECT_KEY = "phc_zY6Yg8ePwEfXC8FadEqkCcoCgzzy2u2VHjpaPTooBDfg"
const PRODUCTION_HOST = "self-host.fyi"
const MAX_PENDING = 50

type Source = "self-host" | "dcm"
type ComposeFile = "compose" | "env"

export type AnalyticsEvent =
  | { name: "install_command_copied"; method: string }
  | { name: "app_install_copied"; app: string }
  | { name: "recipe_install_copied"; recipe: string }
  | { name: "share_link_copied"; count: number }
  | { name: "dcm_mode_changed"; mode: CatalogMode }
  | { name: "dcm_item_selected"; id: string; source: Source }
  | { name: "dcm_item_unselected"; id: string; source: Source }
  | {
      name: "dcm_compose_copied"
      count: number
      ids: string[]
      file: ComposeFile
    }
  | {
      name: "dcm_compose_downloaded"
      count: number
      ids: string[]
      file: ComposeFile
    }
  | { name: "dcm_share_copied"; count: number }
  | { name: "dcm_selfhost_command_copied"; count: number; ids: string[] }
  | { name: "dcm_template_opened"; id: string }
  | { name: "dcm_template_copied"; id: string }
  | { name: "dcm_search_opened" }
  | { name: "dcm_settings_opened" }
  | { name: "dcm_suggest_opened" }
  | { name: "dcm_suggest_submitted" }

type Capture = PostHog["capture"]

const pending: AnalyticsEvent[] = []
let active = false
let capture: Capture | undefined

function deliver(target: Capture, { name, ...properties }: AnalyticsEvent) {
  target(name, properties)
}

export function initAnalytics(): void {
  if (active) return
  if (typeof window === "undefined") return
  if (window.location.hostname !== PRODUCTION_HOST) return
  active = true
  void import("posthog-js").then(({ default: posthog }) => {
    posthog.init(PROJECT_KEY, {
      api_host: "https://hog.ajnart.dev",
      ui_host: "https://eu.posthog.com",
      defaults: "2026-08-30",
      cookieless_mode: "always",
      person_profiles: "never",
      autocapture: false,
      capture_pageview: true,
      capture_pageleave: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      disable_session_recording: true,
      disable_surveys: true,
      disable_external_dependency_loading: true,
      advanced_disable_flags: true,
      respect_dnt: true,
    })
    capture = posthog.capture.bind(posthog)
    for (const event of pending.splice(0)) deliver(capture, event)
  })
}

export function track(event: AnalyticsEvent): void {
  if (!active) return
  if (capture) {
    deliver(capture, event)
    return
  }
  if (pending.length < MAX_PENDING) pending.push(event)
}
