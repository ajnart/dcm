import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { PortChange } from "@/lib/export"
import { AlertCircle, ArrowRight, ShieldAlert } from "lucide-react"

interface PortConflictsAlertProps {
  changes: PortChange[]
}

function groupByPort(changes: PortChange[]) {
  const groups = new Map<number, PortChange[]>()
  for (const change of changes) {
    groups.set(change.from, [...(groups.get(change.from) ?? []), change])
  }
  return [...groups].map(([port, group]) => ({
    port,
    services: [
      ...new Set([group[0].keptBy, ...group.map((change) => change.service)]),
    ],
    changes: group,
  }))
}

export default function PortConflictsAlert({
  changes,
}: PortConflictsAlertProps) {
  if (changes.length === 0) return null

  const groups = groupByPort(changes)

  return (
    <Alert variant="info" className="my-3 border-amber-500/50 bg-amber-500/5">
      <ShieldAlert className="h-4 w-4 text-amber-500" />
      <AlertTitle className="text-amber-500">
        Port conflicts detected and auto-resolved
      </AlertTitle>
      <AlertDescription className="text-foreground text-xs">
        Found {groups.length} port conflict(s) across {changes.length}{" "}
        service(s). Ports were automatically reassigned to avoid conflicts.
        <div className="mt-3 space-y-2">
          {groups.map((group) => (
            <div
              key={group.port}
              className="rounded-md border border-amber-500/20 bg-background/50 p-2"
            >
              <div className="mb-1 flex items-center gap-1.5 font-medium text-xs">
                <AlertCircle className="h-3 w-3 text-amber-500" />
                Port <span className="font-mono">{group.port}</span> was shared
                by: {group.services.join(", ")}
              </div>
              <div className="space-y-0.5">
                {group.changes.map((change) => (
                  <div
                    key={`${change.service}-${change.to}`}
                    className="flex items-center gap-1.5 text-xs"
                  >
                    <span className="font-medium text-muted-foreground">
                      {change.service}:
                    </span>
                    <span className="rounded bg-destructive/15 px-1.5 py-0.5 font-mono text-destructive line-through">
                      {change.from}
                    </span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <span className="rounded bg-success/15 px-1.5 py-0.5 font-mono text-success">
                      {change.to}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-muted-foreground">
          Review the generated compose file to ensure the new ports work for
          your setup.
        </p>
      </AlertDescription>
    </Alert>
  )
}
