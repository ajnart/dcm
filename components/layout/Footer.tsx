import { buildSelfHostLink } from "@/lib/selfhost"
import { HeartIcon } from "lucide-react"
import Link from "next/link"

export function Footer() {
  return (
    <footer className="mt-8 border-t bg-background py-6">
      <div className="container mx-auto px-4 text-center text-muted-foreground">
        <p className="flex items-center justify-center gap-1">
          Made with{" "}
          <span className="text-red-500 motion-safe:animate-pulse">
            <HeartIcon size={16} fill="currentColor" />
          </span>{" "}
          by{" "}
          <Link
            href="https://github.com/ajnart"
            target="_blank"
            className="font-medium transition-colors hover:text-primary hover:underline"
          >
            ajnart
          </Link>
        </p>
        <p className="mt-2 text-sm">
          Prefer a guided install?{" "}
          <a
            href={buildSelfHostLink()}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium transition-colors hover:text-primary hover:underline"
          >
            self-host
          </a>
        </p>
      </div>
    </footer>
  )
}
