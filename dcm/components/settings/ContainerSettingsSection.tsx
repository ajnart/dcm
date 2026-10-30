"use client"

import type { DockerSettings } from "@/components/settings-panel"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface ContainerSettingsSectionProps {
  settings: DockerSettings
  onSettingsChange: (key: keyof DockerSettings, value: string | boolean) => void
}

export function ContainerSettingsSection({
  settings,
  onSettingsChange,
}: ContainerSettingsSectionProps) {
  return (
    <div className="[animation-delay:600ms] motion-safe:animate-fade-in">
      <h4 className="mb-3 font-medium text-sm">Container Settings</h4>
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor="restartPolicy">Restart Policy</Label>
          <Select
            value={settings.restartPolicy}
            onValueChange={(value) => onSettingsChange("restartPolicy", value)}
          >
            <SelectTrigger
              id="restartPolicy"
              className="motion-safe:transition-all motion-safe:duration-300 motion-safe:focus:scale-[1.01]"
            >
              <SelectValue placeholder="Select policy" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="no">no</SelectItem>
              <SelectItem value="always">always</SelectItem>
              <SelectItem value="on-failure">on-failure</SelectItem>
              <SelectItem value="unless-stopped">unless-stopped</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">
            When containers should restart
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="networkMode">Network Mode</Label>
          <Select
            value={settings.networkMode}
            onValueChange={(value) => onSettingsChange("networkMode", value)}
          >
            <SelectTrigger
              id="networkMode"
              className="motion-safe:transition-all motion-safe:duration-300 motion-safe:focus:scale-[1.01]"
            >
              <SelectValue placeholder="Select network" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bridge">bridge</SelectItem>
              <SelectItem value="host">host</SelectItem>
              <SelectItem value="none">none</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">
            How containers connect to network
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="containerNamePrefix">Container Name Prefix</Label>
          <Input
            id="containerNamePrefix"
            placeholder="homestack"
            value={settings.containerNamePrefix}
            onChange={(e) =>
              onSettingsChange("containerNamePrefix", e.target.value)
            }
            className="motion-safe:transition-all motion-safe:duration-300 motion-safe:focus:scale-[1.01]"
          />
          <p className="text-muted-foreground text-xs">
            Prefix for container names
          </p>
        </div>
      </div>
    </div>
  )
}
