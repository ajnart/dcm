// app/providers.tsx
"use client"

import { usePathname, useSearchParams } from "next/navigation"
import { usePostHog } from "posthog-js/react"
import { Suspense, useEffect } from "react"

import posthog from "posthog-js"
import { PostHogProvider as PHProvider } from "posthog-js/react"

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const enableAnalytics = process.env.NEXT_PUBLIC_ENABLE_ANALYTICS === "true"

  useEffect(() => {
    if (!enableAnalytics) return

    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY as string || "phc_zJtKQulbyeexy7V99Py1vEc8mS4RDQGIwCMkxle0j0n", {
      ui_host:
        process.env.NEXT_PUBLIC_POSTHOG_UI_HOST || "https://eu.i.posthog.com",
      api_host:
        process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com",
      person_profiles: "always",
      capture_pageview: false,
      capture_pageleave: true,
    })
  }, [])

  return (
    <PHProvider client={posthog}>
      <SuspendedPostHogPageView />
      {children}
    </PHProvider>
  )
}

function PostHogPageView() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const posthog = usePostHog()

  useEffect(() => {
    if (pathname && posthog) {
      let url = window.origin + pathname
      if (searchParams.toString()) {
        url = `${url}?${searchParams.toString()}`
      }

      posthog.capture("$pageview", { $current_url: url })
    }
  }, [pathname, searchParams, posthog])

  return null
}

function SuspendedPostHogPageView() {
  return (
    <Suspense fallback={null}>
      <PostHogPageView />
    </Suspense>
  )
}
