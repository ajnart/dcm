import { defineCollection } from "astro:content";
import { file } from "astro/loaders";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { z } from "astro/zod";
import { toApp } from "./lib/catalog";

const link = z.object({ from: z.string(), to: z.string(), title: z.string() });

const apps = defineCollection({
  loader: file("src/data/catalog.json", { parser: (text) => JSON.parse(text).apps.map(toApp) }),
  schema: z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    category: z.string().min(1),
    image: z.string().min(1),
    port: z.number().int().nonnegative(),
    icon: z.string(),
    stars: z.number().int().nonnegative(),
    repo: z.string(),
    links: z.array(link),
  }),
});

export const collections = { apps, docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }) };
