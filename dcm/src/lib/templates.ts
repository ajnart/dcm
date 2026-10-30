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
export function getToolsFromTemplate<T extends { id: string }>(
  template: Template,
  allTools: T[],
): T[] {
  return template.tools
    .map((toolId) => allTools.find((tool) => tool.id === toolId))
    .filter((tool): tool is T => tool !== undefined)
}

// Export TemplateCategory for backward compatibility
export { TemplateCategory }

// Export templates from template-definitions
export const templates = templateDefinitions
