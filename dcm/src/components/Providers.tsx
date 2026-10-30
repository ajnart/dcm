import { Toaster } from "@/components/ui/sonner"
import { SettingsProvider } from "@/lib/settings-context"
import type { ReactNode } from "react"

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      {children}
      <Toaster theme="dark" />
    </SettingsProvider>
  )
}
