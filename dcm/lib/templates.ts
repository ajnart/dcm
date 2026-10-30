import type { DockerTool } from "./docker-tools"
import { TemplateCategory } from "./template-categories"
import { templateDefinitions } from "./template-definitions"

export interface Template {
  id: string
  name: string
  description: string
  category: string
  icon?: string
  tools: string[] // Array of tool IDs
}

// Helper function to find tools by their IDs
export function getToolsFromTemplate(
  template: Template,
  allTools: DockerTool[],
): DockerTool[] {
  return template.tools
    .map((toolId) => allTools.find((tool) => tool.id === toolId))
    .filter((tool): tool is DockerTool => tool !== undefined)
}

// Export TemplateCategory for backward compatibility
export { TemplateCategory }

// Export templates from template-definitions
export const templates = templateDefinitions
