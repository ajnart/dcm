export function detectAndFixPortConflicts(content: string): {
  fixedContent: string
  conflicts: { fixed: number; conflicts: string[] } | null
} {
  const portMappingRegex = /- ["']?(\d+):(\d+)["']?/g

  const externalPorts: Record<string, Set<string>> = {}
  const conflicts: string[] = []
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

      conflicts.push(`Port ${port} was used by: ${services.join(", ")}`)

      for (let i = 1; i < services.length; i++) {
        const serviceToFix = services[i]

        const servicePortRegex = new RegExp(
          `(\\s{2}${serviceToFix}:[\\s\\S]*?ports:[\\s\\S]*?- ["']?)(${port})(:(?:\\d+)["']?)`,
          "gm",
        )

        let match: RegExpExecArray | null
        while ((match = servicePortRegex.exec(result)) !== null) {
          let newPort = Number(port) + 1
          while (allocatedPorts.has(String(newPort))) {
            newPort++
          }

          allocatedPorts.add(String(newPort))

          const replacement = `${match[1]}${newPort}${match[3]}`

          conflicts[conflicts.length - 1] +=
            `\n  → Changed ${serviceToFix}: ${port} → ${newPort}`

          result =
            result.substring(0, match.index) +
            replacement +
            result.substring(match.index + match[0].length)

          fixedCount++

          servicePortRegex.lastIndex = 0
        }
      }
    }
  })

  return {
    fixedContent: result,
    conflicts: conflicts.length > 0 ? { fixed: fixedCount, conflicts } : null,
  }
}
