import { SelfHostCommand } from "@/components/selfhost-command"

interface SelfHostCalloutProps {
  ids: string[]
  yamlMissing?: { name: string }[]
}

export default function SelfHostCallout({
  ids,
  yamlMissing = [],
}: SelfHostCalloutProps) {
  if (ids.length === 0) return null

  const lead =
    yamlMissing.length > 0
      ? `No standalone YAML for ${yamlMissing.map((entry) => entry.name).join(", ")}. Install with self-host:`
      : "Rather not manage YAML? Let self-host do it:"

  return (
    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-muted-foreground text-sm sm:mt-0 sm:mr-auto">
      <span>{lead}</span>
      <SelfHostCommand ids={ids} />
    </div>
  )
}
