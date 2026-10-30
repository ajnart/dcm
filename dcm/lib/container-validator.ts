import { tools } from "@/tools"
import { validateComposeContent } from "./docker-tools"

export interface ValidationResult {
  containerId: string
  containerName: string
  isValid: boolean
  errors: string[]
  warnings: string[]
  unusedEnvVars: string[]
  suggestedEnvVars: string[]
}

/**
 * Validates all containers in the tools array
 * @returns Array of validation results for each container
 */
export function validateAllContainers(): ValidationResult[] {
  return tools
    .filter((tool) => tool.composeContent) // Only validate tools with compose content
    .map((tool) => {
      const validation = validateComposeContent(tool.composeContent!)

      return {
        containerId: tool.id,
        containerName: tool.name,
        ...validation,
      }
    })
}

/**
 * Checks if a container passes validation with no errors
 * (warnings are allowed)
 */
export function isContainerValid(result: ValidationResult): boolean {
  return result.isValid && result.errors.length === 0
}

/**
 * Get a formatted string of validation issues for a container
 */
export function getValidationSummary(result: ValidationResult): string {
  const issues: string[] = []

  if (result.errors.length > 0) {
    issues.push(`Errors:\n${result.errors.map((e) => `  - ${e}`).join("\n")}`)
  }

  if (result.warnings.length > 0) {
    issues.push(
      `Warnings:\n${result.warnings.map((w) => `  - ${w}`).join("\n")}`,
    )
  }

  if (result.suggestedEnvVars.length > 0) {
    issues.push(
      `Suggested Environment Variables:\n${result.suggestedEnvVars.map((v) => `  - ${v}`).join("\n")}`,
    )
  }

  return issues.join("\n\n")
}
