import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { execSync } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { buildCatalog } from "../src/lib/catalog"
import { DEFAULT_SETTINGS } from "../src/lib/constants"
import {
  generateComposeContent,
  generateEnvFile,
} from "../src/lib/docker-compose/generators"
import type { DockerTool } from "../src/lib/docker-tools"
import { tools } from "../src/tools"

const catalog = buildCatalog(tools)
const supportedEntries = catalog.entries.filter((entry) => !entry.isUnsupported)

let workDir = ""

beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "dcm-compose-"))
})

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true })
})

async function validate(selected: DockerTool[]) {
  const { content } = generateComposeContent(selected, DEFAULT_SETTINGS, false)
  const env = generateEnvFile(selected, DEFAULT_SETTINGS)
  await writeFile(path.join(workDir, "docker-compose.yaml"), content, "utf8")
  await writeFile(path.join(workDir, ".env"), env, "utf8")
  execSync("docker compose config --quiet", { cwd: workDir, encoding: "utf8" })
}

describe("Docker Compose Validation", () => {
  describe("Individual Services", () => {
    for (const entry of supportedEntries) {
      if (!entry.composeContent) continue
      test(`Service: ${entry.name}`, async () => {
        try {
          await validate([entry])
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          throw new Error(
            `Service "${entry.name}" failed validation: ${message}`,
          )
        }
      })
    }
  })

  test("All self-host Apps together", async () => {
    await validate(supportedEntries.filter((entry) => entry.selfhostId))
  })

  test("All services together", async () => {
    await validate(supportedEntries)
    expect(supportedEntries.length).toBeGreaterThan(0)
  })
})
