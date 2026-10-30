import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

async function htmlFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((e) => e.isFile() && e.name.endsWith(".html")).map((e) => join(e.parentPath, e.name));
}

const ORIGIN = "https://self-host.fyi";
const CARD = { width: 1200, height: 630 };
const TITLE_MAX = 60;
const DESCRIPTION = { min: 50, max: 160 };
const BREADCRUMBED = /^\/(apps|compose|docs|telemetry)(\/|$)/;

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };

function decode(text) {
  return text.replace(/&(?:#x([\da-f]+)|#(\d+)|\w+);/gi, (entity, hex, decimal) => {
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    if (decimal) return String.fromCodePoint(Number(decimal));
    return ENTITIES[entity] ?? entity;
  });
}

const attributes = (source) => Object.fromEntries([...source.matchAll(/([\w:.-]+)(?:="([^"]*)")?/g)].map(([, name, value]) => [name, decode(value ?? "")]));

function readPage(html) {
  const head = html.slice(0, html.indexOf("</head>"));
  return {
    lang: /<html[^>]*\slang="([^"]*)"/.exec(html)?.[1],
    title: decode(/<title[^>]*>([\s\S]*?)<\/title>/.exec(head)?.[1] ?? "").trim(),
    tags: [...head.matchAll(/<(meta|link)\s([^>]*?)\/?>/g)].map(([, tag, source]) => ({ tag, ...attributes(source) })),
    jsonld: [...head.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)].map(([, body]) => body),
    refresh: /http-equiv="refresh"/i.test(head),
  };
}

const urlOf = (dir, file) => {
  const path = `/${relative(dir, file).replace(/\.html$/, "")}`.replace(/\/index$/, "");
  return path || "/";
};

const metas = (page, key, value) => page.tags.filter((t) => t.tag === "meta" && t[key] === value).map((t) => t.content ?? "");

