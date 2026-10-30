"use client"

import type { DockerSettings } from "@/components/settings-panel"
import { DEFAULT_SETTINGS, STORAGE_KEYS } from "@/lib/constants"
import { createContext, useContext, useEffect, useState } from "react"

type SettingsContextType = {
  settings: DockerSettings
  updateSettings: (key: keyof DockerSettings, value: string | boolean) => void
  updateAllSettings: (settings: DockerSettings) => void
  resetSettings: () => void
  isLoading: boolean
}

const SettingsContext = createContext<SettingsContextType | undefined>(
  undefined,
)

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<DockerSettings>(DEFAULT_SETTINGS)
  const [isLoading, setIsLoading] = useState(true)

  // Load settings from localStorage on mount
  useEffect(() => {
    if (typeof window === "undefined") return

    try {
      const storedSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS)
      if (storedSettings) {
        setSettings(JSON.parse(storedSettings))
      }
    } catch (error) {
      console.error("Error loading settings from localStorage:", error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Save settings to localStorage when they change
  useEffect(() => {
    if (typeof window === "undefined" || isLoading) return

    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings))
    } catch (error) {
      console.error("Error saving settings to localStorage:", error)
    }
  }, [settings, isLoading])

  const updateSettings = (
    key: keyof DockerSettings,
    value: string | boolean,
  ) => {
    setSettings((prev) => ({
      ...prev,
      [key]: value,
    }))
  }

  const updateAllSettings = (newSettings: DockerSettings) => {
    setSettings(newSettings)
  }

  const resetSettings = () => {
    setSettings(DEFAULT_SETTINGS)
  }

  return (
    <SettingsContext.Provider
      value={{
        settings,
        updateSettings,
        updateAllSettings,
        resetSettings,
        isLoading,
      }}
    >
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  const context = useContext(SettingsContext)
  if (context === undefined) {
    throw new Error("useSettings must be used within a SettingsProvider")
  }
  return context
}
