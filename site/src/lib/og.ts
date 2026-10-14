import sharp from "sharp";
import logo from "../../public/logo.svg?raw";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export type Card = { slug: string; kicker: string; title: string; subtitle: string; icon?: string; letter?: string };

const FONT = "JetBrains Mono, SF Mono, Menlo, DejaVu Sans Mono, monospace";
const COLORS = { bg: "#1e1d2a", deep: "#171621", panel: "#23222f", line: "#3a3947", ink: "#e4e4ea", muted: "#8a8a96", accent: "#7a57d3", accentText: "#a88df2", info: "#5fafff" };

export const pageSlug = (pathname: string): string => pathname.replace(/\.html$/, "").replace(/^\/+|\/+$/g, "") || "index";

export const ogPath = (pathname: string): string => `/og/${pageSlug(pathname)}.png`;

const escape = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function wrap(text: string, width: number, lines: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= width) {
      line = next;
      continue;
    }
    if (line) out.push(line);
    line = word.length > width ? `${word.slice(0, width - 1)}…` : word;
  }
  if (line) out.push(line);
  if (out.length <= lines) return out;
  const kept = out.slice(0, lines);
  kept[lines - 1] = `${kept[lines - 1].slice(0, width - 1).replace(/\s+\S*$/, "")}…`;
  return kept;
}

const logoShapes = logo
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => /^<(rect|circle)\b/.test(line))
  .join("");

const ICON = 112;

let offline = false;

async function iconImage(url: string): Promise<Buffer | undefined> {
  if (offline) return undefined;
  let body: Buffer;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return undefined;
    body = Buffer.from(await res.arrayBuffer());
  } catch {
    offline = true;
    return undefined;
  }
  try {
    return await sharp(body, { density: 300 }).resize(ICON, ICON, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  } catch {
    return undefined;
  }
}

export async function renderCard(card: Card): Promise<Buffer> {
  const withIcon = card.icon !== undefined || card.letter !== undefined;
  const titleX = withIcon ? 80 + ICON + 32 : 80;
  const titleLines = wrap(card.title, withIcon ? 16 : 20, withIcon ? 2 : 3);
  const titleTop = withIcon ? 228 : 236;
  const titleSize = 64;
  const titleStep = 78;
  const subTop = titleTop + titleLines.length * titleStep + 10;
  const subLines = wrap(card.subtitle, 46, 3);
  const url = `self-host.fyi${card.slug === "index" ? "" : `/${card.slug}`}`;
  const text = (x: number, y: number, size: number, fill: string, body: string, weight = 400) =>
    `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}">${escape(body)}</text>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  <defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="${COLORS.deep}" stroke-width="2"/></pattern></defs>
  <rect width="100%" height="100%" fill="${COLORS.bg}"/>
  <rect width="100%" height="100%" fill="url(#grid)"/>
  <rect x="0" y="0" width="${OG_WIDTH}" height="8" fill="${COLORS.accent}"/>
  <rect x="80" y="84" width="236" height="48" fill="${COLORS.accent}"/>
  ${text(96, 118, 30, "#f5f5f5", "◆ self-host", 800)}
  ${text(340, 118, 30, COLORS.muted, card.kicker)}
  ${card.letter !== undefined ? `<rect x="80" y="${titleTop - 72}" width="${ICON}" height="${ICON}" fill="${COLORS.panel}" stroke="${COLORS.line}" stroke-width="2"/>${text(80 + ICON / 2 - 22, titleTop + 4, 72, COLORS.accentText, card.letter, 800)}` : ""}
  ${titleLines.map((line, i) => text(titleX, titleTop + i * titleStep, titleSize, COLORS.ink, line, 800)).join("")}
  ${subLines.map((line, i) => text(80, subTop + 40 + i * 44, 30, COLORS.muted, line)).join("")}
  ${text(80, 560, 28, COLORS.info, url)}
  <g transform="translate(905 330) scale(1.05)">${logoShapes}</g>
</svg>`;

  const base = sharp(Buffer.from(svg));
  const icon = card.icon ? await iconImage(card.icon) : undefined;
  if (card.icon && !icon) return renderCard({ ...card, icon: undefined, letter: card.title[0] });
  if (!icon) return base.png().toBuffer();
  return base.composite([{ input: icon, left: 80, top: titleTop - 72 - 8 }]).png().toBuffer();
}
