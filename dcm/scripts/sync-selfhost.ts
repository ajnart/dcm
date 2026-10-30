const SOURCE = "https://self-host.fyi/catalog.json"
const TARGET = new URL("../lib/selfhost-catalog.json", import.meta.url)

const response = await fetch(SOURCE)
if (!response.ok) {
  throw new Error(`Failed to fetch ${SOURCE}: ${response.status}`)
}

const catalog = (await response.json()) as { apps?: unknown }
if (!Array.isArray(catalog.apps)) {
  throw new Error(`Unexpected catalog shape from ${SOURCE}`)
}
await Bun.write(TARGET, `${JSON.stringify(catalog, null, 2)}\n`)
console.log(`Updated lib/selfhost-catalog.json from ${SOURCE}`)
