import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightPageActions from "starlight-page-actions";
import starlightLinksValidator from "starlight-links-validator";
import starlightGitHubAlerts from "starlight-github-alerts";
import starlightHeadingBadges from "starlight-heading-badges";
import starlightChangelogs, { makeChangelogsSidebarLinks } from "starlight-changelogs";
import { changelog } from "./src/lib/changelog";
import catalog from "./src/data/catalog.json" with { type: "json" };
import { cspCheck, starlightInlineScriptHashes, styleAttributeHashes } from "./src/lib/csp.mjs";

export default defineConfig({
  site: "https://self-host.fyi",
  output: "static",
  trailingSlash: "never",
  build: { format: "file", inlineStylesheets: "never" },
  prefetch: { prefetchAll: true, defaultStrategy: "hover" },
  integrations: [
    starlight({
      title: "self-host docs",
      description: "How to install self-host, reach your Apps, drive it from an agent and fix what breaks.",
      titleDelimiter: "·",
      favicon: "/logo.svg",
      disable404Route: true,
      expressiveCode: false,
      customCss: ["./src/styles/theme.css", "./src/styles/shared.css", "./src/styles/transitions.css", "./src/styles/docs.css"],
      components: {
        SiteTitle: "./src/components/docs/SiteTitle.astro",
        ThemeProvider: "./src/components/docs/Empty.astro",
        ThemeSelect: "./src/components/docs/Empty.astro",
        Footer: "./src/components/docs/Footer.astro",
        SocialIcons: "./src/components/docs/SocialIcons.astro",
        MarkdownContent: "./src/components/docs/MarkdownContent.astro",
      },
      routeMiddleware: "./src/lib/docs-route.ts",
      plugins: [
        starlightGitHubAlerts(),
        starlightHeadingBadges(),
        starlightChangelogs(),
        starlightLinksValidator({ exclude: ["/apps", "/apps/**", "/docs/recipes", "/docs/recipes/**", "/telemetry"] }),
        starlightPageActions({ actions: { markdown: true, chatgpt: true, claude: true, cursor: true } }),
      ],
      head: [
        { tag: "meta", attrs: { name: "theme-color", content: "#1e1d2a" } },
        { tag: "link", attrs: { rel: "icon", href: "/icon-192.png", type: "image/png", sizes: "192x192" } },
        { tag: "link", attrs: { rel: "apple-touch-icon", href: "/apple-touch-icon.png" } },
        { tag: "link", attrs: { rel: "manifest", href: "/site.webmanifest" } },
        { tag: "link", attrs: { rel: "alternate", type: "text/plain", href: "/llms.txt", title: "llms.txt" } },
        {
          tag: "script",
          attrs: {
            defer: true,
            src: "https://static.cloudflareinsights.com/beacon.min.js",
            "data-cf-beacon": '{"token": "048a529692b643f79d0b152c27926bdf"}',
          },
        },
      ],
      sidebar: [
        {
          label: "Guides",
          items: [
            { label: "Overview", link: "/docs" },
            { label: "Getting started", link: "/docs/getting-started" },
            { label: "Access", link: "/docs/access" },
            { label: "Agents", link: "/docs/agents" },
            { label: "Troubleshooting", link: "/docs/troubleshooting" },
            ...(changelog.enabled ? makeChangelogsSidebarLinks([{ type: "all", base: changelog.base, label: "Changelog" }]) : []),
          ],
        },
        {
          label: "Recipes",
          collapsed: true,
          items: [
            { label: "All Recipes", link: "/docs/recipes" },
            ...catalog.recipes.map((r) => ({ label: r.name, link: `/docs/recipes/${r.id}` })),
          ],
        },
      ],
    }),
    sitemap({ filter: (page) => !page.endsWith("/404") }),
    cspCheck(),
  ],
  markdown: { syntaxHighlight: false },
  devToolbar: { enabled: false },
  security: {
    csp: {
      directives: [
        "default-src 'none'",
        "connect-src 'self' https://cloudflareinsights.com",
        "media-src 'self'",
        "manifest-src 'self'",
        "img-src 'self' data: https://cdn.jsdelivr.net",
        "base-uri 'none'",
        "form-action 'none'",
      ],
      scriptDirective: { resources: ["'self'", "https://static.cloudflareinsights.com"], hashes: await starlightInlineScriptHashes() },
      styleDirective: { resources: ["'self'", "'unsafe-hashes'"], hashes: styleAttributeHashes },
    },
  },
});
