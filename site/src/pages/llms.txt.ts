import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { apps, recipes } from "../lib/catalog";
import { INSTALL, LINKS } from "../lib/site";

const intro = `# self-host

> One Go binary that installs, signs in, wires together and repairs self-hosted Apps with Docker Compose, for people through a terminal Dashboard and for agents through plain commands with --json.

Install on Linux, macOS or WSL with Docker and the Compose v2 plugin:

    ${INSTALL}

If curl is missing: \`wget -qO- https://self-host.fyi/install | bash\`.

Agents: run \`self-host skill\` and follow the guide it prints. Every change follows inspect, plan, approval, apply, verify; loading the skill is intent, never approval. Ask the person before any install, remove or restore, then pass --yes.

## Docs

`;

const references = `- [README](${LINKS.github}/blob/main/README.md): install, quick start, Links, commands, Access, Backup
- [Agent skill](${LINKS.github}/blob/main/skills/self-host/SKILL.md): the discoverable skill, a router to \`self-host skill\`
- [Catalog JSON](https://self-host.fyi/catalog.json): every App and Recipe, with ports, images and Links
- [Releases](${LINKS.releases}): CLI archives and checksums.txt
- [Discord](${LINKS.discord}): community and help

## Commands

- \`self-host doctor --json\`: check Docker, ports and the machine
- \`self-host apps list --json\`, \`self-host apps info <app> --json\`: browse the Catalog
- \`self-host install <app|recipe> --yes --json\`: install after approval
- \`self-host status --json\`: Apps, Addresses and Setup state
- \`self-host debug <app>\`: failed steps, hints and masked logs
`;

const docOrder = (d: { data: { sidebar: { order?: number } } }) => d.data.sidebar.order ?? 0;

export const GET: APIRoute = async () => {
  const docs = (await getCollection("docs")).sort((a, b) => docOrder(a) - docOrder(b));
  const docLines = [
    ...docs.map((d) => `- [${d.data.title}](https://self-host.fyi/${d.id}): ${d.data.description}`),
    `- [Recipes](https://self-host.fyi/docs/recipes): every Recipe, with one page each`,
  ];
  const recipeLines = recipes.map((r) => `- [\`${r.id}\`](https://self-host.fyi/docs/recipes/${r.id}) (${r.name}): ${r.description}. Apps: ${r.apps.join(", ")}`);
  const appLines = apps.map((a) => `- [\`${a.id}\`](https://self-host.fyi/apps/${a.id}) (${a.name}, ${a.category}): ${a.description}${a.links.length ? `. Links to ${a.links.map((l) => l.to).join(", ")}` : ""}`);
  const body = [intro + docLines.join("\n"), references, "## Recipes", "", ...recipeLines, "", "## Apps", "", ...appLines, ""].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
