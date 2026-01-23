export interface PortChange {
  service: string
  oldPort: string
  newPort: string
}

export interface PortConflict {
  port: string
  affectedServices: string[]
  keptService: string
  changes: PortChange[]
}

export interface PortConflictsResult {
  fixed: number
  conflicts: string[]
  detailedConflicts: PortConflict[]
}

export function detectAndFixPortConflicts(content: string): {
  fixedContent: string
  conflicts: PortConflictsResult | null
} {
  const portMappingRegex = /- ["']?(\d+):(\d+)["']?/g

  const externalPorts: Record<string, Set<string>> = {}
  const conflicts: string[] = []
  const detailedConflicts: PortConflict[] = []
  let fixedCount = 0

  let result = content.slice()

  const allocatedPorts = new Set<string>()

  const portMatches = content.matchAll(portMappingRegex)
  for (const portMatch of portMatches) {
    const externalPort = portMatch[1]
    allocatedPorts.add(externalPort)

    let serviceContext = content.substring(0, portMatch.index!)
    const lastServicesSectionIndex = serviceContext.lastIndexOf("services:")
    if (lastServicesSectionIndex >= 0) {
      serviceContext = serviceContext.substring(lastServicesSectionIndex)
    }

    const serviceLines = serviceContext.split("\n")
    let serviceName = "unknown"

    for (let i = serviceLines.length - 1; i >= 0; i--) {
      const line = serviceLines[i].trim()
      const serviceNameMatch = serviceLines[i].match(
        /^\s{2}([a-zA-Z0-9_-]+):\s*(?:#.*)?$/,
      )
      if (serviceNameMatch) {
        serviceName = serviceNameMatch[1]
        break
      }
    }

    if (!externalPorts[externalPort]) {
      externalPorts[externalPort] = new Set<string>()
    }
    externalPorts[externalPort].add(serviceName)
  }

  Object.entries(externalPorts).forEach(([port, servicesSet]) => {
    const services = Array.from(servicesSet)
    if (services.length > 1) {
      const keptService = services[0]
      const changes: PortChange[] = []

      conflicts.push(`Port ${port} was used by: ${services.join(", ")}`)

      for (let i = 1; i < services.length; i++) {
        const serviceToFix = services[i]

        // Match the service's port definition within its own service block only
        // Pattern explanation:
        // 1. \s{2}${serviceToFix}: - Match the service name at 2-space indentation
        // 2. \s*(?:[^\n]*\n(?!\s{2}[a-zA-Z0-9_-]+:))*? - Match lines within this service
        //    - (?!\s{2}[a-zA-Z0-9_-]+:) negative lookahead prevents crossing into next service
        // 3. [^\n]*ports:[\s\S]*? - Find the ports: section within this service
        // 4. - ["']? - Match the port line prefix
        // 5. (${port}) - Capture the external port number
        // 6. (:(?:\d+)["']?) - Capture the internal port mapping
        const servicePortRegex = new RegExp(
          `(\\s{2}${serviceToFix}:\\s*(?:[^\\n]*\\n(?!\\s{2}[a-zA-Z0-9_-]+:))*?[^\\n]*ports:[\\s\\S]*?- ["']?)(${port})(:(?:\\d+)["']?)`,
          "m",
        )

        const match = servicePortRegex.exec(result)
        if (match) {
          let newPort = Number(port) + 1
          while (allocatedPorts.has(String(newPort))) {
            newPort++
          }

          allocatedPorts.add(String(newPort))

          const replacement = `${match[1]}${newPort}${match[3]}`

          conflicts[conflicts.length - 1] +=
            `\n  → Changed ${serviceToFix}: ${port} → ${newPort}`

          // Add to changes array for detailed conflicts
          changes.push({
            service: serviceToFix,
            oldPort: port,
            newPort: String(newPort),
          })

          // Update the result with the fixed port
          // Note: We only match once per service, so modifying result here is safe
          result =
            result.substring(0, match.index) +
            replacement +
            result.substring(match.index + match[0].length)

          fixedCount++
        }
      }

      // Add detailed conflict info
      detailedConflicts.push({
        port,
        affectedServices: services,
        keptService,
        changes,
      })
    }
  })

  return {
    fixedContent: result,
    conflicts:
      conflicts.length > 0
        ? { fixed: fixedCount, conflicts, detailedConflicts }
        : null,
  }
}
