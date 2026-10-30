import { defineCollection } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { file } from "astro/loaders";
import type { Loader } from "astro/loaders";
import { z } from "astro/zod";
import { changelogsLoader } from "starlight-changelogs/loader";
import { toApp } from "./lib/catalog";
import { changelog, rank } from "./lib/changelog";

function changelogLoader(): Loader {
	const loader = changelogsLoader([changelog]);
	return {
		...loader,
		load: async (context) => {
			await loader.load(context);
			for (const entry of context.store.values()) {
				if (typeof entry.data.title !== "string") continue;
				context.store.set({
					...entry,
					data: { ...entry.data, index: rank(entry.data.title) },
				});
			}
		},
	};
}

const link = z.object({ from: z.string(), to: z.string(), title: z.string() });

const apps = defineCollection({
	loader: file("src/data/catalog.json", {
		parser: (text) => JSON.parse(text).apps.map(toApp),
	}),
	schema: z.object({
		name: z.string().min(1),
		description: z.string().min(1),
		category: z.string().min(1),
		image: z.string().min(1),
		port: z.number().int().nonnegative(),
		icon: z.string(),
		lightIcon: z.string(),
		stars: z.number().int().nonnegative(),
		repo: z.string(),
		links: z.array(link),
	}),
});

export const collections = {
	apps,
	changelogs: defineCollection({ loader: changelogLoader() }),
	docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
