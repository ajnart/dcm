import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFont } from "./glyphs.mjs";

const reel = join(dirname(fileURLToPath(import.meta.url)), "..");
const fonts = join(reel, "node_modules/@fontsource-variable");
const mono = loadFont(join(fonts, "jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2"));
const sans = loadFont(join(fonts, "inter-tight/files/inter-tight-latin-wght-normal.woff2"));
const catalog = JSON.parse(readFileSync(join(reel, "../../site/src/data/catalog.json"), "utf8"));
const n = (v) => Math.round(v * 100) / 100;

const C = { bg: "#09080f", panel: "#14121e", own: "#1a1530", accent: "#7a57d3", at: "#a88df2", ok: "#00d787", text: "#f5f5f5", muted: "#8a8a8a", was: "#9a96ae", line: "rgba(255,255,255,0.09)" };

// the showreel's SaaS cut (video/reel/hook.js TILES): the service people rent and the Catalog App that replaces it
const PAIRS = [
  ["netflix", "Netflix", "jellyfin"],
  ["spotify", "Spotify", "navidrome"],
  ["google-drive", "Drive", "nextcloud"],
  ["dropbox", "Dropbox", "syncthing"],
  ["google-photos", "Photos", "immich"],
  ["1password", "1Password", "vaultwarden"],
  ["notion", "Notion", "docmost"],
  ["chatgpt", "ChatGPT", "open-webui"],
].map(([was, wasName, id]) => {
  const app = catalog.apps.find((a) => a.id === id);
  if (!app) throw new Error(`${id} is not in the Catalog`);
  return { was, wasName, id, name: app.name, cat: app.c };
});
const MORE = catalog.apps.length - PAIRS.length;
const pairs = (list) => list.map((p) => `${p.wasName} to ${p.name}`).join(", ");

const iconFile = (id) => (id === "docmost" ? ["png", "image/png"] : ["svg", "image/svg+xml"]);
const ON_DARK = { vaultwarden: "vaultwarden-light" };
const iconData = (id) => {
  const [ext, mime] = iconFile(id);
  return `data:${mime};base64,${readFileSync(join(reel, "assets/icons", `${ON_DARK[id] || id}.${ext}`)).toString("base64")}`;
};

// text becomes glyph outlines so the SVG looks the same inside GitHub's <img> sandbox, which loads no fonts
const kit = () => {
  const used = new Map();
  const icons = new Set();
  const adv = (font, s, size) => [...s].reduce((a, ch) => a + font.glyph(ch).advance, 0) * (size / font.upm);
  const text = (s, x, y, size, fill, { bold = false, anchor = "start", font = mono } = {}) => {
    const key = font === mono ? "m" : "s";
    const w = adv(font, s, size);
    const x0 = anchor === "end" ? x - w : anchor === "middle" ? x - w / 2 : x;
    let cx = 0;
    let uses = "";
    for (const ch of s) {
      if (ch !== " ") {
        const k = key + ch;
        if (!used.has(k)) used.set(k, { id: `g${used.size}`, d: font.glyph(ch).d });
        uses += `<use href="#${used.get(k).id}" x="${cx}"/>`;
      }
      cx += font.glyph(ch).advance;
    }
    const weight = bold ? ` stroke="${fill}" stroke-width="${font === mono ? 36 : 28}" stroke-linejoin="round"` : "";
    return `<g transform="translate(${n(x0)} ${n(y)}) scale(${size / font.upm})" fill="${fill}"${weight}>${uses}</g>`;
  };
  const icon = (id, x, y, size) => {
    icons.add(id);
    return `<use href="#i-${id}" transform="translate(${n(x)} ${n(y)}) scale(${size / 100})"/>`;
  };
  const defs = () => [...used.values()].map((g) => `<path id="${g.id}" d="${g.d}"/>`).join("") + [...icons].map((id) => `<image id="i-${id}" width="100" height="100" href="${iconData(id)}"/>`).join("");
  return { text, icon, defs, adv };
};

