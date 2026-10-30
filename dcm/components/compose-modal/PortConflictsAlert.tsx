"use client"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertCircle, ArrowRight, ShieldAlert } from "lucide-react"

interface PortConflictsAlertProps {
  portConflicts: {
    fixed: number
    conflicts: string[]
  }
}

function parseConflicts(conflicts: string[]) {
  return conflicts.map((conflict) => {
    const lines = conflict.split("\n")
    const portMatch = lines[0].match(/Port (\d+) was used by: (.+)/)
    const port = portMatch ? portMatch[1] : "?"
    const services = portMatch ? portMatch[2].split(", ") : []
    const changes = lines
      .slice(1)
      .map((line) => {
        const changeMatch = line.match(/→ Changed ([^:]+): (\d+) → (\d+)/)
        if (changeMatch) {
          return {
            service: changeMatch[1],
            oldPort: changeMatch[2],
            newPort: changeMatch[3],
          }
        }
        return null
      })
      .filter(Boolean) as {
      service: string
      oldPort: string
      newPort: string
    }[]
    return {
      port,
      services,
      changes,
      raw: conflict,
      parsed: Boolean(portMatch),
    }
  })
}

export default function PortConflictsAlert({
  portConflicts,
}: PortConflictsAlertProps) {
  if (!portConflicts) return null

  const parsed = parseConflicts(portConflicts.conflicts)

  return (
    <Alert variant="info" className="my-3 border-amber-500/50 bg-amber-500/5">
      <ShieldAlert className="h-4 w-4 text-amber-500" />
      <AlertTitle className="text-amber-500">
        Port conflicts detected and auto-resolved
      </AlertTitle>
      <AlertDescription className="text-foreground text-xs">
        Found {portConflicts.conflicts.length} port conflict(s) across{" "}
        {portConflicts.fixed} service(s). Ports were automatically reassigned to
        avoid conflicts.
        <div className="mt-3 space-y-2">
          {parsed.map((item, i) => (
            <div
              key={`conflict-${i}`}
              className="rounded-md border border-amber-500/20 bg-background/50 p-2"
            >
              {item.parsed ? (
                <>
                  <div className="mb-1 flex items-center gap-1.5 font-medium text-xs">
                    <AlertCircle className="h-3 w-3 text-amber-500" />
                    Port <span className="font-mono">{item.port}</span> was
                    shared by: {item.services.join(", ")}
                  </div>
                  {item.changes.length > 0 && (
                    <div className="space-y-0.5">
                      {item.changes.map((change, j) => (
                        <div
                          key={`change-${j}`}
                          className="flex items-center gap-1.5 text-xs"
                        >
                          <span className="font-medium text-muted-foreground">
                            {change.service}:
                          </span>
                          <span className="rounded bg-destructive/15 px-1.5 py-0.5 font-mono text-destructive line-through">
                            {change.oldPort}
                          </span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                          <span className="rounded bg-success/15 px-1.5 py-0.5 font-mono text-success">
                            {change.newPort}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <pre className="mt-1 whitespace-pre-wrap rounded bg-muted/40 p-2 text-[11px] text-muted-foreground">
                  {item.raw}
                </pre>
              )}
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
