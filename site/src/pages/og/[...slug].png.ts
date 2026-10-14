import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection } from "astro:content";
import { apps, linkCount, recipes } from "../../lib/catalog";
import { type Card, pageSlug, renderCard } from "../../lib/og";

export const getStaticPaths = (async () => {
  const docs = await getCollection("docs");
  const cards: Card[] = [
    { slug: "apps", kicker: "apps", title: `${apps.length} self-hosted Apps`, subtitle: `Each one command away, with ${linkCount} Links that wire them together.` },
    { slug: "telemetry", kicker: "telemetry", title: "Telemetry and Feedback", subtitle: "What self-host sends, what it never sends, and how to turn it off." },
    ...apps.map((a) => ({ slug: `apps/${a.id}`, kicker: `apps / ${a.category}`, title: a.name, subtitle: a.description, icon: a.icon || undefined, letter: a.icon ? undefined : a.name[0] })),
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
