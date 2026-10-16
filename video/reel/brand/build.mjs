import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { animated } from "./animate.mjs";
import { markDoc } from "./shapes.mjs";
import { INK_BOX, MARKS, root } from "./source.mjs";

const out = join(root, "docs/assets/brand");
const ANIMATED_BUDGET = 50 * 1024;
const files = new Map();
const assets = [];

const put = (rel, data) => {
  files.set(rel, data);
  return rel;
};

const dims = (svg) => {
  const m = svg.match(/<svg[^>]*? width="([\d.]+)" height="([\d.]+)"/);
  return [+m[1], +m[2]];
};

const asset = (id, group, label, note, theme, svg, svgPath, pngs = []) => ({ id, group, label, note, theme, svgPath, svg, pngs });

const MARK_PNG = [512, 256, 128];

const list = [];

for (const [id, m] of Object.entries(MARKS)) {
  const svg = markDoc(m.model);
  put(`mark/mark-${id}.svg`, svg);
  list.push(asset(`mark-${id}`, "Mark", m.label, m.note, id === "dark" ? "dark" : id === "light" || id === "mono" ? "light" : id === "mono-white" ? "dark" : "any", svg, `mark/mark-${id}.svg`, MARK_PNG.map((h) => ({ rel: `mark/mark-${id}-${h}.png`, h }))));
}

const NOTES = { build: "the mark draws itself, then retracts", "light-up": "unlit containers light up bottom to top", pulse: "the status lights go waiting, starting, running" };
const ANIM = {};
for (const theme of ["dark", "light"]) {
  for (const [id, svg] of Object.entries(animated(theme))) {
    const rel = `animated/${id}-${theme}.svg`;
    put(rel, svg);
    ANIM[rel] = svg;
    list.push(asset(`animated-${id}-${theme}`, "Animated", `${id}, ${theme}`, `${NOTES[id]}; for ${theme} backgrounds`, theme, svg, rel));
  }
}

const DI = [
  ["self-host", MARKS.color, "any"],
  ["self-host-light", MARKS.dark, "dark"],
  ["self-host-dark", MARKS.light, "light"],
];
const DI_NOTE = { "self-host": "colour, works on both", "self-host-light": "light artwork, for dark backgrounds", "self-host-dark": "dark artwork, for light backgrounds" };
for (const [name, m, theme] of DI) {
  const svg = markDoc(m.model, INK_BOX);
  put(`dashboard-icons/svg/${name}.svg`, svg);
  list.push(asset(`di-${name}`, "Dashboard Icons", name, DI_NOTE[name], theme, svg, `dashboard-icons/svg/${name}.svg`, [{ rel: `dashboard-icons/png/${name}.png`, h: 512 }, { rel: `dashboard-icons/webp/${name}.webp`, h: 512, webp: true }]));
}
put(
  "dashboard-icons/meta/self-host.json",
  `${JSON.stringify(
    {
      base: "svg",
      aliases: ["selfhost", "self-hosted", "selfhost-cli"],
      categories: ["tools", "cloud"],
      update: { timestamp: "2026-10-16T00:00:00Z", author: { id: 49837342, login: "ajnart" } },
      colors: { dark: "self-host-dark", light: "self-host-light" },
    },
    null,
    2,
  )}\n`,
);

for (const rel of Object.keys(ANIM)) {
  const bytes = Buffer.byteLength(ANIM[rel]);
  if (bytes > ANIMATED_BUDGET) {
    console.error(`${rel} is ${bytes} bytes, over the ${ANIMATED_BUDGET} budget`);
    process.exit(1);
  }
}

rmSync(out, { recursive: true, force: true });
for (const [rel, data] of files) {
  mkdirSync(dirname(join(out, rel)), { recursive: true });
  writeFileSync(join(out, rel), data);
}

const sized = (svg, w, h) => svg.replace(/(<svg[^>]*?) width="[\d.]+" height="[\d.]+"/, `$1 width="${w}" height="${h}"`);

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const raster = async (svg, w, h, rel) => {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${sized(svg, w, h)}`);
  mkdirSync(dirname(join(out, rel)), { recursive: true });
  await page.screenshot({ path: join(out, rel), omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
};

for (const a of list) {
  const [sw, sh] = dims(a.svg);
  for (const p of a.pngs) {
    const h = p.h ?? Math.round((p.w * sh) / sw);
    const w = p.w ?? Math.round((p.h * sw) / sh);
    p.w = w;
    p.h = h;
    if (p.webp) {
      const png = p.rel.replace("/webp/", "/png/").replace(/\.webp$/, ".png");
      mkdirSync(dirname(join(out, p.rel)), { recursive: true });
      execFileSync("cwebp", ["-quiet", "-lossless", "-exact", "-z", "9", join(out, png), "-o", join(out, p.rel)]);
      continue;
    }
    await raster(a.svg, w, h, p.rel);
  }
}
await browser.close();

const size = (rel) => statSync(join(out, rel)).size;
const manifest = {
  assets: list.map((a) => ({
    id: a.id,
    group: a.group,
    label: a.label,
    note: a.note,
    theme: a.theme,
    files: [{ path: a.svgPath, bytes: size(a.svgPath), width: dims(a.svg)[0], height: dims(a.svg)[1] }, ...a.pngs.map((p) => ({ path: p.rel, bytes: size(p.rel), width: p.w, height: p.h }))],
  })),
  extra: [{ path: "dashboard-icons/meta/self-host.json", bytes: size("dashboard-icons/meta/self-host.json") }],
};
writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const all = walk(out).map((f) => relative(out, f)).sort();
console.log(`${all.length} files in docs/assets/brand`);
for (const rel of all.filter((f) => f.startsWith("animated/"))) console.log(`${rel}  ${(size(rel) / 1024).toFixed(1)} KB`);
