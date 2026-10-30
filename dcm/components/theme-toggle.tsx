"use client"

import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      aria-label="Toggle theme"
      className="relative flex h-8 w-8 items-center justify-center rounded-md text-primary-foreground/80 transition-all duration-300 hover:bg-primary-foreground/15 hover:text-primary-foreground motion-safe:animate-slide-in-right motion-safe:hover:scale-110"
    >
      <Sun className="dark:-rotate-90 h-4 w-4 rotate-0 scale-100 transition-all duration-300 dark:scale-0" />
      <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all duration-300 dark:rotate-0 dark:scale-100" />
    </button>
  )
}
