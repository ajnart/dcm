import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFont } from "./glyphs.mjs";

const reel = join(dirname(fileURLToPath(import.meta.url)), "..");
const mono = loadFont(join(reel, "node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2"));
const P = { bg: "#09080f", win: "#0d0b14", panel: "#14121e", line: "rgba(255,255,255,0.1)", acc: "#7a57d3", at: "#a88df2", ok: "#00d787", warn: "#ffaf00", fail: "#ff5f5f", info: "#5fafff", t: "#d0d0d0", m: "#8a8a8a", f: "#55535f", b: "#f5f5f5", chip: "#2a2638", gold: "#ffc857", cyan: "#3ddcff", pink: "#ff5fa8" };
const n = (v) => Math.round(v * 100) / 100;
const CELL = mono.glyph("a").advance / mono.upm;

const SHAPES = {
  "●": (x, y, s, f) => `<circle cx="${n(x + 0.3 * s)}" cy="${n(y - 0.3 * s)}" r="${n(0.21 * s)}" fill="${f}"/>`,
  "○": (x, y, s, f) => `<circle cx="${n(x + 0.3 * s)}" cy="${n(y - 0.3 * s)}" r="${n(0.18 * s)}" fill="none" stroke="${f}" stroke-width="${n(0.08 * s)}"/>`,
  "◆": (x, y, s, f) => `<path d="M${n(x + 0.3 * s)} ${n(y - 0.62 * s)}l${n(0.27 * s)} ${n(0.32 * s)}l${n(-0.27 * s)} ${n(0.32 * s)}l${n(-0.27 * s)} ${n(-0.32 * s)}z" fill="${f}"/>`,
  "✓": (x, y, s, f) => `<path d="M${n(x + 0.07 * s)} ${n(y - 0.3 * s)}l${n(0.15 * s)} ${n(0.15 * s)}l${n(0.3 * s)} ${n(-0.38 * s)}" fill="none" stroke="${f}" stroke-width="${n(0.1 * s)}" stroke-linecap="round" stroke-linejoin="round"/>`,
  "✗": (x, y, s, f) => `<path d="M${n(x + 0.12 * s)} ${n(y - 0.5 * s)}l${n(0.36 * s)} ${n(0.4 * s)}m${n(-0.36 * s)} 0l${n(0.36 * s)} ${n(-0.4 * s)}" fill="none" stroke="${f}" stroke-width="${n(0.1 * s)}" stroke-linecap="round"/>`,
  "─": (x, y, s, f) => `<path d="M${n(x)} ${n(y - 0.3 * s)}h${n(0.6 * s)}" stroke="${f}" stroke-width="${n(0.06 * s)}"/>`,
  "│": (x, y, s, f) => `<path d="M${n(x + 0.3 * s)} ${n(y - 0.9 * s)}v${n(1.1 * s)}" stroke="${f}" stroke-width="${n(0.06 * s)}"/>`,
  "←": (x, y, s, f) => `<path d="M${n(x + 0.55 * s)} ${n(y - 0.3 * s)}h${n(-0.5 * s)}m${n(0.18 * s)} ${n(-0.17 * s)}l${n(-0.18 * s)} ${n(0.17 * s)}l${n(0.18 * s)} ${n(0.17 * s)}" fill="none" stroke="${f}" stroke-width="${n(0.08 * s)}" stroke-linecap="round" stroke-linejoin="round"/>`,
  "→": (x, y, s, f) => `<path d="M${n(x + 0.05 * s)} ${n(y - 0.3 * s)}h${n(0.5 * s)}m${n(-0.18 * s)} ${n(-0.17 * s)}l${n(0.18 * s)} ${n(0.17 * s)}l${n(-0.18 * s)} ${n(0.17 * s)}" fill="none" stroke="${f}" stroke-width="${n(0.08 * s)}" stroke-linecap="round" stroke-linejoin="round"/>`,
  "⇄": (x, y, s, f) => `<path d="M${n(x + 0.06 * s)} ${n(y - 0.42 * s)}h${n(0.48 * s)}m${n(-0.15 * s)} ${n(-0.12 * s)}l${n(0.15 * s)} ${n(0.12 * s)}l${n(-0.15 * s)} ${n(0.12 * s)}M${n(x + 0.54 * s)} ${n(y - 0.18 * s)}h${n(-0.48 * s)}m${n(0.15 * s)} ${n(-0.12 * s)}l${n(-0.15 * s)} ${n(0.12 * s)}l${n(0.15 * s)} ${n(0.12 * s)}" fill="none" stroke="${f}" stroke-width="${n(0.07 * s)}" stroke-linecap="round" stroke-linejoin="round"/>`,
  "◐": (x, y, s, f) => `<circle cx="${n(x + 0.3 * s)}" cy="${n(y - 0.3 * s)}" r="${n(0.2 * s)}" fill="none" stroke="${f}" stroke-width="${n(0.07 * s)}"/><path d="M${n(x + 0.3 * s)} ${n(y - 0.5 * s)}a${n(0.2 * s)} ${n(0.2 * s)} 0 0 0 0 ${n(0.4 * s)}z" fill="${f}"/>`,
  "❖": (x, y, s, f) => `<path d="M${n(x + 0.3 * s)} ${n(y - 0.62 * s)}l${n(0.28 * s)} ${n(0.32 * s)}l${n(-0.28 * s)} ${n(0.32 * s)}l${n(-0.28 * s)} ${n(-0.32 * s)}z" fill="none" stroke="${f}" stroke-width="${n(0.08 * s)}" stroke-linejoin="round"/><path d="M${n(x + 0.3 * s)} ${n(y - 0.46 * s)}l${n(0.12 * s)} ${n(0.16 * s)}l${n(-0.12 * s)} ${n(0.16 * s)}l${n(-0.12 * s)} ${n(-0.16 * s)}z" fill="${f}"/>`,
  "♫": (x, y, s, f) => `<path d="M${n(x + 0.18 * s)} ${n(y - 0.56 * s)}l${n(0.32 * s)} ${n(-0.1 * s)}v${n(0.5 * s)}M${n(x + 0.18 * s)} ${n(y - 0.56 * s)}v${n(0.5 * s)}" fill="none" stroke="${f}" stroke-width="${n(0.07 * s)}"/><ellipse cx="${n(x + 0.13 * s)}" cy="${n(y - 0.08 * s)}" rx="${n(0.1 * s)}" ry="${n(0.07 * s)}" fill="${f}"/><ellipse cx="${n(x + 0.45 * s)}" cy="${n(y - 0.18 * s)}" rx="${n(0.1 * s)}" ry="${n(0.07 * s)}" fill="${f}"/>`,
  "⊕": (x, y, s, f) => `<circle cx="${n(x + 0.3 * s)}" cy="${n(y - 0.3 * s)}" r="${n(0.2 * s)}" fill="none" stroke="${f}" stroke-width="${n(0.07 * s)}"/><path d="M${n(x + 0.3 * s)} ${n(y - 0.45 * s)}v${n(0.3 * s)}M${n(x + 0.15 * s)} ${n(y - 0.3 * s)}h${n(0.3 * s)}" stroke="${f}" stroke-width="${n(0.07 * s)}"/>`,
  "▦": (x, y, s, f) => `<rect x="${n(x + 0.1 * s)}" y="${n(y - 0.5 * s)}" width="${n(0.4 * s)}" height="${n(0.4 * s)}" fill="none" stroke="${f}" stroke-width="${n(0.07 * s)}"/><path d="M${n(x + 0.3 * s)} ${n(y - 0.5 * s)}v${n(0.4 * s)}M${n(x + 0.1 * s)} ${n(y - 0.3 * s)}h${n(0.4 * s)}" stroke="${f}" stroke-width="${n(0.05 * s)}"/>`,
  "▣": (x, y, s, f) => `<rect x="${n(x + 0.1 * s)}" y="${n(y - 0.5 * s)}" width="${n(0.4 * s)}" height="${n(0.4 * s)}" fill="none" stroke="${f}" stroke-width="${n(0.07 * s)}"/><rect x="${n(x + 0.2 * s)}" y="${n(y - 0.4 * s)}" width="${n(0.2 * s)}" height="${n(0.2 * s)}" fill="${f}"/>`,
  "✱": (x, y, s, f) => `<path d="M${n(x + 0.3 * s)} ${n(y - 0.5 * s)}v${n(0.4 * s)}M${n(x + 0.13 * s)} ${n(y - 0.4 * s)}l${n(0.34 * s)} ${n(0.2 * s)}M${n(x + 0.47 * s)} ${n(y - 0.4 * s)}l${n(-0.34 * s)} ${n(0.2 * s)}" stroke="${f}" stroke-width="${n(0.08 * s)}" stroke-linecap="round"/>`,
  "♥": (x, y, s, f) => `<path d="M${n(x + 0.3 * s)} ${n(y - 0.1 * s)}c${n(-0.3 * s)} ${n(-0.2 * s)} ${n(-0.26 * s)} ${n(-0.46 * s)} ${n(-0.1 * s)} ${n(-0.44 * s)}c${n(0.1 * s)} ${n(0.02 * s)} ${n(0.1 * s)} ${n(0.1 * s)} ${n(0.1 * s)} ${n(0.1 * s)}c0 0 0 ${n(-0.08 * s)} ${n(0.1 * s)} ${n(-0.1 * s)}c${n(0.16 * s)} ${n(-0.02 * s)} ${n(0.2 * s)} ${n(0.24 * s)} ${n(-0.1 * s)} ${n(0.44 * s)}z" fill="${f}"/>`,
  "⠧": (x, y, s, f) => `<circle class="sp" cx="${n(x + 0.3 * s)}" cy="${n(y - 0.3 * s)}" r="${n(0.18 * s)}" fill="none" stroke="${f}" stroke-width="${n(0.09 * s)}" stroke-dasharray="${n(0.45 * s)} ${n(0.7 * s)}" stroke-linecap="round"/>`,
};

