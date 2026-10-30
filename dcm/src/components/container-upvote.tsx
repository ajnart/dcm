import { Button } from "@/components/ui/button"
import type { Upvotes } from "@/hooks/use-upvotes"
import { Loader2, ThumbsUp } from "lucide-react"

interface ContainerUpvoteProps {
  id: string
  name: string
  upvotes: Upvotes
}

export default function ContainerUpvote({
  id,
  name,
  upvotes,
}: ContainerUpvoteProps) {
  const voted = upvotes.voted.includes(id)
  const pending = upvotes.pending === id
  let count = "—"
  let label = "Upvote"
  let title =
    "Anonymous community upvotes. One per container per network. Counts may be delayed."
  if (upvotes.state.status === "ready")
    count = String(upvotes.state.counts[id] ?? 0)
  if (upvotes.state.status === "loading") title = "Loading community upvotes…"
  if (upvotes.state.status === "unavailable")
    title = "Community upvotes are unavailable on this instance."
  if (voted) label = "Upvoted"
  if (pending) label = "Saving…"
  if (upvotes.state.status === "unavailable") label = "Upvotes unavailable"
  const Icon = pending ? Loader2 : ThumbsUp

  return (
    <span className="container-upvote mt-3 self-start" title={title}>
      <Button
        type="button"
        size="sm"
        variant={voted ? "secondary" : "outline"}
        disabled={
          upvotes.state.status !== "ready" || voted || upvotes.pending !== null
        }
        aria-label={`${label} ${name}: ${count} community upvotes. ${title}`}
        aria-pressed={voted}
        aria-busy={pending}
        onClick={(event) => {
          event.stopPropagation()
          void upvotes.vote(id)
        }}
      >
        <Icon data-icon="inline-start" />
        {label} <span className="tabular-nums">{count}</span>
      </Button>
    </span>
  )
}
