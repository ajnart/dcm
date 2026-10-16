import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { P, Doc, term, scenes, TM, LOOP, PHASES, WINW, WINH, n } from "./setup-engine.mjs";

const dir = dirname(fileURLToPath(import.meta.url));
const SVG_BUDGET = 400 * 1024;
const PNG_BUDGET = 600 * 1024;
const ORDER = ["install", "welcome", "what", "where", "access", "who", "look", "review"];
const TITLE = "Setting up self-host in 30 seconds";
const SHELL = "rgba(255,255,255,0.14)";

const card = (w, h) => `<rect width="${w}" height="${h}" rx="20" fill="${P.bg}"/>`;
const rim = (w, h) => `<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="19.5" fill="none" stroke="${SHELL}"/>`;

function story(d, T) {
  return ORDER.map((k) => d.g([TM[k]], scenes[k](d, T))).join("") + d.g([[TM.dash[0], LOOP]], scenes.dash(d, T), 1);
}

const CHIPS = ["Install", "Onboarding", "Approve", "Running"];

function strip(d, x0, y0, w) {
  const gap = 16;
  const cw = (w - gap * 3) / 4;
  let out = "";
  CHIPS.forEach((label, i) => {
    const x = x0 + i * (cw + gap);
    const [a, b] = PHASES[i];
    const frame = (stroke) => `<rect x="${n(x + 0.5)}" y="${y0 + 0.5}" width="${n(cw - 1)}" height="29" rx="6" fill="${P.panel}" stroke="${stroke}"/>`;
    const mark = (glyph, color, text, tcolor, bold) => d.text(glyph, x + 14, y0 + 20, 14, color) + d.text(`${i + 1} ${text}`, x + 36, y0 + 20, 14, tcolor, bold);
    out += frame("rgba(255,255,255,0.1)");
    out += d.g([[0, a]], mark("○", P.f, label, P.m), 0);
    out += d.g([[a, b]], frame(P.acc) + mark("●", P.at, label, P.b, true), 0);
    out += d.g([[b, LOOP]], mark("✓", P.ok, label, P.t), 1);
  });
  return out;
}

function terminalVariant() {
  const W = 880;
  const H = 58 + WINH + 14;
  const d = new Doc(LOOP);
  const T = term(d, 20, 58);
  const body = strip(d, 20, 14, WINW) + T.chrome() + story(d, T);
  return { w: W, h: H, svg: d.svg(W, H, card(W, H) + body + rim(W, H), TITLE, ALTS.terminal) };
}

const ALTS = {
  terminal: "A terminal window plays the whole setup. It installs with curl -fsSL https://self-host.fyi/install | bash, answers Onboarding one question at a time (Welcome, What, Where, Access, Who, Look), shows the Review plan and presses enter to approve, then lands on the Dashboard Overview with Homarr, Jellyfin, Prowlarr, qBittorrent, Radarr, Seerr and Sonarr running. A strip of four steps above it ticks off as it goes.",
};

const VARIANTS = [
  { id: "setup-terminal", name: "Terminal: a faithful window with a step strip", desc: "the real screens in a 104-column terminal, with Install, Onboarding, Approve and Running ticking off above it", build: terminalVariant, alt: ALTS.terminal },
];

export async function buildSetup(b, out, size) {
  const meta = [];
  for (const v of VARIANTS) {
    const { svg, w, h } = await v.build();
    const svgFile = `${v.id}.svg`;
    const pngFile = `${v.id}.png`;
    writeFileSync(join(out, svgFile), svg);
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await p.emulateMedia({ reducedMotion: "reduce" });
    await p.setContent(`<!doctype html><style>*{margin:0}html,body{background:transparent}svg{display:block}</style>${svg}`);
    await p.screenshot({ path: join(out, pngFile), omitBackground: true });
    await p.close();
    meta.push({ id: v.id, name: v.name, desc: v.desc, alt: v.alt, w, h, files: [{ file: svgFile, kind: "svg", budget: SVG_BUDGET, bytes: size(join(out, svgFile)) }, { file: pngFile, kind: "png", budget: PNG_BUDGET, bytes: size(join(out, pngFile)) }] });
  }
  writeFileSync(join(dir, "section-setup.json"), JSON.stringify({ variants: meta }, null, 1));
  const over = meta.flatMap((m) => m.files).filter((f) => f.bytes > f.budget);
  for (const m of meta) console.log(`${m.id}: ${m.files.map((f) => `${f.file} ${(f.bytes / 1024).toFixed(0)} KB`).join(", ")}`);
  if (over.length) {
    console.error(`over budget: ${over.map((f) => f.file).join(", ")}`);
    process.exitCode = 1;
  }
}
