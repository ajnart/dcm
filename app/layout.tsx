import { Footer } from "@/components/layout/Footer"
import { Header } from "@/components/layout/Header"
import { Toaster } from "@/components/ui/sonner"
import { SettingsProvider } from "@/lib/settings-context"
import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "dcm · Docker Compose Maker",
  description:
    "Select tools to generate your docker-compose.yaml, or let self-host install them for you",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="icon" href="/favicon.png" sizes="any" />
      </head>
      <body>
        <SettingsProvider>
          <div className="flex min-h-screen flex-col">
            <Header />
            <main className="flex-1">{children}</main>
            <Footer />
          </div>
          <Toaster />
        </SettingsProvider>
      </body>
    </html>
  )
}
