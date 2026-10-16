import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFont } from "../readme/glyphs.mjs";

const reel = join(dirname(fileURLToPath(import.meta.url)), "..");
const fonts = join(reel, "node_modules/@fontsource-variable");
const face = (name, wght) => ({ key: `${name}${wght}`.replace(/\W/g, ""), f: loadFont(join(fonts, `${name}/files/${name}-latin-wght-normal.woff2`), { wght }) });
const heading = face("inter-tight", 800);
const mono7 = face("jetbrains-mono", 700);
const mono6 = face("jetbrains-mono", 600);

const C = { bg: "#09080f", panel: "#14121e", edge: "#3a3358", accent: "#7a57d3", at: "#a88df2", ok: "#00d787", muted: "#8a8a8a", bright: "#f5f5f5" };
const n = (v) => Math.round(v * 100) / 100;
const xml = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const markSrc = readFileSync(join(reel, "../../docs/assets/brand/mark/mark-dark.svg"), "utf8");
const markRects = markSrc.match(/<rect [^>]*\/>/g).join("");
const markLights = markSrc.match(/<circle [^>]*\/>/g).map((c) => ({ cx: +c.match(/cx="([\d.]+)"/)[1], cy: +c.match(/cy="([\d.]+)"/)[1] }));

export const MAX_APPS = 6;
const W = 880;
const LOOP = 6;
const PITCH = 78;
const NODE_X = 560;

