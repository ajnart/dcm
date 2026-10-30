import * as z from "zod"

// Common environment variables often used in Docker containers
const COMMON_ENV_VARS = [
  "TZ",
  "PUID",
  "PGID",
  "UMASK",
  "CONFIG_PATH",
  "DATA_PATH",
  "CONTAINER_PREFIX",
  "RESTART_POLICY",
]

// Regex pattern for environment variable reference like ${VAR_NAME}
const ENV_VAR_PATTERN = /\${([A-Za-z0-9_]+)}/g

/**
 * Schema for validating Docker Compose content
 */
export const composeContentSchema = z
  .string()
  .min(1, "Container definition is required")
  .refine((content) => content.trim().startsWith("services:"), {
    message: "Docker Compose must start with 'services:' declaration",
  })
  .refine(
    (content) => {
      // Must contain at least one service definition
      const serviceRegex = /^\s{2}[a-zA-Z0-9_-]+:/m
      return serviceRegex.test(content)
    },
    {
      message: "Docker Compose must contain at least one service definition",
    },
  )
  .refine(
    (content) => {
      // Must contain image definition
      const imageRegex = /^\s{4}image:/m
      return imageRegex.test(content)
    },
    {
      message: "Service must contain an image definition",
    },
  )
  .refine(
    (content) => {
      // Check for proper indentation only for first two levels
      // (2 spaces for services, 4 for properties)
      return content.split("\n").every((line) => {
        if (line.trim() === "") return true
        // Allow top-level sections (services, networks, volumes, etc.)
        if (line.match(/^[a-zA-Z0-9_-]+:/)) return true
        // Check service level (2 spaces)
        if (line.match(/^\s{2}[a-zA-Z0-9_-]+:/)) return true
        // Check property level (4 spaces)
        if (line.match(/^\s{4}[a-zA-Z0-9_-]+:/)) return true
        // Allow any indentation for deeper nesting
        if (line.match(/^\s{4,}/)) return true
        return false
      })
    },
    {
      message:
        "Docker Compose must use 2 spaces for services and 4 spaces for properties",
    },
  )

/**
 * Validates Docker Compose content and provides detailed error messages
 * @param content Docker Compose content to validate
 * @returns An object with success status and error messages if any
 */
export function validateComposeContent(content: string): {
  isValid: boolean
  errors: string[]
  warnings: string[]
  unusedEnvVars: string[]
  suggestedEnvVars: string[]
} {
  const result = {
    isValid: true,
    errors: [] as string[],
    warnings: [] as string[],
    unusedEnvVars: [] as string[],
    suggestedEnvVars: [] as string[],
  }

  try {
    // Basic validation with the schema
    composeContentSchema.parse(content)
  } catch (error) {
    if (error instanceof z.ZodError) {
      result.isValid = false
      result.errors = error.issues.map((issue) => issue.message)
      return result
    }
  }

  // Check for environment variables
  const usedEnvVars = new Set<string>()
  const hardcodedCommonVars = new Set<string>()

  // Extract all environment variable references
  const envVarMatches = [...content.matchAll(ENV_VAR_PATTERN)]
  envVarMatches.forEach((match) => usedEnvVars.add(match[1]))

  // Check for environment section
  if (content.includes("environment:")) {
    // Look for hardcoded values in common environment variables
    const envLines = content.match(/^\s{6}-\s+([A-Z0-9_]+)=(.+)$/gm) || []
    for (const line of envLines) {
      const match = line.match(/^\s{6}-\s+([A-Z0-9_]+)=(.+)$/)
      if (match) {
        const [, varName, value] = match
        const trimmedValue = value.trim()

        // Only check for hardcoded values in our common environment variables
        if (COMMON_ENV_VARS.includes(varName)) {
          // If the value doesn't use ${varName} syntax for this specific variable
          const expectedPattern = new RegExp(`\\$\\{${varName}\\}`)
          if (!expectedPattern.test(trimmedValue)) {
            hardcodedCommonVars.add(`${varName}=${trimmedValue}`)
          }
        }
      }
    }

    // Add warnings for hardcoded common variables
    if (hardcodedCommonVars.size > 0) {
      result.warnings.push(
        `Common environment variables should use their corresponding \${VAR} syntax: ${Array.from(hardcodedCommonVars).join(", ")}`,
      )
    }
  } else {
    result.warnings.push("Service doesn't define environment variables")
  }

  // Remove checks for TZ, PUID/PGID as they are just recommendations
  // Find unused environment variables from our common list
  result.unusedEnvVars = COMMON_ENV_VARS.filter((env) => !usedEnvVars.has(env))

  return result
}

export interface DockerTool {
  id: string
  name: string
  description: string
  category: string
  tags: string[]
  githubUrl?: string
  /** We recommend following this schema for common icons: https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@<commit>/<Format>/<Name>.<Format>, or a same-origin path under /images/containers/ when dashboard-icons has no icon */
  icon?: string
  stars?: number
  composeContent?: string
  /** composeContent is a standard 2-space `services:` block that must not be re-indented */
  verbatim?: boolean
  isUnsupported?: boolean
}
