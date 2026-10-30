import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { execSync } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { buildCatalog } from "../src/lib/catalog"
import { EXPORT_FILENAMES, buildExport } from "../src/lib/export"
import { DEFAULT_SETTINGS } from "../src/lib/settings"
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

async function validate(ids: string[]) {
  const exported = buildExport(ids, catalog, DEFAULT_SETTINGS)
  await writeFile(
    path.join(workDir, EXPORT_FILENAMES.compose),
    exported.compose,
    "utf8",
  )
  await writeFile(
    path.join(workDir, EXPORT_FILENAMES.env),
    exported.env,
    "utf8",
  )
  execSync("docker compose config --quiet", { cwd: workDir, encoding: "utf8" })
}

describe("Docker Compose Validation", () => {
  describe("Individual Services", () => {
    for (const entry of supportedEntries) {
      if (!entry.composeContent) continue
      test(`Service: ${entry.name}`, async () => {
        try {
          await validate([entry.id])
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
    await validate(
      supportedEntries.filter((entry) => entry.selfhostId).map((e) => e.id),
    )
  })

  test("All services together", async () => {
    await validate(supportedEntries.map((entry) => entry.id))
    expect(supportedEntries.length).toBeGreaterThan(0)
  })
})
