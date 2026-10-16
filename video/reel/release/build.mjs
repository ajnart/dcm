import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { MAX_APPS, scene } from "./scene.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const reel = join(here, "..");
const root = join(reel, "../..");
const SAMPLE = ["cleanuparr", "seerr", "immich", "jellyfin", "homarr", "sonarr"];

const catalog = JSON.parse(readFileSync(join(root, "site/src/data/catalog.json"), "utf8")).apps;
const byId = new Map(catalog.map((a) => [a.id, a]));

const mime = { svg: "image/svg+xml", png: "image/png" };
const uri = (file) => `data:${mime[file.split(".").pop()]};base64,${readFileSync(file).toString("base64")}`;

async function icon(id) {
  const app = byId.get(id);
  const names = [id, app?.i && basename(app.i, "." + app.i.split(".").pop())].filter(Boolean);
  for (const name of names)
    for (const ext of ["svg", "png"]) {
      const f = join(reel, "assets/icons", `${name}.${ext}`);
      if (existsSync(f)) return uri(f);
    }
  throw new Error(`no local icon for "${id}" in ${join(reel, "assets/icons")}`);
}

async function resolve(ids) {
  const out = [];
  for (const id of ids) {
    const a = byId.get(id);
    if (!a) throw new Error(`"${id}" is not in the Catalog (site/src/data/catalog.json)`);
    out.push({ id, name: a.name, category: a.c, description: a.d, icon: await icon(id) });
  }
  return out;
}

async function render(browser, apps, version, dir, base) {
  const still = scene({ apps, version, animate: false });
  const moving = scene({ apps, version, animate: true });
  writeFileSync(join(dir, `${base}.svg`), moving.svg);
  const page = await browser.newPage({ viewport: { width: still.w, height: still.h }, deviceScaleFactor: 2 });
  await page.setContent(`<!doctype html><style>*{margin:0}html,body{background:transparent}svg{display:block}</style>${still.svg}`);
  await page.screenshot({ path: join(dir, `${base}.png`), omitBackground: true });
  await page.close();
  return { base, alt: still.alt, svg: statSync(join(dir, `${base}.svg`)).size, png: statSync(join(dir, `${base}.png`)).size };
}

const die = (msg) => {
  console.error(`release-visual: ${msg}`);
  process.exit(1);
};
const guard = async (fn) => {
  try {
    return await fn();
  } catch (e) {
    die(e.message);
  }
};

const outDir = (given) => {
  const dir = isAbsolute(given) ? given : resolvePath(process.cwd(), given);
  mkdirSync(dir, { recursive: true });
  return dir;
};

await guard(async () => {
  const { values: args } = parseArgs({ options: {
    apps: { type: "string" },
    version: { type: "string" },
    out: { type: "string" },
    preview: { type: "boolean" },
  } });
  let ids = [];
  if (!args.preview) {
    if (typeof args.apps !== "string") throw new Error("--apps is required; give 1 to 6 App ids");
    ids = args.apps.split(",").map((s) => s.trim());
    if (ids.some((id) => !id)) throw new Error("--apps contains an empty App id; give 1 to 6 App ids");
    if (ids.length > MAX_APPS) throw new Error(`${ids.length} Apps requested, the layout supports at most ${MAX_APPS}`);
    if (new Set(ids).size !== ids.length) throw new Error("--apps contains duplicate App ids");
    if (!args.version) throw new Error("--version is required, e.g. --version 0.5.11");
  }
  const version = (args.version || "0.5.11").replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error("--version must be a version such as 0.5.11");
  const apps = await resolve(ids);
  const browser = await chromium.launch();
  try {
  if (args.preview) {
    const dir = outDir(join(here, "out/preview"));
    for (let n = 1; n <= MAX_APPS; n++) {
      const apps = await resolve(SAMPLE.slice(0, n));
      const r = await render(browser, apps, version, dir, `new-apps-n${n}`);
      console.log(`n${n}: svg ${(r.svg / 1024).toFixed(0)} KB, png ${(r.png / 1024).toFixed(0)} KB`);
    }
  } else {
    const dir = outDir(typeof args.out === "string" ? args.out : "out/release");
    const svg = join(dir, `new-apps-${version}.svg`);
    const png = join(dir, `new-apps-${version}.png`);
    const r = await render(browser, apps, version, dir, `new-apps-${version}`);
    console.log(svg);
    console.log(`${png} (${(r.png / 1024).toFixed(0)} KB)`);
    console.log(r.alt);
  }
  } finally {
    await browser.close();
  }
});
