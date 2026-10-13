const SOURCE = "https://selfhost.ajnart.dev/catalog.json"
const TARGET = new URL("../lib/selfhost-catalog.json", import.meta.url)

const response = await fetch(SOURCE)
if (!response.ok) {
  throw new Error(`Failed to fetch ${SOURCE}: ${response.status}`)
}

const catalog: unknown = await response.json()
await Bun.write(TARGET, `${JSON.stringify(catalog, null, 2)}\n`)
console.log(`Updated lib/selfhost-catalog.json from ${SOURCE}`)
