import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://self-host.fyi",
  output: "static",
  trailingSlash: "ignore",
  build: { format: "file", inlineStylesheets: "never" },
  devToolbar: { enabled: false },
  security: {
    csp: {
      directives: [
        "default-src 'none'",
        "connect-src 'self'",
        "media-src 'self'",
        "manifest-src 'self'",
        "img-src 'self' https://cdn.jsdelivr.net",
        "base-uri 'none'",
        "form-action 'none'",
      ],
    },
  },
});
