"use client"

import type { DockerSettings } from "@/components/settings-panel"
import { ContainerSettingsSection } from "@/components/settings/ContainerSettingsSection"
import { EnvironmentVariablesSection } from "@/components/settings/EnvironmentVariablesSection"
import { VolumePathsSection } from "@/components/settings/VolumePathsSection"
import { Separator } from "@/components/ui/separator"
import { useSettings } from "@/lib/settings-context"
import { useForm } from "@tanstack/react-form"
import { Loader2 } from "lucide-react"
import { useEffect, useState } from "react"

interface SettingsFormProps {
  className?: string
  onSavingChange?: (isSaving: boolean) => void
}

export default function SettingsForm({
  className = "",
  onSavingChange,
}: SettingsFormProps) {
  const { settings, updateAllSettings, resetSettings, isLoading } =
    useSettings()
  const [isSaving, setIsSaving] = useState(false)
  const [formValues, setFormValues] = useState<DockerSettings>(settings)

  // Update form values when settings load
  useEffect(() => {
    if (!isLoading) {
      setFormValues(settings)
    }
  }, [isLoading, settings])

  const form = useForm({
    defaultValues: settings,
    onSubmit: async ({ value }) => {
      setIsSaving(true)
      if (onSavingChange) onSavingChange(true)
      // Simulate a small delay to show the saving indicator
      await new Promise((resolve) => setTimeout(resolve, 300))
      updateAllSettings(value)
      setIsSaving(false)
      if (onSavingChange) onSavingChange(false)
    },
  })

  const handleChange = (key: keyof DockerSettings, value: string | boolean) => {
    setFormValues((prev) => {
      const newValues = { ...prev, [key]: value }
      return newValues
    })
  }

  // Auto-submit form when values change after a debounce period
  useEffect(() => {
    if (isLoading) return

    const timeout = setTimeout(() => {
      if (
        !isSaving &&
        JSON.stringify(formValues) !== JSON.stringify(settings)
      ) {
        setIsSaving(true)
        if (onSavingChange) onSavingChange(true)

        updateAllSettings(formValues)

        // Add a slight delay before removing saving indicator
        setTimeout(() => {
          setIsSaving(false)
          if (onSavingChange) onSavingChange(false)
        }, 300)
      }
    }, 500)

    return () => clearTimeout(timeout)
  }, [
    formValues,
    settings,
    isLoading,
    isSaving,
    updateAllSettings,
    onSavingChange,
  ])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-6">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  return (
    <div className={`${className}`}>
      <form
        className="grid gap-6 pt-4"
        onSubmit={(e) => {
          e.preventDefault()
          updateAllSettings(formValues)
        }}
      >
        <VolumePathsSection
          settings={formValues}
          onSettingsChange={handleChange}
        />

        <Separator className="[animation-delay:100ms] motion-safe:animate-fade-in" />

        <EnvironmentVariablesSection
          settings={formValues}
          onSettingsChange={handleChange}
        />

        <Separator className="[animation-delay:500ms] motion-safe:animate-fade-in" />

        <ContainerSettingsSection
          settings={formValues}
          onSettingsChange={handleChange}
        />
      </form>
    </div>
  )
}
