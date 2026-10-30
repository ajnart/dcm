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
import { Fragment } from "react"

interface EnvironmentVariablesSectionProps {
  settings: DockerSettings
  onSettingsChange: (key: keyof DockerSettings, value: string | boolean) => void
}

// Timezone data organized by region
const timezoneData = {
  UTC: ["UTC"],
  Africa: [
    "Africa/Abidjan",
    "Africa/Accra",
    "Africa/Algiers",
    "Africa/Cairo",
    "Africa/Casablanca",
    "Africa/Johannesburg",
    "Africa/Lagos",
    "Africa/Nairobi",
    "Africa/Tunis",
  ],
  America: [
    "America/Anchorage",
    "America/Argentina/Buenos_Aires",
    "America/Bogota",
    "America/Chicago",
    "America/Denver",
    "America/Halifax",
    "America/Los_Angeles",
    "America/Mexico_City",
    "America/New_York",
    "America/Phoenix",
    "America/Santiago",
    "America/Sao_Paulo",
    "America/St_Johns",
    "America/Toronto",
    "America/Vancouver",
  ],
  Antarctica: [
    "Antarctica/Casey",
    "Antarctica/McMurdo",
    "Antarctica/South_Pole",
  ],
  Asia: [
    "Asia/Baghdad",
    "Asia/Bangkok",
    "Asia/Dhaka",
    "Asia/Dubai",
    "Asia/Hong_Kong",
    "Asia/Jakarta",
    "Asia/Jerusalem",
    "Asia/Karachi",
    "Asia/Kolkata",
    "Asia/Kuala_Lumpur",
    "Asia/Manila",
    "Asia/Qatar",
    "Asia/Riyadh",
    "Asia/Seoul",
    "Asia/Shanghai",
    "Asia/Singapore",
    "Asia/Taipei",
    "Asia/Tehran",
    "Asia/Tokyo",
  ],
  Atlantic: [
    "Atlantic/Azores",
    "Atlantic/Canary",
    "Atlantic/Cape_Verde",
    "Atlantic/Reykjavik",
  ],
  Australia: [
    "Australia/Adelaide",
    "Australia/Brisbane",
    "Australia/Darwin",
    "Australia/Hobart",
    "Australia/Melbourne",
    "Australia/Perth",
    "Australia/Sydney",
  ],
  Europe: [
    "Europe/Amsterdam",
    "Europe/Athens",
    "Europe/Berlin",
    "Europe/Brussels",
    "Europe/Budapest",
    "Europe/Copenhagen",
    "Europe/Dublin",
    "Europe/Helsinki",
    "Europe/Istanbul",
    "Europe/Lisbon",
    "Europe/London",
    "Europe/Madrid",
    "Europe/Moscow",
    "Europe/Oslo",
    "Europe/Paris",
    "Europe/Prague",
    "Europe/Rome",
    "Europe/Stockholm",
    "Europe/Vienna",
    "Europe/Warsaw",
    "Europe/Zurich",
  ],
  Indian: ["Indian/Maldives", "Indian/Mauritius"],
  Pacific: [
    "Pacific/Auckland",
    "Pacific/Fiji",
    "Pacific/Guam",
    "Pacific/Honolulu",
    "Pacific/Midway",
    "Pacific/Noumea",
    "Pacific/Pago_Pago",
    "Pacific/Port_Moresby",
    "Pacific/Tahiti",
  ],
}

export function EnvironmentVariablesSection({
  settings,
  onSettingsChange,
}: EnvironmentVariablesSectionProps) {
  return (
    <div className="[animation-delay:400ms] motion-safe:animate-fade-in">
      <h4 className="mb-3 font-medium text-sm">Environment Variables</h4>
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
        <div className="grid gap-2">
          <Label htmlFor="timezone">Timezone</Label>
          <Select
            value={settings.timezone}
            onValueChange={(value) => onSettingsChange("timezone", value)}
          >
            <SelectTrigger
              id="timezone"
              className="motion-safe:transition-all motion-safe:duration-300 motion-safe:focus:scale-[1.01]"
            >
              <SelectValue placeholder="Select timezone" />
            </SelectTrigger>
            <SelectContent className="max-h-[300px]">
              {Object.entries(timezoneData).map(([region, timezones]) => (
                <Fragment key={region}>
                  {region !== "UTC" && (
                    <SelectItem
                      key={`region-${region}`}
                      value={`region-${region}`}
                      disabled
                      className="font-semibold"
                    >
                      {region}
                    </SelectItem>
                  )}
                  {timezones.map((timezone) => (
                    <SelectItem key={timezone} value={timezone}>
                      {timezone}
                    </SelectItem>
                  ))}
                </Fragment>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">Container timezone</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="puid">PUID</Label>
          <Input
            id="puid"
            placeholder="1000"
            value={settings.puid}
            onChange={(e) => onSettingsChange("puid", e.target.value)}
            className="motion-safe:transition-all motion-safe:duration-300 motion-safe:focus:scale-[1.01]"
          />
          <p className="text-muted-foreground text-xs">
            User ID for permissions
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="pgid">PGID</Label>
          <Input
            id="pgid"
            placeholder="1000"
            value={settings.pgid}
            onChange={(e) => onSettingsChange("pgid", e.target.value)}
            className="motion-safe:transition-all motion-safe:duration-300 motion-safe:focus:scale-[1.01]"
          />
          <p className="text-muted-foreground text-xs">
            Group ID for permissions
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="umask">UMASK</Label>
          <Input
            id="umask"
            placeholder="022"
            value={settings.umask}
            onChange={(e) => onSettingsChange("umask", e.target.value)}
            className="motion-safe:transition-all motion-safe:duration-300 motion-safe:focus:scale-[1.01]"
          />
          <p className="text-muted-foreground text-xs">File permission mask</p>
        </div>
      </div>
    </div>
  )
}
