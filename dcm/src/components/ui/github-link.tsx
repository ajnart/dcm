
import { cn } from "@/lib/utils"
import { siGithub } from "simple-icons"

interface GitHubLinkProps {
  url: string
  className?: string
}

export function GitHubLink({ url, className }: GitHubLinkProps) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "github-link rounded-full bg-background/80 p-1.5 opacity-0 shadow-xs transition-all duration-300 hover:scale-110 hover:bg-background hover:shadow-md group-hover:opacity-100",
        className
      )}
      onClick={(e) => {
        e.stopPropagation()
      }}
    >
      <svg
        aria-label="GitHub"
        role="img"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
        className="h-4 w-4 fill-primary"
      >
        <path d={siGithub.path} />
      </svg>
      <span className="sr-only">GitHub repository</span>
    </a>
  )
} 