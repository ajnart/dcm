import { buildSelfHostLink } from "@/lib/selfhost"
import { ArrowUpRight } from "lucide-react"

export function SelfHostButton() {
  return (
    <a
      href={buildSelfHostLink()}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:-translate-x-px hover:-translate-y-px inline-flex items-center gap-1.5 border border-pink bg-pink px-3 py-1.5 font-bold text-bg text-sm shadow-xs transition-all hover:shadow-sm"
    >
      self-host
      <ArrowUpRight className="h-4 w-4" />
    </a>
  )
}
