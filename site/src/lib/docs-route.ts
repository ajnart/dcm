import {
	type StarlightRouteData,
	defineRouteMiddleware,
} from "@astrojs/starlight/route-data";
import { recipeById } from "./catalog";
import { isNoindex } from "./indexing.mjs";
import { ORIGIN, breadcrumbs, schema } from "./meta";
import { OG_HEIGHT, OG_WIDTH, ogPath, pageSlug } from "./og";

type Entry = StarlightRouteData["sidebar"][number];

const clean = (href: string): string => href.replace(/\.html(?=$|[?#])/, "");

function cleanEntries(entries: Entry[]): void {
	for (const entry of entries) {
		if (entry.type === "link") entry.href = clean(entry.href);
		else cleanEntries(entry.entries);
	}
}

type Changelog = { title: string; crumb: string; description: string };

function changelogPage(slug: string): Changelog | undefined {
	if (slug === "docs/changelog")
		return {
			title: "Changelog",
			crumb: "Changelog",
			description:
				"Every self-host release: what was added, changed and fixed, newest first.",
		};
	const list = /^docs\/changelog\/(\d+)$/.exec(slug);
	if (list) {
		const title = `Changelog, page ${list[1]}`;
		return {
			title,
			crumb: title,
			description: `Older self-host releases, page ${list[1]} of the changelog: what was added, changed and fixed.`,
		};
	}
	const version =
		/^docs\/changelog\/version\/(\d+)-(\d+)-(\d+)(\.\.\.latest)?$/.exec(slug);
	if (!version) return undefined;
	const number = version.slice(1, 4).join(".");
	if (version[4])
		return {
			title: `Changes since ${number}`,
			crumb: `Since ${number}`,
			description: `Everything that changed in self-host from ${number} to the latest release, on one page.`,
		};
	return {
		title: `self-host ${number} release notes`,
		crumb: number,
		description: `What changed in self-host ${number}: the release notes with every addition and fix.`,
	};
}

function crumbs(slug: string, title: string): [string, string][] {
	const trail: [string, string][] = [
		["self-host", "/"],
		["Docs", "/docs"],
	];
	if (slug === "docs") return trail;
	if (slug.startsWith("docs/recipes/")) {
		trail.push(["Recipes", "/docs/recipes"]);
		const recipe = recipeById.get(slug.slice("docs/recipes/".length));
		return [...trail, [recipe?.name ?? title, `/${slug}`]];
	}
	if (slug.startsWith("docs/changelog/version/"))
		trail.push(["Changelog", "/docs/changelog"]);
	return [...trail, [title, `/${slug}`]];
}

export const onRequest = defineRouteMiddleware((context) => {
	const route = context.locals.starlightRoute;
	cleanEntries(route.sidebar);
	if (route.pagination.prev)
		route.pagination.prev.href = clean(route.pagination.prev.href);
	if (route.pagination.next)
		route.pagination.next.href = clean(route.pagination.next.href);

	const slug = pageSlug(context.url.pathname);
	if (slug.startsWith("docs/changelog"))
		Object.assign(route.entry.data, { pageActions: false });
	const canonical = `${ORIGIN}/${slug}`;
	const changelog = changelogPage(slug);
	const title = changelog?.title ?? route.entry.data.title;
	const description =
		changelog?.description ?? route.entry.data.description ?? "";
	const noindex = isNoindex(context.url.pathname);
	const cardSlug = slug.startsWith("docs/changelog") ? "docs/changelog" : slug;
	const image = new URL(ogPath(`/${cardSlug}`), context.site).href;

	if (noindex)
		route.head = route.head.filter(
			(tag) => !(tag.tag === "link" && tag.attrs?.rel === "canonical"),
		);
	for (const tag of route.head) {
		if (tag.tag === "title" && changelog)
			tag.content = `${title} · ${route.siteTitle}`;
		if (tag.tag === "link" && tag.attrs?.rel === "canonical")
			tag.attrs.href = canonical;
		if (tag.tag !== "meta" || !tag.attrs) continue;
		if (tag.attrs.property === "og:url") tag.attrs.content = canonical;
		if (changelog && tag.attrs.property === "og:title")
			tag.attrs.content = title;
		if (
			changelog &&
			(tag.attrs.name === "description" ||
				tag.attrs.property === "og:description")
		)
			tag.attrs.content = description;
	}

	const meta = (attrs: Record<string, string>) =>
		route.head.push({ tag: "meta", attrs, content: "" });
	if (noindex) meta({ name: "robots", content: "noindex" });
	meta({ property: "og:image", content: image });
	meta({ property: "og:image:type", content: "image/png" });
	meta({ property: "og:image:width", content: String(OG_WIDTH) });
	meta({ property: "og:image:height", content: String(OG_HEIGHT) });
	meta({ property: "og:image:alt", content: `self-host docs: ${title}` });
	meta({ name: "twitter:title", content: title });
	meta({ name: "twitter:description", content: description });
	meta({ name: "twitter:image", content: image });
	meta({ name: "twitter:image:alt", content: `self-host docs: ${title}` });

	const jsonld = schema(
		breadcrumbs(...crumbs(slug, changelog?.crumb ?? title)),
	);
	route.head.push({
		tag: "script",
		attrs: { type: "application/ld+json" },
		content: JSON.stringify(jsonld),
	});
});
