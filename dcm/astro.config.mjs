import react from "@astrojs/react"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "astro/config"

export default defineConfig({
  site: "https://self-host.fyi",
  base: process.env.DCM_BASE ?? "/",
  output: "static",
  trailingSlash: "always",
  build: { format: "directory" },
  integrations: [react()],
  devToolbar: { enabled: false },
  vite: { plugins: [tailwindcss()] },
})
