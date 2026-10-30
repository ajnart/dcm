import { SelfHostCommand } from "@/components/selfhost-command"

interface SelfHostCalloutProps {
  command: string | null
  ids: string[]
  installOnly?: { name: string }[]
}

export default function SelfHostCallout({
  command,
  ids,
  installOnly = [],
}: SelfHostCalloutProps) {
  if (command === null) return null

  const lead =
    installOnly.length > 0
      ? `No standalone YAML for ${installOnly.map((entry) => entry.name).join(", ")}. Install with self-host:`
      : "Rather not manage YAML? Let self-host do it:"

  return (
    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-muted-foreground text-sm sm:mt-0 sm:mr-auto">
      <span>{lead}</span>
      <SelfHostCommand command={command} ids={ids} />
    </div>
  )
}
