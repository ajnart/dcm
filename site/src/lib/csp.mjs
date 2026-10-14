import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const sha256 = (text) => `sha256-${createHash("sha256").update(text).digest("base64")}`;

const require = createRequire(import.meta.url);

export async function starlightInlineScriptHashes() {
  const hashes = [];
  for (const name of ["Search.astro", "SidebarPersister.astro"]) {
    const source = await readFile(require.resolve(`@astrojs/starlight/components/${name}`), "utf8");
    for (const [, body] of source.matchAll(/<script is:inline[^>]*>([\s\S]*?)<\/script>/g)) hashes.push(sha256(body));
  }
  return hashes;
}

const STYLE_ATTRIBUTES = [
  "display: none;",
  "padding:0",
  "margin: auto; text-align: center; white-space: pre-line;",
  "--depth: 0;",
  "--depth: 1;",
  "--depth: 2;",
  "--sl-icon-size: 1em;",
  "--sl-icon-size: 1rem;",
  "--sl-icon-size: 1.25rem;",
  "--sl-icon-size: 1.5rem;",
];

export const styleAttributeHashes = STYLE_ATTRIBUTES.map(sha256);

async function htmlFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((e) => e.isFile() && e.name.endsWith(".html")).map((e) => join(e.parentPath, e.name));
}

export function cspCheck() {
  return {
    name: "self-host:csp-check",
    hooks: {
      "astro:build:done": async ({ dir, logger }) => {
        const problems = [];
        for (const file of await htmlFiles(fileURLToPath(dir))) {
          const html = await readFile(file, "utf8");
          const policy = /http-equiv="content-security-policy" content="([^"]*)"/i.exec(html)?.[1] ?? "";
          const allowed = (text) => policy.includes(`'${sha256(text)}'`);
          for (const [, attrs, body] of html.matchAll(/<(?:script|style)(\s[^>]*)?>([\s\S]*?)<\/(?:script|style)>/g)) {
            if (!body || /\ssrc=|application\/ld\+json/.test(attrs ?? "")) continue;
            if (!allowed(body)) problems.push(`${file}: inline ${body.trim().slice(0, 60)}`);
          }
          for (const [, value] of html.matchAll(/\sstyle="([^"]*)"/g)) {
            if (!allowed(value)) problems.push(`${file}: style="${value}"`);
          }
        }
        if (problems.length) throw new Error(`Content Security Policy blocks:\n${[...new Set(problems)].slice(0, 20).join("\n")}`);
        logger.info("every inline script, style and style attribute is allowed by the CSP");
      },
    },
  };
}
