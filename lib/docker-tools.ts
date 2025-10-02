import { tools } from "@/tools"
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
      result.errors = error.errors.map((err) => err.message)
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
  /** We recommend following this schema for common icons: https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/<Format>/<Name>.<Format> */
  icon?: string
  stars?: number
  composeContent?: string
  isUnsupported?: boolean
}

// Cache for GitHub stars data
let cachedTools: DockerTool[] | null = null

/**
 * Extracts the owner and repo from a GitHub URL
 * @param url GitHub URL in format https://github.com/owner/repo
 */
function extractGitHubInfo(
  url: string,
): { owner: string; repo: string } | null {
  try {
    const match = url.match(/github\.com\/([^/]+)\/([^/]+)/)
    if (!match) return null
    return { owner: match[1], repo: match[2] }
  } catch {
    return null
  }
}

/**
 * Helper function to add delay between requests
 */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Fetches GitHub stars for all tools that have a GitHub URL
 * This function should be called at build time to populate the stars field
 */
export async function fetchGitHubStars(): Promise<DockerTool[]> {
  // Return cached data if available
  if (cachedTools) {
    return cachedTools
  }

  // Skip fetching in development environment
  if (process.env.NODE_ENV === "development") {
    console.log("Skipping GitHub stars fetch in development environment")
    return tools
  }

  const toolsWithoutGitHub = tools.filter((tool) => !tool.githubUrl)
  const toolsWithGitHub = tools.filter((tool) => tool.githubUrl)

  // Create an array of promises for all GitHub requests
  const fetchPromises = toolsWithGitHub.map(async (tool) => {
    if (!tool.githubUrl) {
      return tool
    }

    const githubInfo = extractGitHubInfo(tool.githubUrl)
    if (!githubInfo) {
      return tool
    }

    try {
      const response = await fetch(
        `https://api.github.com/repos/${githubInfo.owner}/${githubInfo.repo}`,
        {
          headers: {
            Accept: "application/vnd.github.v3+json",
            ...(process.env.GITHUB_TOKEN && {
              Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
            }),
          },
        },
      )

      if (!response.ok) {
        console.warn(
          `Failed to fetch stars for ${tool.name}: ${response.statusText}`,
        )
        return tool
      }

      const data = await response.json()
      // No newline at the end
      console.log(
        `Fetched stars for ${tool.name} (${data.stargazers_count}) \t`,
        tool.githubUrl,
      )
      return {
        ...tool,
        stars: data.stargazers_count,
      }
    } catch (error) {
      console.warn(`Error fetching stars for ${tool.name}:`, error)
      return tool
    }
  })

  // Execute all promises concurrently
  const updatedGitHubTools = await Promise.all(fetchPromises)

  // Combine tools with and without GitHub URLs
  const updatedTools = [...toolsWithoutGitHub, ...updatedGitHubTools]

  // Cache the results
  cachedTools = updatedTools
  return updatedTools
}
