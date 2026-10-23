import { chromium } from "playwright";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { dashboard, FRAME } from "./scene.mjs";
import { buildReplaces } from "./section-replaces.mjs";
import { buildSetup } from "./section-setup.mjs";
import { buildAgents } from "./section-agents.mjs";
import { command, lockup, SIZES, swaps } from "./hero.mjs";
import { SCENES as LINKS_SCENES } from "./section-links.mjs";
const dir = dirname(fileURLToPath(import.meta.url));
const root = join(dir, "../../..");
const out = join(root, "docs/assets/readme");
const font = (f) => `../node_modules/@fontsource-variable/${f}`;
const W = 880, H = 440;
const HERO = 600 * 1024, LOOPBUDGET = 1536 * 1024, HEROSVG = 400 * 1024, LINKS = 400 * 1024;
const apps = JSON.parse(readFileSync(join(root, "site/src/data/catalog.json"), "utf8")).apps.length;
const base = `
@font-face{font-family:"Inter Tight";src:url(${font("inter-tight/files/inter-tight-latin-wght-normal.woff2")});font-weight:100 900}
@font-face{font-family:"JetBrains Mono";src:url(${font("jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2")});font-weight:100 800}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:transparent;color:#f5f5f5;font-family:"Inter Tight",sans-serif;-webkit-font-smoothing:antialiased}
:root{--a:#7a57d3;--at:#a88df2;--ok:#00d787;--fail:#ff5f5f;--mono:"JetBrains Mono",monospace}
.card{position:absolute;inset:0;border-radius:20px;overflow:hidden;background:#09080f}
.card:after{content:"";position:absolute;inset:0;border-radius:20px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);pointer-events:none}
`;
const logo = `<img src="../../../site/public/logo.svg">`;
const ic = (n) => `<img src="../assets/icons/${n}.${n === "docmost" ? "png" : "svg"}">`;
const curl = `<i>$</i> curl -fsSL self-host.fyi/install | bash`;
const win = (w, opts) => `<div class="win" style="width:${w}px">${dashboard(opts).replace(/ width="\d+" height="\d+"/, ' width="100%"')}</div>`;

const V = [
  { id: "lockup", name: "Lockup: headline, $92 to $0, curl, big logo", alt: "Stop renting your software. $92 a month becomes $0. Install with one curl command. The self-host Logo: four containers with their status lights.",
    desc: "the shipped share card's composition, refined for README width", scene: lockup },
  { id: "swaps", name: "Swaps: rented SaaS crossed out, Apps you own", alt: "Stop renting your software. Eight subscriptions, Netflix, Spotify, Drive, Dropbox, Photos, 1Password, Notion and ChatGPT, totalling $92 a month, replaced by Apps you own at $0: Jellyfin, Navidrome, Nextcloud, Syncthing, Immich, Vaultwarden, Docmost and Open WebUI.",
    desc: "eight subscriptions struck through, each swapped for an App at $0", scene: swaps },
  { id: "command", name: "One command: curl line, Apps fan out", alt: "Stop renting your software. One command, curl -fsSL self-host.fyi/install | bash, and Apps fan out from it: Jellyfin, Sonarr, Radarr, Immich, Nextcloud, Homarr, Vaultwarden, Navidrome and Home Assistant.",
    desc: "the install line huge, nine Apps branching out of it", scene: command },
];

const kb = (f) => statSync(f).size;
const shot = async (b, file, html, name, scale = 2) => {
  writeFileSync(join(dir, `${name}.html`), `<!doctype html><meta charset=utf-8><style>${base}</style>${html}`);
  const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: scale });
  await p.goto("file://" + join(dir, `${name}.html`));
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: file, omitBackground: true });
  await p.close();
};

