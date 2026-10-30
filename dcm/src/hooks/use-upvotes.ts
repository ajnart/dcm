import { useLocalStorage } from "@/hooks/useLocalStorage"
import { withBase } from "@/lib/base"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import * as z from "zod"

const statsSchema = z.object({
  counts: z.record(z.string(), z.number().int().nonnegative()),
})
const voteSchema = z.object({ accepted: z.boolean() })
const savedVotesSchema = z.array(z.string())

type UpvoteState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "ready"; counts: Record<string, number> }

export function useUpvotes() {
  const [state, setState] = useState<UpvoteState>({ status: "loading" })
  const [pending, setPending] = useState<string | null>(null)
  const inFlight = useRef(false)
  const savedVotes = useLocalStorage<unknown>("dcm-upvotes-v1", [])
  const parsedVotes = savedVotesSchema.safeParse(savedVotes.value)
  const voted = parsedVotes.data ?? []

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const response = await fetch(withBase("/api/stats"), {
          signal: AbortSignal.timeout(10000),
        })
        if (!response.ok) {
          if (active) setState({ status: "unavailable" })
          return
        }
        const result = statsSchema.safeParse(await response.json())
        if (!active) return
        if (!result.success) {
          setState({ status: "unavailable" })
          return
        }
        setState({ status: "ready", counts: result.data.counts })
      } catch {
        if (active) setState({ status: "unavailable" })
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [])

  async function vote(containerId: string) {
    if (
      state.status !== "ready" ||
      inFlight.current ||
      voted.includes(containerId)
    )
      return
    inFlight.current = true
    setPending(containerId)
    try {
      const response = await fetch(withBase("/api/vote"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ containerId }),
        signal: AbortSignal.timeout(10000),
      })
      if (response.status === 429) {
        const seconds = Number(response.headers.get("Retry-After")) || 60
        toast.error(
          `Please wait ${seconds} seconds before upvoting another container.`,
        )
        return
      }
      if (!response.ok) {
        toast.error("Unable to save your upvote. Please try again later.")
        return
      }
      const result = voteSchema.safeParse(await response.json())
      if (!result.success) {
        toast.error("Unable to confirm your upvote. Please try again later.")
        return
      }
      savedVotes.setValue([...voted, containerId])
      if (result.data.accepted) {
        setState((current) => {
          if (current.status !== "ready") return current
          return {
            status: "ready",
            counts: {
              ...current.counts,
              [containerId]: (current.counts[containerId] ?? 0) + 1,
            },
          }
        })
        toast.success("Thanks for your upvote!")
      } else {
        toast.info("This network has already upvoted this container.")
      }
    } catch {
      toast.error(
        "Unable to save your upvote. Check your connection and try again.",
      )
    } finally {
      inFlight.current = false
      setPending(null)
    }
  }

  return { state, pending, voted, vote }
}

export type Upvotes = ReturnType<typeof useUpvotes>