async function pngSize(path) {
  const bytes = await readFile(path);
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47) return undefined;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function sitemapUrls(dir) {
  const locs = (xml) => [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map(([, loc]) => decode(loc));
  const urls = [];
  for (const sitemap of locs(await readFile(join(dir, "sitemap-index.xml"), "utf8"))) {
    urls.push(...locs(await readFile(join(dir, new URL(sitemap).pathname), "utf8")));
  }
  return urls;
}

export async function auditSeo(dir) {
  const problems = [];
  const warnings = [];
  const pages = new Map();

  for (const file of await htmlFiles(dir)) {
    pages.set(urlOf(dir, file), readPage(await readFile(file, "utf8")));
  }

  let sitemap = [];
  try {
    sitemap = await sitemapUrls(dir);
  } catch (error) {
    problems.push(`sitemap: ${error.message}`);
  }
  const inSitemap = new Set(sitemap);

  let robots = "";
  try {
    robots = await readFile(join(dir, "robots.txt"), "utf8");
  } catch {
    problems.push("robots.txt is missing");
  }
  if (!robots.includes(`Sitemap: ${ORIGIN}/sitemap-index.xml`)) problems.push("robots.txt does not point to the sitemap");

  const seen = { title: new Map(), description: new Map(), canonical: new Map() };
  const shared = new Map();
  const unique = (kind, value, url) => {
    const first = seen[kind].get(value);
    if (first === undefined) seen[kind].set(value, url);
    return first;
  };

  for (const [url, page] of pages) {
    const fail = (message) => problems.push(`${url}: ${message}`);
    const warn = (message) => warnings.push(`${url}: ${message}`);
    const noindex = metas(page, "name", "robots").some((c) => /noindex/i.test(c));

    if (url === "/404" && !noindex) fail("the 404 page must be noindex");
    if (noindex || page.refresh) {
      if (inSitemap.has(`${ORIGIN}${url}`)) fail("noindex page is in the sitemap");
      continue;
    }

    const one = (key, value) => {
      const found = metas(page, key, value);
      if (found.length !== 1) {
        fail(`${found.length} <meta ${key}="${value}">, want 1`);
        return "";
      }
      if (!found[0].trim()) fail(`empty ${value}`);
      return found[0];
    };

    if (page.lang !== "en") fail(`html lang is ${page.lang ?? "missing"}`);
    one("name", "viewport");
    one("name", "theme-color");
    if (!page.tags.some((t) => t.tag === "link" && /\bicon\b/.test(t.rel ?? "") && t.href)) fail("no favicon");

    if (!page.title) fail("no <title>");
    if (page.title.length > TITLE_MAX) warn(`title is ${page.title.length} characters: ${page.title}`);
    const titleTwin = unique("title", page.title, url);
    if (titleTwin) fail(`same <title> as ${titleTwin}: ${page.title}`);

    const description = one("name", "description");
    if (description.length < DESCRIPTION.min || description.length > DESCRIPTION.max) fail(`description is ${description.length} characters, want ${DESCRIPTION.min}-${DESCRIPTION.max}: ${description}`);
    const descriptionTwin = unique("description", description, url);
    if (descriptionTwin) fail(`same description as ${descriptionTwin}`);

    const canonicals = page.tags.filter((t) => t.tag === "link" && t.rel === "canonical").map((t) => t.href);
    if (canonicals.length !== 1) fail(`${canonicals.length} canonical links, want 1`);
    const canonical = canonicals[0] ?? "";
    if (canonical !== `${ORIGIN}${url}`) fail(`canonical ${canonical} is not ${ORIGIN}${url}`);
    const canonicalTwin = unique("canonical", canonical, url);
    if (canonicalTwin) fail(`same canonical as ${canonicalTwin}`);
    if (!inSitemap.has(canonical)) fail("canonical is not in the sitemap");

    one("property", "og:type");
    one("property", "og:site_name");
    one("property", "og:title");
    if (one("property", "og:description") !== description) fail("og:description differs from the description");
    if (one("property", "og:url") !== canonical) fail("og:url differs from the canonical");

    const image = one("property", "og:image");
    if (!image.startsWith(`${ORIGIN}/`)) fail(`og:image is not an absolute ${ORIGIN} URL: ${image}`);
    else {
      const size = await pngSize(join(dir, new URL(image).pathname)).catch(() => undefined);
      if (!size) fail(`og:image is not a built PNG: ${image}`);
      else if (size.width !== CARD.width || size.height !== CARD.height) fail(`og:image is ${size.width}x${size.height}, want ${CARD.width}x${CARD.height}`);
      shared.set(image, [...(shared.get(image) ?? []), url]);
    }
    if (one("property", "og:image:width") !== String(CARD.width)) fail(`og:image:width is not ${CARD.width}`);
    if (one("property", "og:image:height") !== String(CARD.height)) fail(`og:image:height is not ${CARD.height}`);
    one("property", "og:image:alt");

    if (one("name", "twitter:card") !== "summary_large_image") fail("twitter:card is not summary_large_image");
    one("name", "twitter:title");
    if (one("name", "twitter:description") !== description) fail("twitter:description differs from the description");
    if (one("name", "twitter:image") !== image) fail("twitter:image differs from og:image");

    let breadcrumbed = false;
    for (const body of page.jsonld) {
      let data;
      try {
        data = JSON.parse(body);
      } catch {
        fail("JSON-LD is not valid JSON");
        continue;
      }
      const nodes = data["@graph"] ?? [data];
      if (data["@context"] !== "https://schema.org") fail("JSON-LD has no schema.org @context");
      for (const node of nodes) {
        if (node["@type"] !== "BreadcrumbList") continue;
        breadcrumbed = true;
        const last = node.itemListElement?.at(-1)?.item;
        if (last !== canonical) fail(`last breadcrumb ${last} is not the canonical`);
      }
    }
    if (BREADCRUMBED.test(url) && !breadcrumbed) fail("no BreadcrumbList JSON-LD");
  }

  for (const [image, urls] of shared) {
    if (urls.length > 1) warnings.push(`${image} is the og:image of ${urls.length} pages: ${urls.slice(0, 3).join(", ")}`);
  }

  for (const loc of sitemap) {
    const url = new URL(loc).pathname;
    if (!loc.startsWith(`${ORIGIN}/`) || !pages.has(url)) problems.push(`sitemap lists ${loc}, which is not a built page`);
  }

  return { problems, warnings, pages: pages.size };
}

export function seoCheck() {
  return {
    name: "self-host:seo-check",
    hooks: {
      "astro:build:done": async ({ dir, logger }) => {
        const { problems, warnings, pages } = await auditSeo(fileURLToPath(dir));
        for (const warning of warnings.slice(0, 20)) logger.warn(warning);
        if (problems.length) throw new Error(`SEO audit failed (${problems.length}):\n${problems.slice(0, 40).join("\n")}`);
        logger.info(`${pages} pages have complete SEO and share metadata`);
      },
    },
  };
}