class Doc {
  constructor(L) {
    this.L = L;
    this.used = new Map();
    this.sheet = [];
    this.k = 0;
    this.key = new Map();
  }
  id() {
    return (this.k++).toString(36);
  }
  pct(t) {
    return `${Math.round((t / this.L) * 1e5) / 1e3}%`;
  }
  glyph(ch) {
    if (!this.used.has(ch)) this.used.set(ch, `g${this.used.size.toString(36)}`);
    return this.used.get(ch);
  }
  text(s, x, y, size, fill, bold) {
    const k = size / mono.upm;
    const cell = CELL * size;
    let uses = "";
    let shapes = "";
    let i = 0;
    for (const ch of s) {
      if (ch !== " ") {
        if (SHAPES[ch]) shapes += SHAPES[ch](x + i * cell, y, size, fill);
        else uses += `<use href="#${this.glyph(ch)}" x="${i * mono.glyph("a").advance}"/>`;
      }
      i++;
    }
    const g = uses ? `<g transform="translate(${n(x)} ${n(y)}) scale(${k})" fill="${fill}"${bold ? ` stroke="${fill}" stroke-width="36" stroke-linejoin="round"` : ""}>${uses}</g>` : "";
    return g + shapes;
  }
  anim(stops, base = "") {
    const sig = JSON.stringify([stops, base]);
    if (this.key.has(sig)) return this.key.get(sig);
    const c = `a${this.id()}`;
    const byTime = new Map();
    for (const [t, css] of stops) byTime.set(t, css);
    const frames = [...byTime].sort((a, b) => a[0] - b[0]).map(([t, css]) => `${this.pct(t)}{${css}}`).join("");
    this.sheet.push(`@keyframes ${c}{${frames}}.${c}{${base ? `${base};` : ""}animation:${c} ${this.L}s linear infinite}`);
    this.key.set(sig, c);
    return c;
  }
  vis(spans, base = 0) {
    const E = 0.001;
    const stops = [[0, "opacity:0"]];
    let cur = 0;
    for (const [a, b] of spans) {
      if (a > 0) stops.push([a - E, "opacity:0"]);
      cur = 1;
      if (b < this.L) {
        stops.push([a, "opacity:1"], [b - 2 * E, "opacity:1"], [b - E, "opacity:0"]);
        cur = 0;
      } else stops.push([a, "opacity:1"], [b, "opacity:1"]);
    }
    stops.push([this.L, `opacity:${cur}`]);
    return this.anim(stops, `opacity:${base}`);
  }
  g(spans, body, base = 0) {
    return `<g class="${this.vis(spans, base)}">${body}</g>`;
  }
  type(x, y, w, h, count, t0, dur, bg = P.win) {
    const steps = `animation-timing-function:steps(${count},end)`;
    const cover = this.anim([[0, "transform:translateX(0)"], [t0, `transform:translateX(0);${steps}`], [t0 + dur, `transform:translateX(${n(w)}px)`], [this.L, `transform:translateX(${n(w)}px)`]], `transform:translateX(${n(w)}px)`);
    return { cover: `<rect class="${cover}" x="${n(x)}" y="${n(y)}" width="${n(w + 4)}" height="${h}" fill="${bg}"/>`, cursor: (cw, color) => `<g class="${this.anim([[0, "transform:translateX(0)"], [t0, `transform:translateX(0);${steps}`], [t0 + dur, `transform:translateX(${n(w)}px)`], [this.L, `transform:translateX(${n(w)}px)`]], `transform:translateX(${n(w)}px)`)}"><rect class="bl" x="${n(x)}" y="${n(y + 2)}" width="${n(cw)}" height="${h - 4}" fill="${color}"/></g>` };
  }
  svg(w, h, body, title, desc) {
    const defs = [...this.used].map(([ch, id]) => `<path id="${id}" d="${mono.glyph(ch).d}"/>`).join("");
    const style = `<style>.bl{animation:bl 1s steps(1) infinite}@keyframes bl{50%{opacity:0}}.sp{transform-box:fill-box;transform-origin:center;animation:sp .8s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}${this.sheet.join("")}@media (prefers-reduced-motion:reduce){*{animation:none!important}}</style>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-labelledby="t d"><title id="t">${title}</title><desc id="d">${desc}</desc><defs>${defs}</defs>${style}${body}</svg>`;
  }
}

