import { type CatalogMode, DEFAULT_MODE, parseMode } from "@/lib/catalog"
import { STORAGE_KEYS } from "@/lib/constants"
import { useSyncExternalStore } from "react"

const listeners = new Set<() => void>()
let current: CatalogMode | undefined

function resolve(): CatalogMode {
  const fromUrl = new URLSearchParams(window.location.search).get("mode")
  if (fromUrl) return parseMode(fromUrl)
  try {
    return parseMode(localStorage.getItem(STORAGE_KEYS.MODE))
  } catch {
    return DEFAULT_MODE
  }
}

function syncUrl(mode: CatalogMode) {
  const url = new URL(window.location.href)
  if (url.searchParams.get("mode") === mode) return
  url.searchParams.set("mode", mode)
  window.history.replaceState(window.history.state, "", url)
}

function getMode(): CatalogMode {
  current ??= resolve()
  return current
}

export interface SetModeOptions {
  persist?: boolean
}

export function setMode(
  mode: CatalogMode,
  { persist = true }: SetModeOptions = {},
) {
  current = mode
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEYS.MODE, mode)
    } catch {}
  }
  syncUrl(mode)
  for (const listener of listeners) listener()
}

function onPopState() {
  const next = resolve()
  if (next === current) return
  current = next
  for (const listener of listeners) listener()
}

function onStorage(event: StorageEvent) {
  if (event.key !== STORAGE_KEYS.MODE) return
  const next = parseMode(event.newValue)
  if (next === current) return
  setMode(next, { persist: false })
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    window.addEventListener("popstate", onPopState)
    window.addEventListener("storage", onStorage)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      window.removeEventListener("popstate", onPopState)
      window.removeEventListener("storage", onStorage)
    }
  }
}

export function useMode(): [CatalogMode, typeof setMode] {
  const mode = useSyncExternalStore(subscribe, getMode, () => DEFAULT_MODE)
  return [mode, setMode]
}