mkdirSync(out, { recursive: true });
const b = await chromium.launch();
const meta = [];
for (const [i, v] of V.entries()) {
  if (!v.scene) {
    const file = `hero-${v.id}.png`;
    await shot(b, join(out, file), `<style>${v.css}</style><div class="card">${v.html}</div>`, `v${i + 1}-${v.id}`);
    meta.push({ n: i + 1, id: v.id, name: v.name, desc: v.desc, alt: v.alt, files: [{ file, kind: "png", budget: HERO }] });
    continue;
  }
  const png = `hero-${v.id}.png`, svg = `hero-${v.id}.svg`, size = SIZES[v.id];
  const still = await b.newPage({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 2 });
  await still.setContent(`<!doctype html><style>*{margin:0}html,body{background:transparent}svg{display:block}</style>${v.scene({ animate: false })}`);
  await still.screenshot({ path: join(out, png), omitBackground: true });
  await still.close();
  const animated = v.scene({ animate: true });
  writeFileSync(join(out, svg), animated);
  meta.push({ n: i + 1, id: v.id, name: v.name, desc: v.desc, alt: v.alt, files: [{ file: svg, kind: "svg", budget: HEROSVG }, { file: png, kind: "png", budget: HERO }] });
}

writeFileSync(join(out, "status-lights.svg"), dashboard({ animate: true, frame: true }));
meta.push({ n: V.length + 1, id: "current", current: true, name: "Current: what README.md shows today", desc: "the Logo, title, links and social card as they are now; for comparing against the heroes in the header mock", alt: "self-host: Your Apps. Your home. One binary. Watch the showreel.", files: [{ file: "../social-card.png", kind: "png", budget: null }] });

const extras = [
  { id: "status-lights.svg", name: "Section image: status lights come up (animated SVG, 6 s loop)", file: "status-lights.svg", budget: LOOPBUDGET },
];
const sp = await b.newPage({ viewport: { width: FRAME.w, height: FRAME.h }, deviceScaleFactor: 2 });
await sp.setContent(`<!doctype html><style>*{margin:0}html,body{background:transparent}svg{display:block}</style>${dashboard({ frame: true })}`);
await sp.screenshot({ path: join(out, "section-dashboard.png"), omitBackground: true });
await sp.close();
extras.push({ id: "section-dashboard", name: "Section image: the Dashboard Overview", file: "section-dashboard.png", budget: HERO });
extras.push(...(await buildReplaces({ browser: b, out, budgets: { svg: 400 * 1024, png: 400 * 1024 } })));
await buildSetup(b, out, kb);
extras.push(...(await buildAgents({ browser: b, out })));
const linksOut = [];
for (const s of LINKS_SCENES) {
  const svg = s.build(true), still = s.build(false);
  writeFileSync(join(out, `links-${s.id}.svg`), svg);
  const w = Number(svg.match(/width="(\d+)"/)[1]), h = Number(svg.match(/height="(\d+)"/)[1]);
  const lp = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await lp.setContent(`<!doctype html><style>*{margin:0}html,body{background:transparent}svg{display:block}</style>${still}`);
  await lp.screenshot({ path: join(out, `links-${s.id}.png`), omitBackground: true });
  await lp.close();
  linksOut.push({ id: s.id, name: s.name, desc: s.desc, alt: s.alt, w, h, files: [{ file: `links-${s.id}.svg`, kind: "svg", budget: LINKS }, { file: `links-${s.id}.png`, kind: "png", budget: LINKS }] });
}
await b.close();

for (const m of meta) for (const f of m.files) f.bytes = kb(join(out, f.file));
for (const e of extras) e.bytes = kb(join(out, e.file));
for (const m of linksOut) for (const f of m.files) f.bytes = kb(join(out, f.file));
writeFileSync(join(dir, "section-links.json"), JSON.stringify({ variants: linksOut }, null, 1));
writeFileSync(join(dir, "variants.json"), JSON.stringify({ apps, variants: meta, extras }, null, 1));

const over = [...meta.flatMap((m) => m.files), ...linksOut.flatMap((m) => m.files), ...extras].filter((f) => f.budget && f.bytes > f.budget);
for (const m of meta) console.log(`${m.n} ${m.id}: ${m.files.map((f) => `${f.file} ${(f.bytes / 1024).toFixed(0)} KB`).join(", ")}`);
for (const e of extras) console.log(`${e.file} ${(e.bytes / 1024).toFixed(0)} KB`);
for (const m of linksOut) console.log(`links ${m.id}: ${m.files.map((f) => `${f.file} ${(f.bytes / 1024).toFixed(0)} KB`).join(", ")}`);
if (over.length) {
  console.error(`over budget: ${over.map((f) => f.file).join(", ")}`);
  process.exit(1);
}
