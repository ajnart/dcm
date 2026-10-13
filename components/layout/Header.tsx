import { ContainerSubmissionForm } from "@/components/container-submission-form"
import { SelfHostButton } from "@/components/layout/SelfHostButton"
import { McpSetupDialog } from "@/components/mcp-setup-dialog"
import { Heart } from "lucide-react"
import Link from "next/link"

const navLink =
  "px-2 py-1 text-muted-foreground text-sm transition-colors hover:text-pink"

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-line border-b bg-deep/95 backdrop-blur">
      <div className="bg-stripes">
        <div className="container flex flex-wrap items-center justify-between gap-3 py-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1 border border-purple bg-purple px-2.5 py-1 font-bold text-ink text-sm shadow-xs"
          >
            <span className="text-pink">◆</span> dcm
          </Link>
          <nav className="flex flex-wrap items-center gap-1">
            <Link prefetch={false} href="/templates" className={navLink}>
              Templates
            </Link>
            <McpSetupDialog />
            <ContainerSubmissionForm />
            <a
              href="https://github.com/ajnart/dcm"
              target="_blank"
              rel="noopener noreferrer"
              className={navLink}
            >
              GitHub
            </a>
            <a
              href="https://ko-fi.com/ajnart"
              target="_blank"
              rel="noopener noreferrer"
              className={navLink}
            >
              <Heart className="mr-1 inline h-3.5 w-3.5" />
              Support
            </a>
            <SelfHostButton />
          </nav>
        </div>
      </div>
    </header>
  )
}
