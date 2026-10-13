import data from "../data/catalog.json";
import starCounts from "../data/stars.json";

export type Link = { from: string; to: string; title: string };

export type App = {
  id: string;
  name: string;
  description: string;
  category: string;
  image: string;
  port: number;
  icon: string;
  stars: number;
  repo: string;
  links: Link[];
};

export type Recipe = { id: string; name: string; description: string; apps: string[] };

const ICONS = "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/";

const github: Record<string, { repo: string; stars: number }> = starCounts;

type RawApp = (typeof data.apps)[number];

export const toApp = (a: RawApp): App => ({
  id: a.id,
  name: a.name,
  description: a.d,
  category: a.c,
  image: a.img,
  port: a.p,
  icon: a.i ? ICONS + a.i : "",
  stars: github[a.id]?.stars ?? 0,
  repo: github[a.id]?.repo ?? "",
  links: a.l.map((to, i) => ({ from: a.id, to, title: a.lt[i] })),
});

export const byPopularity = (a: Pick<App, "stars" | "name">, b: Pick<App, "stars" | "name">): number => b.stars - a.stars || a.name.localeCompare(b.name);

export const apps: App[] = data.apps.map(toApp).sort(byPopularity);

export function starLabel(stars: number): string {
  if (stars >= 1000) return `${(stars / 1000).toFixed(1)}k`;
  return String(stars);
}

export const recipes: Recipe[] = data.recipes.map((r) => ({ id: r.id, name: r.name, description: r.d, apps: r.apps }));

export const appById = new Map(apps.map((a) => [a.id, a]));
export const recipeById = new Map(recipes.map((r) => [r.id, r]));

export const linkCount = apps.reduce((n, a) => n + a.links.length, 0);
export const linkingApps = apps.filter((a) => a.links.length).length;

export function linksAmong(ids: Iterable<string>): Link[] {
  const set = new Set(ids);
  return [...set].flatMap((id) => appById.get(id)?.links.filter((l) => set.has(l.to)) ?? []);
}

export const linksInto = (id: string): Link[] => apps.flatMap((a) => a.links.filter((l) => l.to === id));

export const recipesWith = (id: string): Recipe[] => recipes.filter((r) => r.apps.includes(id));

export function expand(targets: Iterable<string>): { ids: string[]; unknown: string[] } {
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const target of targets) {
    const recipe = recipeById.get(target);
    if (recipe) ids.push(...recipe.apps);
    else if (appById.has(target)) ids.push(target);
    else unknown.push(target);
  }
  return { ids: [...new Set(ids)], unknown };
}

export const installLine = (ids: Iterable<string>): string => `self-host install ${[...ids].join(" ")}`;
