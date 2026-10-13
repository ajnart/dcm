import Link from "next/link"

export function Footer() {
  return (
    <footer className="mt-12 border-line border-t bg-deep py-6">
      <div className="container flex flex-wrap items-center justify-between gap-2 text-muted-foreground text-sm">
        <p>
          <span className="text-pink">◆</span> dcm by{" "}
          <Link
            href="https://github.com/ajnart"
            target="_blank"
            className="text-ink hover:text-pink"
          >
            ajnart
          </Link>
        </p>
        <p>
          Prefer a guided install?{" "}
          <a
            href="https://selfhost.ajnart.dev/?ref=dcm"
            target="_blank"
            rel="noopener noreferrer"
            className="text-pink hover:underline"
          >
            self-host
          </a>
        </p>
      </div>
    </footer>
  )
}
