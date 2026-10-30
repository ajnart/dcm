"use client"

import type { DockerSettings } from "@/components/settings-panel"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface VolumePathsSectionProps {
  settings: DockerSettings
  onSettingsChange: (key: keyof DockerSettings, value: string | boolean) => void
}

export function VolumePathsSection({
  settings,
  onSettingsChange,
}: VolumePathsSectionProps) {
  return (
    <div className="motion-safe:animate-fade-in">
      <h4 className="mb-3 font-medium text-sm">Volume Paths</h4>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="configPath">Config Path</Label>
          <Input
            id="configPath"
            placeholder="/path/to/config"
            value={settings.configPath}
            onChange={(e) => onSettingsChange("configPath", e.target.value)}
            className="motion-safe:transition-all motion-safe:duration-300 motion-safe:focus:scale-[1.01]"
          />
          <p className="text-muted-foreground text-xs">
            Path where configuration files will be stored
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="dataPath">Data Path</Label>
          <Input
            id="dataPath"
            placeholder="/path/to/data"
            value={settings.dataPath}
            onChange={(e) => onSettingsChange("dataPath", e.target.value)}
            className="motion-safe:transition-all motion-safe:duration-300 motion-safe:focus:scale-[1.01]"
          />
          <p className="text-muted-foreground text-xs">
            Path where application data will be stored
          </p>
        </div>
      </div>
    </div>
  )
}
