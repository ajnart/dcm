import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFont } from "./glyphs.mjs";

const reel = join(dirname(fileURLToPath(import.meta.url)), "..");
const mono = loadFont(join(reel, "node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2"));
const C = { bg: "#09080f", win: "#0d0b14", panel: "#14121e", line: "rgba(255,255,255,0.1)", accent: "#7a57d3", at: "#a88df2", ok: "#00d787", warn: "#ffaf00", text: "#d0d0d0", muted: "#8a8a8a", faint: "#444", bright: "#f5f5f5" };
const n = (v) => Math.round(v * 100) / 100;
const icon = (id) => {
  const png = id === "cleanuparr";
  return `data:image/${png ? "png" : "svg+xml"};base64,${readFileSync(join(reel, "assets/icons", `${id}.${png ? "png" : "svg"}`)).toString("base64")}`;
};

const catalog = JSON.parse(readFileSync(join(reel, "../../site/src/data/catalog.json"), "utf8")).apps;
const NAMES = { sonarr: "Sonarr", radarr: "Radarr", prowlarr: "Prowlarr", qbittorrent: "qBittorrent", seerr: "Seerr", jellyfin: "Jellyfin", cleanuparr: "Cleanuparr", homarr: "Homarr" };
// every Link the scenes draw, as [App that is set up, App it is linked to]; checked against the Catalog on import
export const LINKS = [
  ["sonarr", "qbittorrent"], ["radarr", "qbittorrent"], ["prowlarr", "sonarr"], ["prowlarr", "radarr"],
  ["seerr", "jellyfin"], ["seerr", "sonarr"], ["seerr", "radarr"],
  ["cleanuparr", "sonarr"], ["cleanuparr", "radarr"], ["cleanuparr", "qbittorrent"],
];
const TILES = ["jellyfin", "sonarr", "radarr", "prowlarr", "seerr", "qbittorrent", "immich", "nextcloud", "vaultwarden", "navidrome", "home-assistant"];
const homarr = catalog.find((a) => a.id === "homarr").l;
for (const [from, to] of LINKS) {
  if (!catalog.find((a) => a.id === from)?.l.includes(to)) throw new Error(`the Catalog has no Link ${from} to ${to}`);
}
for (const t of TILES) if (!homarr.includes(t)) throw new Error(`the Catalog has no Link homarr to ${t}`);
export const HOMARR_TILES = homarr.length;

