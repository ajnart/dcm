import type { APIRoute } from "astro";
import { APPS, INSTALL, RECIPES } from "../data/site";

const head = `# self-host

> One Go binary that installs, signs in, wires together and repairs self-hosted Apps with Docker Compose, for people through a terminal Dashboard and for agents through plain commands with --json.

Install on Linux, macOS or WSL with Docker and the Compose v2 plugin:

    ${INSTALL}

Agents: run \`self-host skill\` and follow the guide it prints. Every change follows inspect, plan, approval, apply, verify; loading the skill is intent, never approval. Ask the person before any install, remove or restore, then pass --yes.

## Docs

- [README](https://github.com/ajnart/selfhost-skills/blob/main/README.md): install, quick start, Links, commands, Access, Backup
- [Agent skill](https://github.com/ajnart/selfhost-skills/blob/main/skills/self-host/SKILL.md): the discoverable skill, a router to \`self-host skill\`
- [Catalog JSON](https://self-host.fyi/catalog.json): every App and Recipe, with ports, images and Links
- [Releases](https://github.com/ajnart/selfhost-skills/releases): CLI archives and checksums.txt

## Commands

- \`self-host doctor --json\`: check Docker, ports and the machine
- \`self-host apps list --json\`, \`self-host apps info <app> --json\`: browse the Catalog
- \`self-host install <app|recipe> --yes --json\`: install after approval
- \`self-host status --json\`: Apps, Addresses and Setup state
- \`self-host debug <app>\`: failed steps, hints and masked logs
`;

export const GET: APIRoute = () => {
  const recipes = RECIPES.map((r) => `- \`${r.id}\` (${r.name}): ${r.d}. Apps: ${r.apps.join(", ")}`);
  const apps = APPS.map((a) => `- \`${a.id}\` (${a.name}, ${a.c}): ${a.d}${a.l.length ? `. Links to ${a.l.join(", ")}` : ""}`);
  const body = [head, "## Recipes", "", ...recipes, "", "## Apps", "", ...apps, ""].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
