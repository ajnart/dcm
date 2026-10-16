import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFont } from "./glyphs.mjs";

const reel = join(dirname(fileURLToPath(import.meta.url)), "..");
const mono = loadFont(join(reel, "node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2"));
const C = { bg: "#09080f", win: "#0d0b14", panel: "#14121e", line: "rgba(255,255,255,0.1)", accent: "#7a57d3", at: "#a88df2", ok: "#00d787", warn: "#ffaf00", text: "#d0d0d0", muted: "#8a8a8a", faint: "#444", bright: "#f5f5f5" };
const icon = (id) => `data:image/svg+xml;base64,${readFileSync(join(reel, "assets/icons", `${id}.svg`)).toString("base64")}`;
const n = (v) => Math.round(v * 100) / 100;

export const LOOP = 6;
export const WIN = { w: 840, h: 430 };
export const FRAME = { w: 880, h: 470, pad: 20 };
const APPS = [
  ["jellyfin", "Jellyfin", 8096, "Media server"],
  ["sonarr", "Sonarr", 8989, "TV shows"],
  ["radarr", "Radarr", 7878, "Movies"],
  ["prowlarr", "Prowlarr", 9696, "Indexers"],
  ["qbittorrent", "qBittorrent", 8080, "Downloads"],
  ["homarr", "Homarr", 7575, "Home board"],
];
const START = (i) => 0.6 + i * 0.55;
const READY = (i) => START(i) + 0.5;
const ALL = READY(APPS.length - 1) + 0.05;
const HOLD = 5.5;
const GONE = 5.9;