const kit = (loop, animate) => {
  const used = new Map();
  const icons = new Set();
  const sheet = [];
  const names = new Map();
  const adv = (s) => (mono.glyph("a").advance * s) / mono.upm;
  const width = (str, s) => [...str].length * adv(s);
  const pct = (t) => `${Math.round((t / loop) * 1e5) / 1e3}%`;
  const kf = (stops) => {
    const body = stops.map(([t, css]) => `${pct(t)}{${css}}`).join("");
    if (!names.has(body)) {
      const name = `k${names.size}`;
      names.set(body, name);
      sheet.push(`@keyframes ${name}{${body}}.${name}{animation:${name} ${loop}s linear infinite}`);
    }
    return names.get(body);
  };
  const text = (str, x, y, s, fill, o = {}) => {
    const w = width(str, s);
    const x0 = o.anchor === "middle" ? x - w / 2 : o.anchor === "end" ? x - w : x;
    let cx = 0;
    let uses = "";
    for (const ch of str) {
      if (ch !== " ") {
        if (!used.has(ch)) used.set(ch, `g${used.size}`);
        uses += `<use href="#${used.get(ch)}" x="${cx}"/>`;
      }
      cx += mono.glyph(ch).advance;
    }
    return `<g transform="translate(${n(x0)} ${n(y)}) scale(${s / mono.upm})" fill="${fill}"${o.bold ? ` stroke="${fill}" stroke-width="40" stroke-linejoin="round"` : ""}>${uses}</g>`;
  };
  const img = (id, x, y, s) => {
    icons.add(id);
    return `<use href="#i-${id}" transform="translate(${n(x)} ${n(y)}) scale(${s})"/>`;
  };
  const cls = (name, extra = "") => (animate ? ` class="${extra}${extra ? " " : ""}${name}"` : extra ? ` class="${extra}"` : "");
  // the rewind: from REWIND_AT the build undoes itself in reverse order, each part going out at the mirrored point of the build (TE), ending on the first frame at the loop's end
  const REWIND_AT = loop - 0.8, REWIND = 0.8, TE = 4.3;
  const out = (te, d) => n(REWIND_AT + (1 - te / TE) * (REWIND - d));
  const pop = (t0, d = 0.18) => {
    const rd = 0.12, rs = out(t0 + d, rd);
    return kf([[0, "opacity:0;transform:scale(.7)"], [t0, "opacity:0;transform:scale(.7);animation-timing-function:cubic-bezier(.2,.9,.3,1.25)"], [t0 + d, "opacity:1;transform:scale(1)"], [rs, "opacity:1;transform:scale(1);animation-timing-function:ease-in"], [rs + rd, "opacity:0;transform:scale(.7)"], [loop, "opacity:0;transform:scale(.7)"]]);
  };
  const fade = (t0, d = 0.3) => {
    const rd = 0.1, rs = out(t0 + d, rd);
    return kf([[0, "opacity:0"], [t0, "opacity:0"], [t0 + d, "opacity:1"], [rs, "opacity:1"], [rs + rd, "opacity:0"], [loop, "opacity:0"]]);
  };
  const show = (a, b) => {
    const stops = [];
    if (a > 0) stops.push([0, "opacity:0"], [a - 0.001, "opacity:0"]);
    stops.push([a, "opacity:1"]);
    if (b < loop) stops.push([b - 0.001, "opacity:1"], [b, "opacity:0"], [loop, "opacity:0"]);
    else stops.push([loop, "opacity:1"]);
    return kf(stops);
  };
  // a Link's wire: drawn in the accent colour from t0, green once it lands
  const edge = (d, end, t0, dur = 0.45, width_ = 2.5) => {
    const [ex, ey, deg] = end;
    const hide = `opacity:0;stroke-dashoffset:100;stroke:${C.at}`;
    const rd = 0.2, rs = out(t0 + dur, rd);
    const w = kf([[0, hide], [t0 - 0.001, hide], [t0, `opacity:1;stroke-dashoffset:100;stroke:${C.at}`], [t0 + dur, `opacity:1;stroke-dashoffset:0;stroke:${C.at}`], [t0 + dur + 0.4, `opacity:1;stroke-dashoffset:0;stroke:${C.ok}`], [rs, `opacity:1;stroke-dashoffset:0;stroke:${C.ok}`], [rs + rd, `opacity:1;stroke-dashoffset:100;stroke:${C.ok}`], [rs + rd + 0.001, hide], [loop, hide]]);
    const a = kf([[0, `opacity:0;fill:${C.at}`], [t0 + dur - 0.05, `opacity:0;fill:${C.at}`], [t0 + dur, `opacity:1;fill:${C.at}`], [t0 + dur + 0.4, `opacity:1;fill:${C.ok}`], [rs, `opacity:1;fill:${C.ok}`], [rs + 0.001, `opacity:0;fill:${C.ok}`], [loop, `opacity:0;fill:${C.at}`]]);
    return `<path${cls(w)} d="${d}" pathLength="100" fill="none" stroke="${C.ok}" stroke-width="${width_}" stroke-linecap="round" stroke-dasharray="100"/><path${cls(a)} transform="translate(${n(ex)} ${n(ey)}) rotate(${n(deg)})" d="M1 0L-9 -5L-9 5Z" fill="${C.ok}"/>`;
  };
  const master = (body) => `<g>${body}</g>`;
  const finish = ({ w, h, title, desc, body }) => {
    const defs = [...used].map(([ch, id]) => `<path id="${id}" d="${mono.glyph(ch).d}"/>`).join("") + [...icons].map((id) => `<image id="i-${id}" href="${icon(id)}" width="1" height="1"/>`).join("");
    const style = animate ? `<style>.p,.pp{transform-box:fill-box;transform-origin:center}${sheet.join("")}@media (prefers-reduced-motion:reduce){*{animation:none!important}}</style>` : "";
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-labelledby="t d"><title id="t">${title}</title><desc id="d">${desc}</desc><defs>${defs}</defs>${style}<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="20" fill="${C.bg}" stroke="rgba(255,255,255,0.14)"/>${body}</svg>`;
  };
  return { text, width, img, cls, pop, fade, show, edge, master, finish, kf };
};

const rrect = (x, y, w, h, r, fill, stroke) => `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${r}" fill="${fill}"${stroke ? ` stroke="${stroke}"` : ""}/>`;
const ang = (x1, y1, x2, y2) => (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
const nm = (id) => NAMES[id];

// B: graph, Apps appear and the Links draw between them
const graph = (animate) => {
  const LOOP = 8;
  const k = kit(LOOP, animate);
  const W = 880, H = 484, CHH = 56;
  const cw = (id) => 10 + 34 + 8 + k.width(nm(id), 22) + 14;
  const at = (id, o) => ({ id, w: cw(id), cy: o.cy, x: o.x ?? (o.mid ? o.mid - cw(id) / 2 : W - 32 - cw(id)) });
  const P = {
    seerr: at("seerr", { x: 32, cy: 100 }),
    prowlarr: at("prowlarr", { x: 32, cy: 210 }),
    cleanuparr: at("cleanuparr", { x: 32, cy: 320 }),
    sonarr: at("sonarr", { mid: 430, cy: 150 }),
    radarr: at("radarr", { mid: 430, cy: 270 }),
    jellyfin: at("jellyfin", { cy: 90 }),
    qbittorrent: at("qbittorrent", { cy: 210 }),
    homarr: at("homarr", { x: 32, cy: 440 }),
  };
  const R = (id, dy = 0) => [P[id].x + P[id].w, P[id].cy + dy];
  const L = (id, dy = 0) => [P[id].x - 0, P[id].cy + dy];
  const hook = (id, p, q, t0, dur = 0.5) => {
    const dx = (q[0] - p[0]) * 0.5;
    const c1 = [p[0] + dx, p[1]], c2 = [q[0] - dx, q[1]];
    return k.edge(`M${n(p[0])} ${n(p[1])}C${n(c1[0])} ${n(c1[1])} ${n(c2[0])} ${n(c2[1])} ${n(q[0] - 6)} ${n(q[1])}`, [q[0], q[1], ang(c2[0], c2[1], q[0], q[1])], t0, dur);
  };
  const chip = (id, t0) => {
    const c = P[id];
    return `<g${k.cls(k.pop(t0), "p")}>${rrect(c.x, c.cy - CHH / 2, c.w, CHH, 14, C.panel, "rgba(168,141,242,0.35)")}${k.img(id, c.x + 10, c.cy - 17, 34)}${k.text(nm(id), c.x + 52, c.cy + 7.5, 22, C.bright, { bold: true })}</g>`;
  };
  const body = [];
  const edges = [];
  const t = { qbittorrent: 0.1, sonarr: 0.2, radarr: 0.3, prowlarr: 0.8, jellyfin: 1.4, seerr: 1.5, cleanuparr: 2.3, homarr: 3.1 };
  for (const id of ["qbittorrent", "sonarr", "radarr", "prowlarr", "jellyfin", "seerr", "cleanuparr", "homarr"]) body.push(chip(id, t[id]));
  edges.push(hook("sonarr", R("sonarr"), L("qbittorrent", -8), 0.4, 0.35));
  edges.push(hook("radarr", R("radarr"), L("qbittorrent", 8), 0.5, 0.35));
  edges.push(hook("prowlarr", R("prowlarr"), L("sonarr", 0), 0.95, 0.35));
  edges.push(hook("prowlarr", R("prowlarr"), L("radarr", 0), 1.05, 0.35));
  edges.push(hook("seerr", R("seerr"), L("jellyfin", 0), 1.7, 0.5));
  edges.push(hook("seerr", R("seerr"), L("sonarr", -10), 1.8, 0.35));
  edges.push(hook("seerr", R("seerr"), L("radarr", -10), 1.9, 0.35));
  edges.push(hook("cleanuparr", R("cleanuparr"), L("sonarr", 10), 2.5, 0.35));
  edges.push(hook("cleanuparr", R("cleanuparr"), L("radarr", 10), 2.6, 0.35));
  {
    const p = R("cleanuparr"), q = [P.qbittorrent.x + P.qbittorrent.w / 2, P.qbittorrent.cy + CHH / 2];
    const c1 = [p[0] + 380, p[1]], c2 = [q[0], q[1] + 90];
    edges.push(k.edge(`M${p[0]} ${p[1]}C${n(c1[0])} ${n(c1[1])} ${n(c2[0])} ${n(c2[1])} ${n(q[0])} ${n(q[1] + 6)}`, [q[0], q[1], -90], 2.7, 0.6));
  }
  {
    const p = R("homarr"), x1 = 240;
    edges.push(k.edge(`M${p[0]} ${p[1]}H${x1 - 6}`, [x1, p[1], 0], 3.3, 0.3));
    TILES.forEach((id, j) => {
      const x = 252 + j * 48;
      body.push(`<g${k.cls(k.pop(3.5 + j * 0.05, 0.18), "pp")}>${rrect(x, 440 - 20, 40, 40, 10, C.panel, "rgba(255,255,255,0.12)")}${k.img(id, x + 6, 440 - 14, 28)}</g>`);
    });
    const more = `+${HOMARR_TILES - TILES.length}`;
    body.push(`<g${k.cls(k.fade(4.1, 0.2))}>${k.text(more, 252 + TILES.length * 48 + 2, 447.5, 22, C.at, { bold: true })}</g>`);
  }
  return k.finish({
    w: W,
    h: H,
    title: "Apps that wire themselves: a graph of Links",
    desc: "Apps appear and their Links draw between them: Sonarr and Radarr to qBittorrent, Prowlarr to Sonarr and Radarr, Seerr to Jellyfin, Sonarr and Radarr, Cleanuparr to Sonarr, Radarr and qBittorrent, and Homarr to a row of tiles.",
    body: k.master(body.join("") + edges.join("")),
  });
};

export const SCENES = [
  { id: "graph", name: "Graph: Apps appear, arrows draw between them", build: graph, desc: "eight Apps as chips; ten Links drawn as arrows, Homarr fanning into tiles", alt: "Apps that wire themselves. Apps appear and arrows draw between them: Sonarr and Radarr to qBittorrent, Prowlarr to Sonarr and Radarr, Seerr to Jellyfin, Sonarr and Radarr, Cleanuparr to Sonarr, Radarr and qBittorrent, and Homarr to a row of tiles for the other Apps." },
];
