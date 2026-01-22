import type { DockerTool } from "@/lib/docker-tools"
import { automation } from "./automation"
import { databases } from "./database"
import { management } from "./management"
import { media } from "./media"
import { monitoring } from "./monitoring"
import { other } from "./other"

// Create a Map to store unique tools by ID
const toolMap = new Map<string, DockerTool>()

// Add tools in order of priority (media tools take precedence over automation tools)
const allTools = [
  ...automation,
  ...media,
  ...monitoring,
  ...management,
  ...databases,
  ...other,
]

// Ensure uniqueness by ID
allTools.forEach((tool) => {
  if (!toolMap.has(tool.id)) {
    toolMap.set(tool.id, tool)
  }
})

// Export the unique tools array
export const tools = Array.from(toolMap.values())