// the Dashboard's Overview as one SVG whose text is glyph paths from the bundled JetBrains Mono, so it
// renders the same in GitHub's <img> sandbox, where no font loads; animate adds the CSS keyframes
export function dashboard({ animate = false, frame = false, crop } = {}) {
  const used = new Map();
  const sheet = [];
  const cell = (s) => (mono.glyph("a").advance * s) / mono.upm;
  const text = (s, x, y, size, fill, bold) => {
    const k = size / mono.upm;
    let cx = 0;
    let uses = "";
    for (const ch of s) {
      if (ch !== " ") {
        if (!used.has(ch)) used.set(ch, `g${used.size}`);
        uses += `<use href="#${used.get(ch)}" x="${cx}"/>`;
      }
      cx += mono.glyph(ch).advance;
    }
    return `<g transform="translate(${n(x)} ${n(y)}) scale(${k})" fill="${fill}"${bold ? ` stroke="${fill}" stroke-width="40" stroke-linejoin="round"` : ""}>${uses}</g>`;
  };
  const len = (segs, s) => segs.reduce((a, [t]) => a + [...t].length, 0) * cell(s);
  const run = (segs, x, y, s = 13) => {
    let cx = x;
    let out = "";
    for (const [t, f, b] of segs) {
      out += text(t, cx, y, s, f, b);
      cx += [...t].length * cell(s);
    }
    return out;
  };
  const runR = (segs, xr, y, s = 13) => run(segs, xr - len(segs, s), y, s);
  const dot = (cx, cy, r, fill) => `<circle cx="${n(cx)}" cy="${n(cy)}" r="${r}" fill="${fill}"/>`;
  const diamond = (cx, cy, r) => `<path d="M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}Z" fill="${C.accent}"/>`;
  const check = (x, y) => `<path d="M${x} ${y - 4}l3 3l6-7.5" fill="none" stroke="${C.ok}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  const anim = (cls, stops) => {
    const pct = (t) => `${Math.round((t / LOOP) * 1e5) / 1e3}%`;
    sheet.push(`@keyframes ${cls}{${stops.map(([t, css]) => `${pct(t)}{${css}}`).join("")}}.${cls}{animation:${cls} ${LOOP}s linear infinite}`);
    return cls;
  };
  const vis = (cls, spans) => {
    const stops = [];
    const put = (t, o) => stops.push([t, `opacity:${o}`]);
    if (spans[0][0] > 0) put(0, 0);
    for (const [a, b, fade = 0.001] of spans) {
      if (a > 0) put(a - 0.001, 0);
      put(a, 1);
      put(b, 1);
      if (b < LOOP) put(b + fade, 0);
    }
    if (spans[spans.length - 1][1] < LOOP) put(LOOP, 0);
    return anim(cls, stops);
  };

  const parts = [];
  parts.push(`<rect width="${WIN.w}" height="${WIN.h}" rx="8" fill="${C.win}" stroke="rgba(255,255,255,0.12)"/>`);
  parts.push(`<path d="M0 30V8a8 8 0 0 1 8-8h${WIN.w - 16}a8 8 0 0 1 8 8v22z" fill="${C.panel}"/><path d="M0 30.5h${WIN.w}" stroke="${C.line}"/>`);
  [14, 28, 42].forEach((x) => parts.push(`<rect x="${x}" y="11" width="8" height="8" rx="1.5" fill="#3a3646"/>`));
  parts.push(run([["self-host", C.muted]], WIN.w / 2 - len([["self-host"]], 11) / 2, 24, 11));

  parts.push(diamond(26, 52, 5));
  parts.push(run([["homelab", C.bright, true]], 38, 57, 14));
  parts.push(run([["~/.self-host", C.muted]], 38 + 9 * cell(14), 57, 14));
  const hr = [["LAN ", C.muted], ["192.168.1.20", C.text], ["  · ", C.muted], ["  ok", C.text], ["  ·  ", C.muted], ["14:32", C.text]];
  const hx = WIN.w - 24 - len(hr, 13);
  parts.push(run(hr, hx, 57));
  parts.push(dot(hx + len(hr.slice(0, 3), 13) + cell(13) / 2, 52.5, 4, C.ok));

  const tabs = ["Overview", "Apps", "Activity", "Catalog", "Settings"];
  let tx = 24;
  tabs.forEach((t, i) => {
    const segs = [[`${i + 1} `, C.faint], [t, i === 0 ? C.at : C.muted, i === 0]];
    parts.push(run(segs, tx, 88));
    if (i === 0) parts.push(`<rect x="${tx}" y="94" width="${n(len(segs, 13))}" height="2" fill="${C.accent}"/>`);
    tx += len(segs, 13) + 4 * cell(13);
  });
  parts.push(`<path d="M0 96.5h${WIN.w}" stroke="${C.line}"/>`);

  const box = (y, h, title, count) => {
    const tw = len([[title]], 13) + 2 * cell(13);
    return `<rect x="18" y="${y}" width="${WIN.w - 36}" height="${h}" rx="3" fill="none" stroke="rgba(168,141,242,0.38)" stroke-width="1.2"/><rect x="30" y="${y - 9}" width="${n(tw)}" height="18" fill="${C.win}"/>${text(title, 30 + cell(13), y + 4, 13, C.bright, true)}${count ? `<rect x="${n(WIN.w - 30 - len([[count]], 13) - 2 * cell(13))}" y="${y - 9}" width="${n(len([[count]], 13) + 2 * cell(13))}" height="18" fill="${C.win}"/>${text(count, WIN.w - 30 - len([[count]], 13) - cell(13), y + 4, 13, C.muted)}` : ""}`;
  };
  parts.push(box(118, 190, "Apps", "6 installed"));
  APPS.forEach(([id, name, port, what], i) => {
    const y = 148 + i * 27;
    const cy = y - 4.5;
    parts.push(`<image href="${icon(id)}" x="56" y="${y - 14.5}" width="18" height="18"/>`);
    parts.push(text(name, 84, y, 13, C.text));
    parts.push(text(`http://192.168.1.20:${port}`, 230, y, 13, C.muted));
    parts.push(text(what, 590, y, 13, C.muted));
    const states = [
      ["w", [`<circle cx="40" cy="${cy}" r="4" fill="none" stroke="${C.faint}" stroke-width="1.5"/>`, text("waiting", 470, y, 13, C.faint)]],
      ["k", [dot(40, cy, 4.5, C.warn), text("starting…", 470, y, 13, C.warn)]],
      ["o", [dot(40, cy, 4.5, C.ok), text("running", 470, y, 13, C.ok)]],
    ];
    const g = (cls, anims, body) => `<g class="${cls}${anims ? ` ${anims}` : ""}">${body.join("")}</g>`;
    if (animate) {
      parts.push(g("w", vis(`w${i}`, [[0, START(i)], [GONE + 0.001, LOOP]]), states[0][1]));
      parts.push(g("k", vis(`k${i}`, [[START(i), READY(i) - 0.001]]), states[1][1]));
      parts.push(g("o", vis(`o${i}`, [[READY(i), HOLD, GONE - HOLD]]), states[2][1]));
      parts.push(`<circle class="r ${anim(`r${i}`, [[0, "opacity:0;transform:scale(1)"], [READY(i) - 0.001, "opacity:0;transform:scale(1)"], [READY(i), "opacity:.9;transform:scale(1)"], [READY(i) + 0.45, "opacity:0;transform:scale(2.6)"], [LOOP, "opacity:0;transform:scale(2.6)"]])}" cx="40" cy="${cy}" r="4.5" fill="none" stroke="${C.ok}" stroke-width="1.5"/>`);
    } else {
      parts.push(g("o", "", states[2][1]));
    }
  });

  parts.push(box(330, 44, "Needs attention", "0"));
  const waiting = [text("Waiting for 6 Apps to start", 40, 358, 13, C.muted)];
  const clear = [check(40, 358), text("Nothing needs attention", 56, 358, 13, C.text)];
  if (animate) {
    parts.push(`<g class="w ${vis("aw", [[0, ALL - 0.001], [GONE + 0.001, LOOP]])}">${waiting.join("")}</g>`);
    parts.push(`<g class="o ${vis("ao", [[ALL, HOLD, GONE - HOLD]])}">${clear.join("")}</g>`);
  } else {
    parts.push(`<g class="o">${clear.join("")}</g>`);
  }
  const keys = [["tab", C.bright], [" next", C.muted], ["  ·  ", C.faint], ["1-5", C.bright], [" tabs", C.muted], ["  ·  ", C.faint], ["a", C.bright], [" actions", C.muted], ["  ·  ", C.faint], ["/", C.bright], [" search", C.muted], ["  ·  ", C.faint], ["?", C.bright], [" help", C.muted], ["  ·  ", C.faint], ["q", C.bright], [" quit", C.muted]];
  parts.push(run(keys, 24, 408, 12));

  const defs = [...used].map(([ch, id]) => `<path id="${id}" d="${mono.glyph(ch).d}"/>`).join("");
  const style = animate ? `<style>.w,.k,.r{opacity:0}.r{transform-box:fill-box;transform-origin:center}${sheet.join("")}@media (prefers-reduced-motion:reduce){*{animation:none!important}}</style>` : "";
  const win = `<g>${parts.join("")}</g>`;
  const box_ = crop || (frame ? [0, 0, FRAME.w, FRAME.h] : [0, 0, WIN.w, WIN.h]);
  const [vx, vy, vw, vh] = box_;
  const inner = frame ? `<rect width="${FRAME.w}" height="${FRAME.h}" rx="14" fill="${C.bg}"/><g transform="translate(${FRAME.pad} ${FRAME.pad})">${win}</g>` : win;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="${vw}" height="${vh}" role="img" aria-labelledby="t d"><title id="t">self-host Dashboard, Overview</title><desc id="d">Six Apps (Jellyfin, Sonarr, Radarr, Prowlarr, qBittorrent, Homarr) come up one by one: each status light goes from waiting to starting to running, then nothing needs attention.</desc><defs>${defs}</defs>${style}${inner}</svg>`;
}
