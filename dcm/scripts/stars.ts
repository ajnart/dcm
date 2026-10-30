import { tools } from "@/tools"
import { writeFile } from "node:fs/promises"

const BATCH = 50
const OUTPUT = new URL("../src/data/stars.json", import.meta.url)

interface StarEntry {
  repo: string
  stars: number
}

interface GraphQLResponse {
  data?: Record<string, { stargazerCount: number } | null>
  errors?: { message: string }[]
}

function parseRepo(url: string): string | undefined {
  const match = url.match(/github\.com\/([^/]+)\/([^/#?]+)/)
  if (!match) return undefined
  return `${match[1]}/${match[2].replace(/\.git$/, "")}`
}

async function fetchBatch(
  token: string,
  batch: { id: string; repo: string }[],
): Promise<Record<string, StarEntry>> {
  const fields = batch.map(({ repo }, index) => {
    const [owner, name] = repo.split("/")
    return `r${index}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { stargazerCount }`
  })
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query: `{ ${fields.join(" ")} }` }),
  })
  if (!response.ok) {
    throw new Error(`GitHub GraphQL answered ${response.status}`)
  }
  const result = (await response.json()) as GraphQLResponse
  for (const error of result.errors ?? []) console.error(error.message)
  const found: Record<string, StarEntry> = {}
  batch.forEach(({ id, repo }, index) => {
    const repository = result.data?.[`r${index}`]
    if (repository) found[id] = { repo, stars: repository.stargazerCount }
  })
  return found
}

const token = process.env.GITHUB_TOKEN
if (!token) throw new Error("set GITHUB_TOKEN to read star counts")

const targets = tools.flatMap((tool) => {
  const repo = tool.githubUrl ? parseRepo(tool.githubUrl) : undefined
  return repo ? [{ id: tool.id, repo }] : []
})

const stars: Record<string, StarEntry> = {}
for (let start = 0; start < targets.length; start += BATCH) {
  Object.assign(
    stars,
    await fetchBatch(token, targets.slice(start, start + BATCH)),
  )
}

function byKey([a]: [string, unknown], [b]: [string, unknown]): number {
  if (a === b) return 0
  if (a < b) return -1
  return 1
}

const sorted = Object.fromEntries(Object.entries(stars).sort(byKey))
await writeFile(OUTPUT, `${JSON.stringify(sorted, null, 1)}\n`)
console.log(`${Object.keys(sorted).length}/${targets.length} repositories`)
