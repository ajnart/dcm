import type { PortChange } from "./types"

const TOP_LEVEL_KEY = /^([A-Za-z0-9_-]+):\s*$/
const SERVICE_KEY = /^ {2}([^\s#][^:]*):\s*(?:#.*)?$/
const SERVICE_PROPERTY = /^ {4}([A-Za-z0-9_-]+):/

function rewriteEnvironmentPort(
  content: string,
  service: string,
  from: string,
  to: number,
): string {
  const hostReference = new RegExp(
    `(\\$\\{LAN_IP(?::?-[^}]*)?\\}):${from}(?!\\d)`,
    "g",
  )
  let inServices = false
  let inService = false
  let inEnvironment = false

  return content
    .split("\n")
    .map((line) => {
      const top = line.match(TOP_LEVEL_KEY)
      if (top) {
        inServices = top[1] === "services"
        inService = false
        inEnvironment = false
        return line
      }
      if (!inServices) return line

      const header = line.match(SERVICE_KEY)
      if (header) {
        inService = header[1] === service
        inEnvironment = false
        return line
      }
      if (!inService) return line

      const property = line.match(SERVICE_PROPERTY)
      if (property) {
        inEnvironment = property[1] === "environment"
        return line
      }
      if (!inEnvironment || line.trim().startsWith("#")) return line

      return line.replace(hostReference, `$1:${to}`)
    })
    .join("\n")
}

export function fixPortConflicts(content: string): {
  content: string
  changes: PortChange[]
} {
  const portMappingRegex = /- ["']?(\d+):(\d+)["']?/g

  const externalPorts: Record<string, Set<string>> = {}
  const changes: PortChange[] = []

  let result = content.slice()

  const allocatedPorts = new Set<string>()

  const portMatches = content.matchAll(portMappingRegex)
  for (const portMatch of portMatches) {
    const externalPort = portMatch[1]
    allocatedPorts.add(externalPort)

    let serviceContext = content.substring(0, portMatch.index)
    const lastServicesSectionIndex = serviceContext.lastIndexOf("services:")
    if (lastServicesSectionIndex >= 0) {
      serviceContext = serviceContext.substring(lastServicesSectionIndex)
    }

    const serviceLines = serviceContext.split("\n")
    let serviceName = "unknown"

    for (let i = serviceLines.length - 1; i >= 0; i--) {
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

  for (const [port, servicesSet] of Object.entries(externalPorts)) {
    const services = Array.from(servicesSet)
    if (services.length < 2) continue

    const keptService = services[0]

    for (const serviceToFix of services.slice(1)) {
      const servicePortRegex = new RegExp(
        `(\\s{2}${serviceToFix}:[\\s\\S]*?ports:[\\s\\S]*?- ["']?)(${port})(:(?:\\d+)["']?)`,
        "gm",
      )

      let match: RegExpExecArray | null = servicePortRegex.exec(result)
      while (match !== null) {
        let newPort = Number(port) + 1
        while (allocatedPorts.has(String(newPort))) {
          newPort++
        }

        allocatedPorts.add(String(newPort))

        changes.push({
          service: serviceToFix,
          keptBy: keptService,
          from: Number(port),
          to: newPort,
        })

        const head = result.substring(0, match.index)
        const tail = result.substring(match.index + match[0].length)
        result = `${head}${match[1]}${newPort}${match[3]}${tail}`

        result = rewriteEnvironmentPort(result, serviceToFix, port, newPort)

        servicePortRegex.lastIndex = 0
        match = servicePortRegex.exec(result)
      }
    }
  }

  return { content: result, changes }
}