const COLS = 104;
const ROWS = 22;
const SIZE = 13;
const RH = 19;
const WINW = 840;
const WINH = 32 + ROWS * RH + 8;
const col = (k) => P[k] || k;
const NAMES = ["Welcome", "What", "Where", "Access", "Who", "Look", "Review"];
const APPS = [
  ["Homarr", "ghcr.io/homarr-labs/homarr:latest", 7575, "Dashboard", "▦"],
  ["Jellyfin", "lscr.io/linuxserver/jellyfin:latest", 8096, "Media", "♫"],
  ["Prowlarr", "lscr.io/linuxserver/prowlarr:latest", 9696, "Requests", "⊕"],
  ["qBittorrent", "lscr.io/linuxserver/qbittorrent:latest", 8080, "Downloads", "↓"],
  ["Radarr", "lscr.io/linuxserver/radarr:latest", 7878, "Requests", "⊕"],
  ["Seerr", "ghcr.io/seerr-team/seerr:latest", 5055, "Requests", "⊕"],
  ["Sonarr", "lscr.io/linuxserver/sonarr:latest", 8989, "Requests", "⊕"],
];
const INSTALL = "qbittorrent sonarr radarr prowlarr jellyfin seerr homarr";
const CMD = "curl -fsSL https://self-host.fyi/install | bash";
const wrap = (s, w) => {
  const out = [];
  let line = "";
  for (const word of s.split(" ")) {
    if (line && (line + " " + word).length > w) {
      out.push(line);
      line = word;
    } else line = line ? line + " " + word : word;
  }
  return [...out, line];
};

