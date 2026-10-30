import { Button } from "@/components/ui/button"
import type { Upvotes } from "@/hooks/use-upvotes"
import { cn } from "@/lib/utils"
import { Loader2, ThumbsUp } from "lucide-react"

interface ContainerUpvoteProps {
  id: string
  name: string
  upvotes: Upvotes
}

const TITLE =
  "Anonymous community upvotes. One per container per network. Counts may be delayed."

export default function ContainerUpvote({
  id,
  name,
  upvotes,
}: ContainerUpvoteProps) {
  if (upvotes.state.status === "unavailable") return null

  const loading = upvotes.state.status === "loading"
  const count = upvotes.state.status === "ready" ? upvotes.state.counts[id] : 0
  const voted = upvotes.voted.includes(id)
  const pending = upvotes.pending === id
  let label = "Upvote"
  if (voted) label = "Upvoted"
  if (pending) label = "Saving…"
  const Icon = pending ? Loader2 : ThumbsUp

  return (
    <span
      className={cn("container-upvote mt-3 self-start", loading && "invisible")}
      title={TITLE}
    >
      <Button
        type="button"
        size="sm"
        variant={voted ? "secondary" : "outline"}
        disabled={loading || voted || upvotes.pending !== null}
        aria-label={`${label} ${name}: ${count} community upvotes. ${TITLE}`}
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
