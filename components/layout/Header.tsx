import { ContainerSubmissionForm } from "@/components/container-submission-form"
import { McpSetupDialog } from "@/components/mcp-setup-dialog"
import { ThemeToggle } from "@/components/theme-toggle"
import { GradientButton } from "@/components/ui/gradient-button"
import { buildSelfHostLink } from "@/lib/selfhost"
import { ArrowUpRight, Heart } from "lucide-react"
import { siGithub } from "simple-icons"

/** Render the shared DCM header and its primary discovery actions. */
export function Header() {
  return (
    <header className="relative z-10 bg-primary/80 bg-stripes py-8 text-primary-foreground shadow-md dark:bg-stripes-dark">
      <div className="container mx-auto px-4">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="mb-2 font-bold text-xl motion-safe:animate-slide-in-left md:text-2xl lg:text-3xl">
              Docker Compose Generator
            </h1>
            <p className="text-sm opacity-90 [animation-delay:150ms] motion-safe:animate-slide-in-left md:text-lg lg:text-xl">
              Select the tools you want to include in your docker-compose.yaml
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-3 lg:w-auto lg:justify-end">
            <ThemeToggle />
            <McpSetupDialog />
            <ContainerSubmissionForm />

            <GradientButton
              href={buildSelfHostLink()}
              external
              gradientFrom="from-sky-400/20"
              gradientTo="to-indigo-300/20"
            >
              <span>self-host</span>
              <ArrowUpRight />
            </GradientButton>

            <GradientButton
              href="https://ko-fi.com/ajnart"
              external
              gradientFrom="from-amber-500/20"
              gradientTo="to-orange-400/20"
            >
              <Heart fill="currentColor" />
              <span>Support me</span>
            </GradientButton>

            <GradientButton href="https://github.com/ajnart/dcm" external>
              <svg
                aria-label="GitHub"
                role="img"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4 fill-current"
              >
                <path d={siGithub.path} />
              </svg>
              <span>GitHub</span>
            </GradientButton>
          </div>
        </div>
      </div>
    </header>
  )
}