function kit(h, animate) {
  const glyphs = new Map();
  const images = new Map();
  const sheet = [];
  const names = new Map();
  const pct = (t) => `${Math.round((t / LOOP) * 1e5) / 1e3}%`;

  const kf = (stops, { base = "" } = {}) => {
    if (!animate) return "";
    const body = stops.map(([t, css]) => `${pct(Math.max(0, Math.min(LOOP, t)))}{${css}}`).join("");
    const key = body + base;
    if (!names.has(key)) {
      const name = `k${names.size}`;
      names.set(key, name);
      sheet.push(`@keyframes ${name}{${body}}.${name}{transform-box:fill-box;transform-origin:50% 50%;${base}animation:${name} ${LOOP}s linear infinite}`);
    }
    return names.get(key);
  };
  const g = (cls, body) => (cls ? `<g class="${cls}">${body}</g>` : body);

  const measure = (fc, s, size, ls = 0) => [...s].reduce((a, ch) => a + (fc.f.glyph(ch).advance / fc.f.upm + ls) * size, 0);
  const text = (fc, s, x, y, size, fill, { ls = 0, anchor = "start", maxW } = {}) => {
    if (maxW) size = Math.min(size, (size * maxW) / measure(fc, s, size, ls));
    const k = size / fc.f.upm;
    let cx = 0;
    let uses = "";
    for (const ch of s) {
      const gl = fc.f.glyph(ch);
      if (ch !== " ") {
        const id = `${fc.key}-${ch.codePointAt(0).toString(36)}`;
        glyphs.set(id, gl.d);
        uses += `<use href="#${id}" x="${n(cx)}"/>`;
      }
      cx += gl.advance + ls * fc.f.upm;
    }
    const dx = anchor === "middle" ? -(cx * k) / 2 : anchor === "end" ? -cx * k : 0;
    return `<g transform="translate(${n(x + dx)} ${n(y)}) scale(${Math.round(k * 1e5) / 1e5})" fill="${fill}">${uses}</g>`;
  };
  const icon = (app, x, y, s) => {
    images.set(app.id, app.icon);
    return `<use href="#i-${app.id}" transform="translate(${n(x)} ${n(y)}) scale(${n(s)})"/>`;
  };
  const mark = (x, y, size) =>
    `<svg x="${n(x)}" y="${n(y)}" width="${n(size)}" height="${n(size)}" viewBox="-16 -20 256 256"><use href="#mark"/>${markLights.map((l) => `<circle cx="${l.cx}" cy="${l.cy}" r="4" fill="${C.ok}"/>`).join("")}</svg>`;
  const ring = (cx, cy, r, color, t0) =>
    animate
      ? `<circle class="${kf([[0, "transform:scale(1);stroke-width:0"], [t0 - 0.001, "transform:scale(1);stroke-width:0"], [t0, "transform:scale(1);stroke-width:2.5;animation-timing-function:cubic-bezier(.2,.8,.3,1)"], [t0 + 0.5, "transform:scale(3);stroke-width:0"], [LOOP, "transform:scale(3);stroke-width:0"]], { base: "stroke-width:0;" })}" cx="${n(cx)}" cy="${n(cy)}" r="${r}" fill="none" stroke="${color}"/>`
      : "";
  const reveal = (body, { out, inn, from }) => {
    if (!animate) return body;
    const [o0, o1] = out;
    const [i0, i1] = inn;
    const move = kf([[0, "transform:translate(0px,0px)"], [o0, "transform:translate(0px,0px);animation-timing-function:ease-in"], [o1, `transform:${from}`], [i0 - 0.001, `transform:${from}`], [i0, `transform:${from};animation-timing-function:cubic-bezier(.2,.8,.3,1)`], [i1, "transform:translate(0px,0px)"], [LOOP, "transform:translate(0px,0px)"]]);
    const stops = [[0, "visibility:visible"], [o1, "visibility:hidden"], [i0, "visibility:visible"], [LOOP, "visibility:visible"]];
    const body2 = stops.map(([t, css]) => `${pct(t)}{${css}}`).join("");
    const key = `vis${body2}`;
    if (!names.has(key)) {
      const name = `k${names.size}`;
      names.set(key, name);
      sheet.push(`@keyframes ${name}{${body2}}.${name}{animation:${name} ${LOOP}s step-end infinite}`);
    }
    return g(names.get(key), g(move, body));
  };
  const finish = ({ title, desc, body }) => {
    const defs = [...glyphs].map(([id, d]) => `<path id="${id}" d="${d}"/>`).join("")
      + [...images].map(([id, src]) => `<image id="i-${id}" width="1" height="1" preserveAspectRatio="xMidYMid meet" href="${src}"/>`).join("")
      + `<g id="mark">${markRects}</g>`
      + `<radialGradient id="bg" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(200 ${n(h / 2)}) scale(800 500)"><stop offset="0" stop-color="#241651"/><stop offset=".7" stop-color="${C.bg}"/></radialGradient>`;
    const css = animate && sheet.length ? `<style>${sheet.join("")}@media (prefers-reduced-motion:reduce){*{animation:none!important}}</style>` : "";
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" width="${W}" height="${h}" role="img" aria-labelledby="t d"><title id="t">${xml(title)}</title><desc id="d">${xml(desc)}</desc><defs>${defs}</defs>${css}<rect width="${W}" height="${h}" rx="20" fill="url(#bg)"/>${body}<rect x=".5" y=".5" width="${W - 1}" height="${h - 1}" rx="19.5" fill="none" stroke="rgba(255,255,255,.14)"/></svg>`;
  };
  return { kf, text, measure, icon, mark, ring, reveal, finish };
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const list = (apps) => apps.map((a) => a.name).join(", ");

export function scene({ apps, version, animate }) {
  const N = apps.length;
  const H = Math.max(350, 70 + N * PITCH);
  const { text, measure, icon, mark, ring, reveal, kf, finish } = kit(H, animate);
  let body = "";

  const size = 150;
  const mx = 40;
  const my = H / 2 - size / 2 - 52;
  body += mark(mx, my, size);
  const hubX = mx + ((210 + 16) / 256) * size;
  const hubY = my + ((96 + 20) / 256) * size;
  body += text(mono7, "self-host", 44, my + size + 34, 18, C.muted, { ls: -0.03 });
  body += text(heading, version, 40, my + size + 94, 62, C.bright, { ls: -0.05 });
  body += text(mono6, `+${N} ${N === 1 ? "App" : "Apps"} in the Catalog`, 42, my + size + 124, 15, C.at);

  const y0 = (H - (N - 1) * PITCH) / 2;
  const sx = hubX + 14;
  const sy = hubY;
  apps.forEach((a, i) => {
    const y = y0 + i * PITCH;
    const ex = NODE_X - 14;
    const d = `M${n(sx)} ${n(sy)}C${n(sx + 150)} ${n(sy)} ${n(ex - 150)} ${n(y)} ${n(ex)} ${n(y)}`;
    body += `<path d="${d}" fill="none" stroke="${C.edge}" stroke-width="2" stroke-linecap="round"/>`;
    if (animate) {
      const t0 = 0.4 + i * 0.5;
      const cls = kf([[0, "stroke-dashoffset:6"], [t0, "stroke-dashoffset:6;animation-timing-function:ease-in-out"], [t0 + 1.2, "stroke-dashoffset:-100"], [LOOP, "stroke-dashoffset:-100"]], { base: "stroke-dashoffset:6;" });
      body += `<path class="${cls}" d="${d}" pathLength="100" fill="none" stroke="${C.at}" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="7 100"/>`;
      body += ring(ex, y, 4.5, C.ok, t0 + 1.2);
    }
    body += `<circle cx="${n(ex)}" cy="${n(y)}" r="4.5" fill="${C.ok}"/>`;
    let node = `<rect x="${NODE_X}" y="${n(y - 30)}" width="60" height="60" rx="16" fill="${C.panel}" stroke="${C.edge}"/>`;
    node += icon(a, NODE_X + 9, y - 21, 42);
    node += text(heading, a.name, NODE_X + 78, y - 2, 25, C.bright, { ls: -0.025, maxW: W - NODE_X - 78 - 40 });
    const cw = measure(mono6, a.category, 11) + 16;
    node += `<rect x="${NODE_X + 78}" y="${n(y + 7)}" width="${n(cw)}" height="20" rx="10" fill="none" stroke="${C.accent}"/>${text(mono6, a.category, NODE_X + 78 + cw / 2, y + 21, 11, C.at, { anchor: "middle" })}`;
    body += reveal(node, { out: [4.7 + i * 0.04, 4.95 + i * 0.04], inn: [5.15 + i * 0.1, 5.5 + i * 0.1], from: "translate(40px,0px)" });
  });
  body += ring(hubX, hubY, 4, C.ok, 0.4);

  return {
    w: W,
    h: H,
    alt: `self-host ${version} adds ${plural(N, "App", "Apps")}: ${list(apps)}, each connected to the self-host Logo.`,
    svg: finish({ title: `self-host ${version}: ${plural(N, "new App", "new Apps")}`, desc: `The Logo sends a pulse to ${list(apps)}.`, body }),
  };
}
