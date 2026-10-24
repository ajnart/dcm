import { appById, linksAmong, recipes } from "./catalog";

type Recipe = (typeof recipes)[number];

export const markdownResponse = (body: string): Response => new Response(body, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });

export function recipeIndexMarkdown(): string {
  const rows = recipes.map((r) => `| [${r.name}](https://self-host.fyi/docs/recipes/${r.id}) | ${r.description}. | ${r.apps.length} |`);
  return [
    "# Recipes",
    "",
    "A Recipe is a named, pre-wired bundle of Apps chosen together for one purpose. Installing it installs all of its Apps and runs their Setup and Links.",
    "",
    "| Recipe | What it is for | Apps |",
    "| --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

export function recipeMarkdown(recipe: Recipe): string {
  const nameOf = (id: string) => appById.get(id)?.name ?? id;
  const members = recipe.apps.flatMap((id) => appById.get(id) ?? []);
  const links = linksAmong(recipe.apps);
  return [
    `# ${recipe.name}`,
    "",
    `${recipe.description}. The \`${recipe.id}\` Recipe installs ${members.map((a) => a.name).join(", ")} into your Project and runs their Setup.`,
    "",
    "## Install",
    "",
    "```bash",
    `self-host install ${recipe.id}`,
    "```",
    "",
    "On a terminal, self-host shows the plan and asks before it changes anything. Agents pass `--yes --json` only after the person approves.",
    "",
    "## Apps",
    "",
    "| App | What it does | Port |",
    "| --- | --- | --- |",
    ...members.map((a) => `| [${a.name}](https://self-host.fyi/apps/${a.id}) | ${a.description}. | ${a.port || "none"} |`),
    "",
    "## Links",
    "",
    ...(links.length > 0 ? links.map((l) => `- **${nameOf(l.from)}** → ${nameOf(l.to)}: ${l.title}`) : ["The Apps in this Recipe have no Links to each other."]),
    "",
  ].join("\n");
}
