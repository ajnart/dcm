import { getCollection } from "astro:content";
import { allTemplates, buildCatalog } from "@/lib/catalog";
import { getToolsFromTemplate, templates } from "@/lib/templates";
import { tools } from "@/tools";
import type { APIRoute, GetStaticPaths } from "astro";
import { appById, apps, linkCount, recipes } from "../../lib/catalog";
import { PAGE_SIZE, changelog } from "../../lib/changelog";
import {
	type Art,
	type Card,
	type ServiceIcon,
	pageSlug,
	renderCard,
} from "../../lib/og";

const GRID_SLOTS = 12;

const distinct = (services: ServiceIcon[]): ServiceIcon[] =>
	[
		...new Map(services.map((service) => [service.name, service])).values(),
	].slice(0, GRID_SLOTS);

const DOC_ART: Record<string, Art> = {
	docs: { kind: "image", name: "install" },
	"docs/getting-started": { kind: "image", name: "command" },
	"docs/apps": { kind: "image", name: "links" },
	"docs/agents": { kind: "image", name: "agents" },
};

const SKIPPED_HEADLINES = /^(self-host|changes since|install)\b/i;

const headline = (body: string | undefined): string | undefined =>
	body
		?.split("\n")
		.filter((line) => line.startsWith("## "))
		.map((line) => line.slice(3).trim())
		.find((line) => !SKIPPED_HEADLINES.test(line));

const releaseDate = (date: Date | undefined): string | undefined =>
	date?.toISOString().slice(0, 10);

export const getStaticPaths = (async () => {
	const docs = await getCollection("docs");
	const releases = await getCollection("changelogs");
	const catalog = buildCatalog(tools);
	const composeTemplates = allTemplates(catalog, templates);
	const templateIcons = composeTemplates.flatMap((t) =>
		getToolsFromTemplate(t, catalog.entries),
	);
	const recipeIcons = recipes.flatMap((r) =>
		r.apps.flatMap((id) => appById.get(id) ?? []),
	);

	const hero: Card[] = [
		{
			kind: "page",
			slug: "apps",
			label: "apps",
			title: `${apps.length} self-hosted Apps`,
			subtitle: `Each one command away, with ${linkCount} Links that wire them together.`,
			art: { kind: "image", name: "servers" },
		},
		{
			kind: "page",
			slug: "compose",
			label: "compose",
			title: "Docker Compose Maker",
			subtitle:
				"Pick self-hosted apps and generate a Docker Compose file, or let self-host install them for you.",
			art: { kind: "yaml" },
		},
		{
			kind: "page",
			slug: "compose/templates",
			label: "compose / templates",
			title: "Template Gallery",
			subtitle: `${composeTemplates.length} ready-made Docker Compose stacks: media servers, monitoring, networking and more.`,
			art: { kind: "grid", services: distinct(templateIcons) },
		},
		{
			kind: "page",
			slug: "compose/suggest",
			label: "compose / suggest",
			title: "Suggest a container",
			subtitle:
				"Add a missing app to Docker Compose Maker with an AI coding agent, or open an issue.",
			art: { kind: "suggest" },
		},
		{
			kind: "page",
			slug: "telemetry",
			label: "telemetry",
			title: "Telemetry and Feedback",
			subtitle:
				"What self-host sends, what it never sends, and how to turn it off.",
			art: { kind: "telemetry" },
		},
	];

	const appCards: Card[] = apps.map((a) => ({
		kind: "app",
		slug: `apps/${a.id}`,
		name: a.name,
		description: a.description,
		category: a.category,
		stars: a.stars,
		command: `self-host install ${a.id}`,
		icon: a.icon || undefined,
	}));

	const templateCards: Card[] = composeTemplates.map((t) => {
		const services = getToolsFromTemplate(t, catalog.entries).map((entry) => ({
			name: entry.name,
			icon: entry.icon,
		}));
		return {
			kind: "stack",
			slug: `compose/template/${t.id}`,
			label: "compose / template",
			title: t.name,
			description: t.description,
			chips: [t.category, `${services.length} apps`],
			services,
		};
	});

	const docCards: Card[] = docs.map((d) => {
		const slug = pageSlug(d.id);
		return {
			kind: "page",
			slug,
			label: slug === "docs" ? "overview" : "guides",
			title: d.data.title,
			subtitle: d.data.description ?? "",
			art: DOC_ART[slug],
			docs: true,
		};
	});

	const recipeCards: Card[] = [
		{
			kind: "page",
			slug: "docs/recipes",
			label: "recipes",
			title: "Recipes",
			subtitle: `${recipes.length} pre-wired bundles of Apps, each one command away.`,
			art: { kind: "grid", services: distinct(recipeIcons) },
			docs: true,
		},
		...recipes.map(
			(r): Card => ({
				kind: "stack",
				slug: `docs/recipes/${r.id}`,
				label: "recipes",
				title: r.name,
				description: r.description,
				chips: ["Recipe", `${r.apps.length} Apps`],
				services: r.apps
					.flatMap((id) => appById.get(id) ?? [])
					.map((a) => ({ name: a.name, icon: a.icon || undefined })),
				docs: true,
			}),
		),
	];

	const versions = releases
		.filter((r) => changelog.enabled && r.data.base === changelog.base)
		.sort((a, b) => a.data.index - b.data.index);
	const releaseCards: Card[] = versions.map((r) => ({
		kind: "release",
		slug: r.id,
		version: r.data.title,
		date: releaseDate(r.data.date),
		headline: headline(r.body),
	}));
	const pages = Math.ceil(versions.length / PAGE_SIZE);
	const listCards: Card[] = Array.from({ length: pages }, (_, i) => {
		const slice = versions.slice(i * PAGE_SIZE, (i + 1) * PAGE_SIZE);
		return {
			kind: "page",
			slug: i === 0 ? "docs/changelog" : `docs/changelog/${i + 1}`,
			label: "changelog",
			title: i === 0 ? "Changelog" : `Changelog, page ${i + 1}`,
			subtitle: `Releases ${slice.at(-1)?.data.title} to ${slice[0].data.title}: what was added, changed and fixed.`,
			docs: true,
		};
	});
	if (changelog.enabled && pages === 0)
		listCards.push({
			kind: "page",
			slug: changelog.base,
			label: "changelog",
			title: "Changelog",
			subtitle:
				"Every self-host release: what was added, changed and fixed, newest first.",
			docs: true,
		});

	const cards = [
		...hero,
		...appCards,
		...templateCards,
		...docCards,
		...recipeCards,
		...releaseCards,
		...listCards,
	];
	return cards.map((card) => ({
		params: { slug: card.slug },
		props: { card },
	}));
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) => {
	const png = await renderCard((props as { card: Card }).card);
	return new Response(new Uint8Array(png), {
		headers: { "Content-Type": "image/png" },
	});
};
