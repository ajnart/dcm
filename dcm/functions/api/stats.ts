import {
  VOTE_PREFIX,
  type VotingContext,
  containerIds,
  json,
  votingUnavailable,
} from "../../src/lib/voting-server"

export async function onRequest({ request, env, waitUntil }: VotingContext) {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed." }, 405, { Allow: "GET" })
  }
  if (!env.UPVOTES || !env.VOTE_IP_SECRET) return votingUnavailable()

  try {
    const cache = await caches.open("community-upvotes-v1")
    const cacheUrl = new URL(request.url)
    cacheUrl.search = ""
    const cacheKey = new Request(cacheUrl)
    const cached = await cache.match(cacheKey)
    if (cached) return cached

    const counts: Record<string, number> = Object.fromEntries(
      [...containerIds].map((id) => [id, 0]),
    )
    let cursor: string | undefined
    for (let page = 0; page < 50; page++) {
      const result = await env.UPVOTES.list({
        prefix: VOTE_PREFIX,
        limit: 1000,
        cursor,
      })
      for (const key of result.keys) {
        const id = key.name.split(":")[1]
        if (containerIds.has(id)) counts[id]++
      }
      if (result.list_complete) {
        const response = json({ counts }, 200, {
          "Cache-Control": "public, max-age=60",
        })
        waitUntil(
          cache.put(cacheKey, response.clone()).catch((error: unknown) => {
            console.error("Unable to cache community upvotes", error)
          }),
        )
        return response
      }
      if (!result.cursor)
        throw new TypeError("Missing upvote pagination cursor")
      cursor = result.cursor
    }
    throw new RangeError("Community upvotes exceeded the 50-page listing limit")
  } catch (error) {
    console.error("Unable to load community upvotes", error)
    return votingUnavailable()
  }
}
