"use client"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { PortConflictsResult } from "@/lib/docker-compose/port-conflicts"
import { AlertCircle, ArrowRight, CheckCircle, XCircle } from "lucide-react"

interface PortConflictsAlertProps {
  portConflicts: PortConflictsResult
}

export default function PortConflictsAlert({
  portConflicts,
}: PortConflictsAlertProps) {
  if (!portConflicts) return null

  return (
    <Alert variant="info" className="my-3 bg-secondary">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Port conflicts detected and fixed</AlertTitle>
      <AlertDescription className="text-foreground text-xs">
        We found {portConflicts.conflicts.length} port conflict(s) and fixed{" "}
        {portConflicts.fixed} issue(s). We've fixed it for you. Because we're
        just <b>that cool 😎</b>
        {/* Detailed conflict visualization */}
        <div className="mt-3 space-y-3">
          {portConflicts.detailedConflicts.map((conflict, i) => (
            <div
              key={`conflict-${i}`}
              className="rounded-md border border-border/50 bg-background/50 p-3"
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="rounded bg-destructive/20 px-2 py-1 font-mono font-semibold text-destructive text-sm">
                  Port {conflict.port}
                </span>
                <span className="text-muted-foreground text-xs">
                  Conflicted between {conflict.affectedServices.length} services
                </span>
              </div>

              {/* Affected services */}
              <div className="mb-2 flex flex-wrap gap-1.5">
                {conflict.affectedServices.map((service, idx) => {
                  const isKept = service === conflict.keptService
                  const Icon = isKept ? CheckCircle : XCircle
                  return (
                    <div
                      key={service}
                      className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs ${
                        isKept
                          ? "bg-green-500/10 text-green-600 dark:text-green-400"
                          : "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                      }`}
                    >
                      <Icon className="h-3 w-3" />
                      <span className="font-medium">{service}</span>
                      {isKept && (
                        <span className="ml-1 text-[10px] opacity-70">
                          (kept)
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Port changes */}
              {conflict.changes.length > 0 && (
                <div className="space-y-1.5 border-border/30 border-t pt-2">
                  {conflict.changes.map((change, j) => (
                    <div
                      key={`change-${j}`}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span className="font-medium text-foreground">
                        {change.service}:
                      </span>
                      <span className="rounded-md bg-destructive/20 px-2 py-0.5 font-mono font-semibold text-destructive">
                        {change.oldPort}
                      </span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      <span className="rounded-md bg-green-500/20 px-2 py-0.5 font-mono font-semibold text-green-600 dark:text-green-400">
                        {change.newPort}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </AlertDescription>
    </Alert>
  )
}
