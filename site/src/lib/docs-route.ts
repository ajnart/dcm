import { defineRouteMiddleware, type StarlightRouteData } from "@astrojs/starlight/route-data";
import { recipeById } from "./catalog";
import { OG_HEIGHT, OG_WIDTH, ogPath, pageSlug } from "./og";

type Entry = StarlightRouteData["sidebar"][number];

const clean = (href: string): string => href.replace(/\.html(?=$|[?#])/, "");

function cleanEntries(entries: Entry[]): void {
  for (const entry of entries) {
    if (entry.type === "link") entry.href = clean(entry.href);
    else cleanEntries(entry.entries);
  }
}

function crumbs(slug: string, title: string): { name: string; item: string }[] {
  const site = "https://self-host.fyi";
  const trail = [
    { name: "self-host", item: `${site}/` },
    { name: "Docs", item: `${site}/docs` },
  ];
  if (slug === "docs") return trail;
  if (slug.startsWith("docs/recipes/")) {
    trail.push({ name: "Recipes", item: `${site}/docs/recipes` });
    const recipe = recipeById.get(slug.slice("docs/recipes/".length));
    return [...trail, { name: recipe?.name ?? title, item: `${site}/${slug}` }];
  }
  return [...trail, { name: title, item: `${site}/${slug}` }];
}

export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute;
  cleanEntries(route.sidebar);
  if (route.pagination.prev) route.pagination.prev.href = clean(route.pagination.prev.href);
  if (route.pagination.next) route.pagination.next.href = clean(route.pagination.next.href);

  const slug = pageSlug(context.url.pathname);
  if (slug.startsWith("docs/changelog")) Object.assign(route.entry.data, { pageActions: false });
  const canonical = `https://self-host.fyi/${slug}`;
  const title = route.entry.data.title;
  const description = route.entry.data.description ?? "";
  const image = new URL(ogPath(context.url.pathname), context.site).href;

  for (const tag of route.head) {
    if (tag.tag === "link" && tag.attrs?.rel === "canonical") tag.attrs.href = canonical;
    if (tag.tag === "meta" && tag.attrs?.property === "og:url") tag.attrs.content = canonical;
  }

  const meta = (attrs: Record<string, string>) => route.head.push({ tag: "meta", attrs, content: "" });
  meta({ property: "og:image", content: image });
  meta({ property: "og:image:type", content: "image/png" });
  meta({ property: "og:image:width", content: String(OG_WIDTH) });
  meta({ property: "og:image:height", content: String(OG_HEIGHT) });
  meta({ property: "og:image:alt", content: `self-host docs: ${title}` });
  meta({ name: "twitter:title", content: title });
  meta({ name: "twitter:description", content: description });
  meta({ name: "twitter:image", content: image });
  meta({ name: "twitter:image:alt", content: `self-host docs: ${title}` });

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs(slug, title).map((c, i) => ({ "@type": "ListItem", position: i + 1, ...c })),
  };
  route.head.push({ tag: "script", attrs: { type: "application/ld+json" }, content: JSON.stringify(breadcrumb) });
});
