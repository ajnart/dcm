export interface ServiceBlock {
  name: string
  containerName?: string
  lines: string[]
}

const SERVICE_HEADER = /^ {2}([^\s#][^:]*):\s*$/
const CONTAINER_NAME = /^ {4}container_name:\s*(.+?)\s*$/

export function serviceNames(content: string): string[] {
  const names: string[] = []
  let inServices = false
  for (const line of content.split("\n")) {
    const top = line.match(/^([A-Za-z0-9_-]+):\s*$/)
    if (top) {
      inServices = top[1] === "services"
      continue
    }
    const header = inServices ? line.match(SERVICE_HEADER) : null
    if (header) names.push(header[1])
  }
  return names
}

export function splitServiceBlocks(content: string): ServiceBlock[] {
  const blocks: ServiceBlock[] = []
  let preamble: string[] = []
  for (const line of content.split("\n")) {
    const header = line.match(SERVICE_HEADER)
    if (header) {
      blocks.push({ name: header[1], lines: [...preamble, line] })
      preamble = []
      continue
    }
    const current = blocks[blocks.length - 1]
    if (!current) {
      preamble.push(line)
      continue
    }
    current.lines.push(line)
    const containerName = line.match(CONTAINER_NAME)
    if (containerName)
      current.containerName = containerName[1].replace(/^["']|["']$/g, "")
  }
  return blocks
}
