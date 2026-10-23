import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFont } from "./glyphs.mjs";

const file = fileURLToPath(import.meta.url);
const reel = join(dirname(file), "..");
const root = join(reel, "../..");
const fonts = join(reel, "node_modules/@fontsource-variable");
const face = (name, wght) => loadFont(join(fonts, `${name}/files/${name}-latin-wght-normal.woff2`), { wght });
const head = face("inter-tight", 800);
const mono = face("jetbrains-mono", 600);
const C = { bg: "#09080f", bright: "#f5f5f5", accent: "#a88df2", muted: "#b1acbf", line: "rgba(255,255,255,.14)" };
const n = (value) => Math.round(value * 100) / 100;

export const SIZE = { w: 880, h: 220 };
export const ALT = "With an agent. One self-host skill for Claude Code, Codex, OpenCode, Pi, Hermes Agent and OpenClaw. The skill loads the guide through self-host skill.";
const AGENTS = [
  { id: "claude-code", name: "Claude Code" },
  { id: "openai", name: "Codex" },
  { id: "opencode", name: "OpenCode" },
  { id: "pi", name: "Pi" },
  { id: "hermes-agent", name: "Hermes Agent" },
  { id: "openclaw", name: "OpenClaw" },
];

// As in the other README sections, text is glyph outlines and source marks are
// embedded, so GitHub's image sandbox needs neither fonts nor external files.
export function agents() {
  const glyphs = new Map();
  const text = (font, key, value, x, y, size, fill, options = {}) => {
    const scale = size / font.upm;
    const spacing = (options.spacing || 0) * font.upm;
    let advance = 0;
    let uses = "";
    for (const ch of value) {
      const glyph = font.glyph(ch);
      if (ch !== " ") {
        const id = `${key}-${ch.codePointAt(0).toString(36)}`;
        glyphs.set(id, glyph.d);
        uses += `<use href="#${id}" x="${n(advance)}"/>`;
      }
      advance += glyph.advance + spacing;
    }
    let start = x;
    if (options.center) start -= advance * scale / 2;
    return `<g transform="translate(${n(start)} ${y}) scale(${scale})" fill="${fill}">${uses}</g>`;
  };
  const embedded = (path) => `data:image/svg+xml;base64,${readFileSync(path).toString("base64")}`;
  const marks = AGENTS.map(({ id }) => `<image id="agent-${id}" href="${embedded(join(reel, "assets/agents", `${id}.svg`))}" width="1" height="1" preserveAspectRatio="xMidYMid meet"/>`).join("");
  const logo = embedded(join(root, "site/public/logo.svg"));
  let body = text(head, "h", "With an agent", 34, 64, 44, C.bright, { spacing: -0.04 });
  body += text(mono, "m", "One skill. Your choice of agent.", 36, 94, 14, C.muted);
  body += text(mono, "m", "self-host skill", 650, 67, 16, C.accent, { center: true });
  body += `<image href="${logo}" x="771" y="27" width="66" height="62"/>`;
  body += `<path d="M36 114H844" fill="none" stroke="${C.line}"/>`;
  for (const [index, agent] of AGENTS.entries()) {
    const x = 100 + index * 136;
    body += `<use href="#agent-${agent.id}" transform="translate(${x - 18} 134) scale(36)"/>`;
    body += text(mono, "m", agent.name, x, 195, 13, C.bright, { center: true });
  }
  const defs = [...glyphs].map(([id, d]) => `<path id="${id}" d="${d}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE.w} ${SIZE.h}" width="${SIZE.w}" height="${SIZE.h}" role="img" aria-labelledby="t d"><title id="t">With an agent</title><desc id="d">${ALT} Product marks identify agents, not endorsements.</desc><defs>${defs}${marks}</defs><rect x=".5" y=".5" width="879" height="219" fill="${C.bg}" stroke="${C.line}"/>${body}</svg>`;
}

export async function buildAgents({ browser, out }) {
  mkdirSync(out, { recursive: true });
  const svg = agents();
  const svgFile = "with-an-agent.svg";
  const pngFile = "with-an-agent.png";
  writeFileSync(join(out, svgFile), svg);
  const page = await browser.newPage({ viewport: { width: SIZE.w, height: SIZE.h }, deviceScaleFactor: 2 });
  try {
    await page.setContent(`<!doctype html><style>*{margin:0}html,body{background:transparent}svg{display:block}</style>${svg}`);
    await page.screenshot({ path: join(out, pngFile), omitBackground: true });
  } finally {
    await page.close();
  }
  const files = [svgFile, pngFile].map((name) => ({ id: name, name: "Section image: With an agent", file: name, budget: 400 * 1024, bytes: statSync(join(out, name)).size }));
  const over = files.filter((entry) => entry.bytes > entry.budget);
  if (over.length) throw new Error(`over budget: ${over.map((entry) => entry.file).join(", ")}`);
  return files;
}

// A focused entry point: render this section without touching any existing
// README image or generated gallery metadata.
if (process.argv[1] && resolve(process.argv[1]) === file) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
  try {
    const files = await buildAgents({ browser, out: join(root, "docs/assets/readme") });
    for (const entry of files) console.log(`${entry.file}: ${entry.bytes} bytes`);
  } finally {
    await browser.close();
  }
}