const LOOP = 22.6;
const TM = { install: [0.3, 4.3], welcome: [4.3, 5.9], what: [5.9, 8.1], where: [8.1, 8.9], access: [8.9, 10.3], who: [10.3, 11.1], look: [11.1, 11.9], review: [11.9, 16.0], dash: [16.0, 22.0] };
const PRESS = 15.35;
const READY = (i) => 16.5 + i * 0.2;
const ALL = READY(6) + 0.25;
const PHASES = [[0.3, 4.3], [4.3, 11.9], [11.9, 16.0], [16.0, ALL]];

function term(d, x, y) {
  const c = CELL * SIZE;
  const T = {
    x, y, c, pos: {},
    cx: (k) => x + 14 + k * c,
    ry: (r) => y + 32 + r * RH,
    by: (r) => y + 32 + r * RH + RH - 5.5,
    runs: (r) => (typeof r === "string" ? [[r, "t"]] : r),
    len: (runs) => runs.reduce((a, [s]) => a + [...s].length, 0),
    put(r, k, runs) {
      let cur = k;
      let out = "";
      for (const [s, f, b] of T.runs(runs)) {
        out += d.text(s, T.cx(cur), T.by(r), SIZE, col(f || "t"), b);
        cur += [...s].length;
      }
      return out;
    },
    hl: (r, k, len, fill) => `<rect x="${n(T.cx(k) - 3)}" y="${n(T.ry(r) + 1)}" width="${n(len * c + 6)}" height="${RH - 2}" rx="3" fill="${fill}"/>`,
    chrome() {
      return `<rect x="${x}" y="${y}" width="${WINW}" height="${WINH}" rx="8" fill="${P.win}" stroke="rgba(255,255,255,0.14)"/><path d="M${x} ${y + 28}V${y + 8}a8 8 0 0 1 8-8h${WINW - 16}a8 8 0 0 1 8 8v20z" fill="${P.panel}"/><path d="M${x} ${y + 28.5}h${WINW}" stroke="${P.line}"/>${[14, 28, 42].map((o) => `<rect x="${x + o}" y="${y + 10}" width="8" height="8" rx="1.5" fill="#3a3646"/>`).join("")}${d.text("self-host", x + WINW / 2 - 4.5 * c * (11 / SIZE), y + 22, 11, P.m)}`;
    },
    chip(r, k, key, desc) {
      const w = [...key].length + 2;
      return { w: w + 1 + [...desc].length, svg: `<rect x="${n(T.cx(k) - 1)}" y="${n(T.ry(r) + 2)}" width="${n(w * c + 2)}" height="${RH - 4}" rx="3" fill="${P.chip}"/>${T.put(r, k + 1, [[key, "b", true]])}${T.put(r, k + w + 1, [[desc, "m"]])}` };
    },
    bar(left, chips) {
      const r = ROWS - 1;
      let out = T.put(r, 1, left);
      let total = 0;
      for (const [k, dsc] of chips) total += [...k].length + 2 + 1 + [...dsc].length + 2;
      let at = COLS - 1 - (total - 2);
      for (const [k, dsc] of chips) {
        const ch = T.chip(r, at, k, dsc);
        T.pos[k] = at;
        out += ch.svg;
        at += ch.w + 2;
      }
      return out;
    },
    steps(cur) {
      let at = 2;
      let out = "";
      NAMES.forEach((name, i) => {
        const mark = i < cur ? ["✓", "ok"] : i === cur ? ["●", "at"] : ["○", "f"];
        out += T.put(2, at, [[mark[0], mark[1]]]) + T.put(2, at + 2, [[name, i < cur ? "t" : i === cur ? "b" : "m", i === cur]]);
        at += 2 + name.length;
        if (i < NAMES.length - 1) {
          out += T.put(2, at, [[" › ", "f"]]);
          at += 3;
        }
      });
      return out;
    },
    header() {
      return T.put(0, 1, [["◆", "at"]]) + T.put(0, 3, [["self-host", "b", true]]) + T.put(0, COLS - 7, [["v1.1.2", "m"]]);
    },
    box(r0, c0, r1, c1, title, note, focus) {
      const w = (c1 - c0 + 1) * c - c;
      const labelLen = [...title].length + (note ? 1 + [...note].length : 0) + 2;
      return `<rect x="${n(T.cx(c0) + c / 2)}" y="${n(T.ry(r0) + RH / 2)}" width="${n(w)}" height="${(r1 - r0) * RH}" rx="4" fill="none" stroke="${focus ? P.acc : "#3a3646"}" stroke-width="1.2"/><rect x="${n(T.cx(c0 + 1))}" y="${T.ry(r0) + 3}" width="${n(labelLen * c)}" height="${RH - 6}" fill="${P.win}"/>${T.put(r0, c0 + 2, [[title, focus ? "b" : "m", true], ...(note ? [[" " + note, "m"]] : [])])}`;
    },
    para(r, k, s, width, color) {
      return wrap(s, width).map((l, i) => T.put(r + i, k, [[l, color || "t"]])).join("");
    },
  };
  return T;
}

