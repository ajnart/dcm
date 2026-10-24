import {
  VOTE_INTERVAL_SECONDS,
  VOTE_PREFIX,
  type VotingContext,
  containerIds,
  fingerprint,
  json,
  readVoteBody,
  votingUnavailable,
} from "../../lib/voting-server"

export async function onRequest({ request, env }: VotingContext) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405, { Allow: "POST" })
  }
  if (request.headers.get("Origin") !== new URL(request.url).origin) {
    return json({ error: "Votes must come from this site." }, 403)
  }
  if (
    request.headers.get("Content-Type")?.split(";")[0].trim() !==
    "application/json"
  ) {
    return json({ error: "Expected application/json." }, 415)
  }
  if (!env.UPVOTES || !env.VOTE_IP_SECRET) return votingUnavailable()
  const ip = request.headers.get("CF-Connecting-IP")
  if (!ip) return votingUnavailable()

  try {
    const body = await readVoteBody(request)
    if (!body)
      return json({ error: "Expected a JSON body of at most 1 KiB." }, 400)
    let payload: unknown
    try {
      payload = JSON.parse(body)
    } catch {
      return json({ error: "Invalid JSON." }, 400)
    }
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("containerId" in payload) ||
      typeof payload.containerId !== "string" ||
      !containerIds.has(payload.containerId)
    ) {
      return json({ error: "Unknown container ID." }, 400)
    }

    const voter = await fingerprint(
      env.VOTE_IP_SECRET,
      `vote:${payload.containerId}:${ip}`,
    )
    const ballot = `${VOTE_PREFIX}${payload.containerId}:${voter}`
    if (await env.UPVOTES.get(ballot)) return json({ accepted: false })

    const rateKey = `rate:${await fingerprint(env.VOTE_IP_SECRET, `rate:${ip}`)}`
    const lastVote = Number(await env.UPVOTES.get(rateKey))
    const now = Date.now()
    const retryAfter = Math.ceil(
      (lastVote + VOTE_INTERVAL_SECONDS * 1000 - now) / 1000,
    )
    if (retryAfter > 0) {
      return json(
        { error: "Please wait before upvoting another container." },
        429,
        {
          "Retry-After": String(retryAfter),
        },
      )
    }

    await env.UPVOTES.put(rateKey, String(now), {
      expirationTtl: VOTE_INTERVAL_SECONDS,
    })
    await env.UPVOTES.put(ballot, "1")
    return json({ accepted: true })
  } catch (error) {
    console.error("Unable to record a community upvote", error)
    return votingUnavailable()
  }
}
