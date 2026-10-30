import { tools } from "../tools"
import { buildCatalog } from "./catalog"

interface VoteStore {
  get(key: string): Promise<string | null>
  put(
    key: string,
    value: string,
    options?: { expirationTtl: number },
  ): Promise<void>
  list(options: { prefix: string; limit: number; cursor?: string }): Promise<{
    keys: { name: string }[]
    list_complete: boolean
    cursor?: string
  }>
}

export interface VotingContext {
  request: Request
  env: {
    UPVOTES?: VoteStore
    VOTE_IP_SECRET?: string
  }
  waitUntil(promise: Promise<unknown>): void
}

export const containerIds = new Set(
  buildCatalog(tools).entries.map(({ id }) => id),
)
export const VOTE_PREFIX = "vote:"
export const VOTE_INTERVAL_SECONDS = 60

export function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  })
}

export function votingUnavailable() {
  return json(
    { error: "Community upvotes are unavailable on this instance." },
    503,
  )
}

export async function fingerprint(secret: string, value: string) {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value))
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")
}

export async function readVoteBody(request: Request) {
  const reader = request.body?.getReader()
  if (!reader) return null
  const decoder = new TextDecoder()
  let body = ""
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 1024) {
        await reader.cancel()
        return null
      }
      body += decoder.decode(value, { stream: true })
    }
    return body + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}