const scenes = {
  install(d, T) {
    const ty = d.type(T.cx(2), T.ry(0), CMD.length * T.c, RH, CMD.length, TM.install[0] + 0.3, 1.4);
    const ty2 = d.type(T.cx(2), T.ry(6), "self-host".length * T.c, RH, 9, 3.4, 0.5);
    return (
      T.put(0, 0, [["$", "ok", true]]) + T.put(0, 2, [[CMD, "b"]]) + ty.cover + ty.cursor(T.c, P.b) +
      d.g([[2.0, TM.install[1]]], T.put(1, 0, [["Downloading self-host 1.1.2 for linux/amd64", "t"]])) +
      d.g([[2.4, TM.install[1]]], T.put(2, 0, [["Installed /home/you/.local/bin/self-host (1.1.2, checksum verified)", "t"]])) +
      d.g([[2.8, TM.install[1]]], T.put(4, 0, [["Next: run  ", "t"], ["self-host", "b", true], ["  for the dashboard, or  ", "t"], ["self-host install media --yes", "b", true], ["  for the media server.", "t"]])) +
      d.g([[3.3, TM.install[1]]], T.put(6, 0, [["$", "ok", true]])) + T.put(6, 2, [["self-host", "b"]]) + ty2.cover + d.g([[3.3, TM.install[1]]], ty2.cursor(T.c, P.b))
    );
  },
  welcome(d, T) {
    const x0 = 12;
    const rack = ["gold", "cyan", "pink", "acc"];
    const unit = T.c;
    let logo = "";
    rack.forEach((k, i) => {
      const r = 4 + i;
      for (let j = 0; j < 9; j++) logo += `<rect x="${n(T.cx(x0 + 1) + j * unit)}" y="${n(T.ry(r) + 2)}" width="${n(unit)}" height="${j % 2 ? RH / 2 - 2 : RH - 3}" fill="${P[k]}"/>`;
      logo += T.put(r, x0 + 11, [["●", "ok"]]);
    });
    return (
      T.header() + T.steps(0) + logo +
      T.put(9, x0, [["Welcome to self-host", "b", true]]) +
      T.para(10, x0, "self-host runs the Apps you pick on this machine with Docker Compose, and sets them up for you: one Admin login, their API keys and the Links between them.", 78, "t") +
      T.para(14, x0, "Have you run your own server or used Docker before, or is this all new to you?", 78, "b") +
      T.put(16, x0, [["> ", "at"], ["●", "at"], [" New: this is all new to me", "b"]]) +
      T.put(17, x0 + 2, [["○", "f"], [" Advanced: I have run a server or used Docker", "m"]]) +
      T.put(18, x0 + 4, [["Tailors self-host to you: more help along the way.", "m"]]) +
      T.put(20, x0, [["Nothing is written until you approve the plan at Review.", "m"]]) +
      T.bar([["q", "b", true], [" quit", "m"]], [["↑/↓", "focus"], ["space", "select"], ["enter", "continue"]])
    );
  },
  what(d, T) {
    const rows = ["Media", "Full private home server", "Home automation", "Local AI", "Monitoring and observability", "Photos and cloud files", "Remote access"];
    const [a, b] = TM.what;
    const tick = a + 1.1;
    const list = rows.map((name, i) => T.put(9 + i, 2, [[i === 0 ? "> " : "  ", "at"]]) + T.put(9 + i, 6, [["❖", i === 0 ? "at" : "m"]]) + T.put(9 + i, 8, [[name, i === 0 ? "b" : "t", i === 0]]) + (i ? T.put(9 + i, 4, [["○", "f"]]) : "")).join("");
    return (
      T.header() + T.steps(1) +
      T.para(4, 2, "Pick the Apps you want to run, or a Recipe: a ready-made set of Apps that work together. You can add more later from the Catalog. Homarr is preselected as your Apps' home page; unpick its App row to skip it.", 94, "t") +
      T.put(8, 2, [["Apps and Recipes", "b", true], [" · ✓ all · ◐ some · ○ none of a Recipe's Apps", "m"]]) +
      list +
      d.g([[a, tick]], T.put(9, 4, [["○", "f"]])) + d.g([[tick, b]], T.put(9, 4, [["✓", "ok"]])) +
      T.put(16, 2, [["space toggle · / filter · ↑/↓ focus · 94 more", "m"]]) +
      T.put(18, 2, [["Media (Recipe)", "b", true]]) +
      T.put(19, 2, [["Watch your movies and shows, and have new ones requested and downloaded for you", "t"]]) +
      T.put(20, 2, [["Includes qBittorrent, Sonarr, Radarr, Prowlarr, Jellyfin, Seerr", "m"]]) +
      T.bar([["answering", "at", true], [" · keys go to the form", "m"]], [["enter", "next"], ["esc", "back"]])
    );
  },
  where(d, T) {
    const f = (r, label, value, focus) => (focus ? `<rect x="${n(T.cx(2))}" y="${n(T.ry(r))}" width="2" height="${RH * 2}" fill="${P.acc}"/>` : "") + T.put(r, 4, [[label, focus ? "b" : "t", focus]]) + T.put(r + 1, 4, [["> ", "at"], [value, "b"]]);
    return (
      T.header() + T.steps(2) +
      T.para(4, 2, "This computer's address on your network, the settings your Apps share and where they keep their files.", 80, "t") +
      T.put(7, 2, [["Host settings", "b", true]]) + T.put(8, 2, [["Detected from this machine.", "m"]]) +
      f(9, "LAN address", "192.168.1.20", true) + f(12, "Time zone", "Europe/Paris") + f(15, "User ID (PUID)", "1000") + f(18, "Group ID (PGID)", "1000") +
      T.bar([["answering", "at", true], [" · keys go to the form", "m"]], [["enter", "next"], ["esc", "back"]])
    );
  },
  access(d, T) {
    const opts = ["Home network (default)", "Easy names at home", "From anywhere, privately", "Your own web address", "Bring your own", "This computer only"];
    return (
      T.header() + T.steps(3) +
      T.put(4, 2, [["How you'll open your Apps", "b", true]]) +
      T.para(5, 2, "Choose how phones, TVs and laptops will open your Apps. Home network needs nothing to set up. You can change this later in Settings, under Access.", 80, "t") +
      opts.map((o, i) => T.put(8 + i, 2, [[i === 0 ? "> " : "  ", "at"], [i === 0 ? "●" : "○", i === 0 ? "at" : "f"], [" " + o, i === 0 ? "b" : "m", i === 0]])).join("") +
      T.para(15, 2, "Phones, TVs and laptops on the same Wi-Fi or router as this computer can open your Apps at 192.168.1.20. Nobody on the internet can.", 80, "t") +
      T.put(18, 2, [["phones · TVs · laptops ──── router ──── this computer 192.168.1.20", "at"]]) +
      T.put(19, 33, [["│", "at"]]) + T.put(20, 30, [["internet ✗", "m"]]) +
      T.bar([["q", "b", true], [" quit", "m"]], [["↑/↓", "focus"], ["space", "select"], ["enter", "continue"], ["esc", "back"]])
    );
  },
  who(d, T) {
    return (
      T.header() + T.steps(4) +
      T.para(4, 2, "One Admin login signs in to every App, so there is only one to remember. Choose a password, or leave it empty: self-host generates a strong one, keeps it in your Project and shows it with self-host credentials. The password is hidden as you type and never shown again.", 80, "t") +
      T.put(9, 2, [["Admin login", "b", true]]) +
      `<rect x="${n(T.cx(2))}" y="${n(T.ry(10))}" width="2" height="${RH * 2}" fill="${P.acc}"/>` + T.put(10, 4, [["Admin username", "b", true]]) + T.put(11, 4, [["> ", "at"], ["admin", "b"]]) +
      T.put(13, 4, [["Admin password", "t"]]) + T.put(14, 4, [["Leave empty to generate a strong one", "m"]]) + T.put(15, 4, [[">", "at"]]) +
      T.bar([["answering", "at", true], [" · keys go to the form", "m"]], [["enter", "next"], ["esc", "back"]])
    );
  },
  look(d, T) {
    return (
      T.header() + T.steps(5) +
      T.put(4, 2, [["How self-host looks", "b", true]]) +
      T.para(5, 2, "self-host can draw its icons with a Nerd Font, a terminal font with extra symbols, or with plain symbols every font has. Bars and spinners look the same either way.", 80, "t") +
      T.put(8, 2, [["◆", "at"], [" self-host  ", "t"], ["▣", "t"], [" Docker  ", "t"], ["✱", "t"], [" key  ", "t"], ["⇄", "t"], [" link  ", "t"], ["♫", "t"], [" Media  ", "t"], ["↓", "t"], [" Downloads  ", "t"], ["♥", "t"], [" Monitoring", "t"]]) +
      T.put(10, 2, [["Choose your symbols; the sample shows your selection.", "t"]]) +
      T.put(11, 2, [["  ", "t"], ["○", "f"], [" Nerd Font: use extra font icons", "m"]]) +
      T.put(12, 2, [["> ", "at"], ["●", "at"], [" Simple (default): use plain symbols", "b", true]]) +
      T.put(14, 2, [["Learn about Nerd Fonts: https://www.nerdfonts.com", "m"]]) +
      T.bar([["q", "b", true], [" quit", "m"]], [["↑/↓", "focus"], ["space", "select"], ["enter", "continue"], ["esc", "back"]])
    );
  },
  review(d, T) {
    const [a, b] = TM.review;
    const pad = (s, w) => s + " ".repeat(Math.max(w - [...s].length, 0));
    const press = d.anim([[0, "opacity:0"], [PRESS - 0.001, "opacity:0"], [PRESS, "opacity:1"], [b, "opacity:1"], [b + 0.001, "opacity:0"], [LOOP, "opacity:0"]], "opacity:0");
    const pulse = d.anim([[0, "opacity:0"], [b - 1.3, "opacity:0"], [b - 1.3 + 0.001, "opacity:.9"], [PRESS - 0.001, "opacity:.9"], [PRESS, "opacity:0"], [LOOP, "opacity:0"]], "opacity:0");
    const bar = T.bar([["q", "b", true], [" quit", "m"]], [["r", "recheck"], ["enter", "approve"], ["esc", "back"]]);
    const k = T.pos.enter;
    const w = [..."enter"].length + 2;
    const box = (cls, extra) => `<rect class="${cls}" x="${n(T.cx(k) - 3)}" y="${n(T.ry(ROWS - 1))}" width="${n(w * T.c + 6)}" height="${RH}" rx="4" ${extra}/>`;
    return (
      T.header() + T.steps(6) +
      T.put(4, 2, [["Review", "b", true], ["  nothing has been written yet", "m"]]) +
      T.put(6, 2, [[pad("APP", 20) + pad("IMAGE", 46) + "PORT", "m", true]]) +
      APPS.map(([name, image, port], i) => T.put(7 + i, 2, [["●", "ok"], [" " + pad(name, 18), "t"], [pad(image, 46), "t"], [String(port), "t"]])).join("") +
      T.put(15, 2, [[pad("Access", 10), "m"], ["Home network — addresses use 192.168.1.20", "t"]]) +
      T.put(16, 2, [[pad("", 10), "m"], ["Reachability is not verified; check from another device.", "t"]]) +
      T.put(17, 2, [[pad("Settings", 10), "m"], ["TZ=Europe/Paris PUID=1000 PGID=1000", "t"]]) +
      T.put(18, 2, [[pad("Admin", 10), "m"], ["admin · password generated (see it with: self-host credentials)", "t"]]) +
      bar +
      box(pulse, `fill="none" stroke="${P.ok}" stroke-width="1.5"`) +
      box(press, `fill="${P.ok}" fill-opacity=".85"`) +
      d.g([[PRESS, b]], T.put(ROWS - 1, k + 1, [["enter", "win", true]]))
    );
  },
};

