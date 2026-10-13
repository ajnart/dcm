"use client"

import { GradientButton } from "@/components/ui/gradient-button"
import { buildSelfHostLink } from "@/lib/selfhost"
import { Rocket } from "lucide-react"
import posthog from "posthog-js"

/** Link the header to the self-host landing page. */
export function SelfHostButton() {
  return (
    <GradientButton
      href={buildSelfHostLink()}
      external
      gradientFrom="from-emerald-500/20"
      gradientTo="to-teal-400/20"
      onClick={() =>
        posthog.capture("selfhost_link_clicked", {
          source: "header",
          apps: [],
        })
      }
    >
      <Rocket />
      <span>Try self-host</span>
    </GradientButton>
  )
}