const frame = ({ w, h, k, css, body, title, desc }) => {
  const r = n((20 * w) / 880);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="880" height="${Math.round((h * 880) / w)}" role="img" aria-labelledby="t d"><title id="t">${title}</title><desc id="d">${desc}</desc><defs>${k.defs()}<clipPath id="c"><rect width="${w}" height="${h}" rx="${r}"/></clipPath><radialGradient id="glow" cx="100%" cy="0%" r="90%"><stop offset="0" stop-color="#2a1d58"/><stop offset="1" stop-color="${C.bg}"/></radialGradient></defs><style>${css}@media (prefers-reduced-motion:reduce){*{animation:none!important}}</style><g clip-path="url(#c)"><rect width="${w}" height="${h}" fill="url(#glow)"/>${body}</g><rect x="${n(w / 1760)}" y="${n(w / 1760)}" width="${n(w - w / 880)}" height="${n(h - w / 880)}" rx="${r}" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="${n(w / 880)}"/></svg>`;
};

const LOOP_S = 10;
const pct = (t) => `${n((t / LOOP_S) * 100)}%`;
const title = "What it replaces";

// one pair per row, one layer per tile: the service loses its colour, the arrow turns purple, the App gains colour, each step easing into the next;
// every pair has its own keyframes so they all wind back together at the end
const START = 0.5, STEP = 0.8, RESET = 9, BACK = 9.4;
const GREY = "grayscale(1) brightness(.6)", COLOUR = "grayscale(0) brightness(1)";
const track = (name, from, to, a, b) => `@keyframes ${name}{0%{${from}}${pct(a)}{${from}}${pct(b)}{${to}}${pct(RESET)}{${to}}${pct(BACK)}{${from}}100%{${from}}}.${name}{animation:${name} ${LOOP_S}s infinite ease-in-out;${to}}`;

function replaces() {
  const k = kit();
  const W = 640, PX = 28, RH = 58, TH = 48, Y0 = 84, H = Y0 + PAIRS.length * RH + 6;
  const SW = 232, GAP = 56, AW = W - PX * 2 - SW - GAP, AX = PX + SW + GAP;
  const dimArrow = "#2c2940", dim = "#6f6b80";
  let body = k.text(title, PX, 52, 38, C.text, { bold: true, font: sans }) + k.text(`+ ${MORE} more`, W - PX, 50, 20, C.muted, { anchor: "end" });
  let css = "";
  PAIRS.forEach((p, i) => {
    const y = Y0 + i * RH, cy = y + TH / 2, s = START + i * STEP;
    const svc = `<rect x="${PX}" y="${y}" width="${SW}" height="${TH}" rx="10" fill="${C.panel}" stroke="${C.line}"/>${k.icon(p.was, PX + 12, y + 8, 32)}${k.text(p.wasName, PX + 54, y + 32, 24, C.text, { font: sans })}`;
    const app = `<rect x="${AX}" y="${y}" width="${AW}" height="${TH}" rx="10" fill="${C.own}" stroke="rgba(122,87,211,.85)"/>${k.icon(p.id, AX + 12, y + 8, 32)}${k.text(p.name, AX + 54, y + 32, 24, C.text, { bold: true, font: sans })}`;
    const bx = PX + SW + GAP / 2;
    const link = `<circle class="c${i}" cx="${bx}" cy="${cy}" r="15"/><path class="w${i}" d="M${bx - 5} ${cy}h10m-4-5l5 5l-5 5" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;
    body += `<g class="v${i}">${svc}</g>${link}<g class="p${i}">${app}</g>`;
    css += track(`v${i}`, `filter:${COLOUR}`, `filter:${GREY}`, s, s + 0.7);
    css += track(`c${i}`, `fill:${dimArrow}`, `fill:${C.accent}`, s + 0.5, s + 1);
    css += track(`w${i}`, `stroke:${dim}`, "stroke:#fff", s + 0.5, s + 1);
    css += track(`p${i}`, `filter:${GREY}`, `filter:${COLOUR}`, s + 0.8, s + 1.5);
  });
  return frame({ w: W, h: H, k, css, body, title, desc: `Paid services paired with the Catalog App that replaces each: ${pairs(PAIRS)}.` });
}

export const REPLACES = [
  { id: "meet", name: "Colour moves from each paid service through the arrow into its App", desc: "eight rows, one pair at a time; the service greys out, the arrow turns purple, the App gains colour", build: replaces },
].map((v) => ({ ...v, alt: `What it replaces: ${pairs(PAIRS)}. Every App is in the Catalog, with ${MORE} more.` }));

export const PAIR_LIST = PAIRS;

export async function buildReplaces({ browser, out, budgets }) {
  const items = [];
  for (const v of REPLACES) {
    const svg = v.build();
    writeFileSync(join(out, `replaces-${v.id}.svg`), svg);
    const [, w, h] = svg.match(/width="(\d+)" height="(\d+)" role/);
    const p = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1.5, reducedMotion: "reduce" });
    await p.setContent(`<!doctype html><style>*{margin:0}html,body{background:transparent}svg{display:block}</style>${svg}`);
    await p.screenshot({ path: join(out, `replaces-${v.id}.png`), omitBackground: true });
    await p.close();
    items.push({ group: "replaces", id: `replaces-${v.id}`, name: v.name, desc: v.desc, alt: v.alt, file: `replaces-${v.id}.svg`, png: `replaces-${v.id}.png`, budget: budgets.svg });
    items.push({ id: `replaces-${v.id}-png`, name: `${v.name} (PNG fallback)`, file: `replaces-${v.id}.png`, budget: budgets.png });
  }
  return items;
}
