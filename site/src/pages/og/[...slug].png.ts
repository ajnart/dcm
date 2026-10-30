import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection } from "astro:content";
import { allTemplates, buildCatalog } from "@/lib/catalog";
import { templates } from "@/lib/templates";
import { tools } from "@/tools";
import { apps, linkCount, recipes } from "../../lib/catalog";
import { type Card, pageSlug, renderCard } from "../../lib/og";

export const getStaticPaths = (async () => {
  const docs = await getCollection("docs");
  const composeTemplates = allTemplates(buildCatalog(tools), templates);
  const cards: Card[] = [
    { slug: "apps", kicker: "apps", title: `${apps.length} self-hosted Apps`, subtitle: `Each one command away, with ${linkCount} Links that wire them together.` },
    { slug: "compose", kicker: "compose", title: "Docker Compose Maker", subtitle: "Pick self-hosted apps and generate a Docker Compose file, or let self-host install them for you." },
    { slug: "compose/templates", kicker: "compose / templates", title: "Template Gallery", subtitle: `${composeTemplates.length} ready-made Docker Compose stacks: media servers, monitoring, networking and more.` },
    { slug: "compose/suggest", kicker: "compose / suggest", title: "Suggest a container", subtitle: "Add a missing app to Docker Compose Maker with an AI coding agent, or open an issue." },
    ...composeTemplates.map((t) => ({ slug: `compose/template/${t.id}`, kicker: "compose / template", title: t.name, subtitle: t.description })),
    { slug: "telemetry", kicker: "telemetry", title: "Telemetry and Feedback", subtitle: "What self-host sends, what it never sends, and how to turn it off." },
    ...apps.map((a) => ({ slug: `apps/${a.id}`, kicker: `apps / ${a.category}`, title: a.name, subtitle: a.description, icon: a.icon || undefined, letter: a.icon ? undefined : a.name[0] })),
    { slug: "docs/changelog", kicker: "docs / changelog", title: "Changelog", subtitle: "Every self-host release: what was added, changed and fixed." },
    ...docs.map((d) => ({ slug: pageSlug(d.id), kicker: "docs", title: d.data.title, subtitle: d.data.description ?? "" })),
    { slug: "docs/recipes", kicker: "docs / recipes", title: "Recipes", subtitle: `${recipes.length} pre-wired bundles of Apps, each one command away.` },
    ...recipes.map((r) => ({ slug: `docs/recipes/${r.id}`, kicker: "docs / recipes", title: r.name, subtitle: r.description })),
  ];
  return cards.map((card) => ({ params: { slug: card.slug }, props: { card } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) => {
  const png = await renderCard((props as { card: Card }).card);
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png" } });
};