const TICKS = [16.4, 16.9, 17.2, 17.5, 17.7, 17.95];
const STAGES = [["▣", "Pull"], ["▣", "Start"], ["", "Setup"], ["✱", "Credentials"], ["⇄", "Links"], ["", "Check"]];

scenes.dash = (d, T) => {
  const [a] = TM.dash;
  const tabs = ["1 Overview", "2 Apps", "3 Activity", "4 Catalog", "5 Settings"];
  let head = T.put(0, 1, [["◆", "at"]]) + T.put(0, 3, [["self-host", "b", true]]);
  let at = 14;
  tabs.forEach((tab, i) => {
    if (i === 0) head += `<rect x="${n(T.cx(at) - 3)}" y="${n(T.ry(0) + 1)}" width="${n(tab.length * T.c + 6)}" height="${RH - 2}" rx="3" fill="${P.acc}"/>`;
    head += T.put(0, at, [[tab, i === 0 ? "b" : "m", i === 0]]);
    at += tab.length + 2;
  });
  const right = [["● healthy", "ok"], ["LAN 192.168.1.20", "t"], ["v1.1.2", "m"]];
  const total = right.reduce((acc, [s2]) => acc + [...s2].length + 2, 0);
  let rx = COLS - 1 - total + 2;
  for (const [s2, f] of right) {
    head += `<rect x="${n(T.cx(rx) - 3)}" y="${n(T.ry(0) + 2)}" width="${n([...s2].length * T.c + 6)}" height="${RH - 4}" rx="3" fill="${P.chip}"/>` + T.put(0, rx, [[s2, f]]);
    rx += [...s2].length + 2;
  }
  let now = T.box(2, 1, 9, COLS - 2, "Now", "", false);
    now += d.g([[ALL, LOOP]], T.put(3, 3, [["✓", "ok"]]), 1) + d.g([[a, ALL]], T.put(3, 3, [["●", "warn"]]), 0) + T.put(3, 5, [["install ", "b", true], [INSTALL, "t"]]);
  let stg = 3;
  STAGES.forEach(([icon, label], i) => {
    const base = stg;
    const w = 2 + (icon ? 2 : 0) + label.length;
    now += d.g([[a, TICKS[i]]], T.put(4, base, [["○", "f"]]), 0) + d.g([[TICKS[i], LOOP]], T.put(4, base, [["✓", "ok"]]), 1);
    now += T.put(4, base + 2, [...(icon ? [[icon, "m"], [" ", "m"]] : []), [label, "t"]]);
    stg += w + 3;
  });
  now += d.g([[a, ALL]], T.put(5, 3, [["Setting up Sonarr: add the root folder /media/tv", "t"]]), 0) + d.g([[ALL, LOOP]], T.put(5, 3, [["All 7 Apps are ready", "b", true]]), 1);
  now += T.put(7, 3, [["●", "ok"], [" Host: healthy", "t"]]);
  let list = T.box(10, 1, 20, 58, "Apps", "", true);
  APPS.forEach(([name, , , cat, icon], i) => {
    const r = 11 + i;
    const t1 = READY(i) - 0.35;
    const t2 = READY(i);
    list += d.g([[a, t1]], T.put(r, 3, [["○", "f"]]), 0) + d.g([[t1, t2]], T.put(r, 3, [["●", "warn"]]), 0) + d.g([[t2, LOOP]], T.put(r, 3, [["●", "ok"]]), 1);
    list += T.put(r, 5, [[icon, "m"]]) + T.put(r, 7, [[name, "b", true]]) + T.put(r, 20, [[cat, "m"]]);
    list += d.g([[a, t1]], T.put(r, 31, [["waiting", "f"]]), 0) + d.g([[t1, t2]], T.put(r, 31, [["starting", "warn"]]), 0) + d.g([[t2, LOOP]], T.put(r, 31, [["running", "ok"], ["  ✓", "ok"]]), 1);
  });
  const attn = T.box(10, 60, 20, COLS - 2, "Needs attention", "", false) + T.put(11, 62, [["✓", "ok"], [" Nothing needs your attention", "t"]]);
  const bar = T.bar([["1-5", "b", true], [" tabs  ←/→  A Project  ? help  q quit", "m"]], []);
  return head + now + list + attn + bar;
};

export { P, Doc, SHAPES, term, scenes, TM, TICKS, LOOP, PRESS, READY, ALL, PHASES, APPS, INSTALL, CMD, COLS, ROWS, SIZE, RH, WINW, WINH, n, col, wrap };
