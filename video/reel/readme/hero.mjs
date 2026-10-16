import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFont } from "./glyphs.mjs";

const reel = join(dirname(fileURLToPath(import.meta.url)), "..");
const fonts = join(reel, "node_modules/@fontsource-variable");
const faces = new Map();
const face = (name, wght) => {
  const key = `${name}${wght}`;
  if (!faces.has(key)) faces.set(key, { key: key.replace(/\W/g, ""), f: loadFont(join(fonts, `${name}/files/${name}-latin-wght-normal.woff2`), { wght }) });
  return faces.get(key);
};
const head = () => face("inter-tight", 800);
const mono = (w) => face("jetbrains-mono", w);

const icon64 = (id) => {
  const png = id === "docmost";
  return `data:image/${png ? "png" : "svg+xml"};base64,${readFileSync(join(reel, "assets/icons", `${id}.${png ? "png" : "svg"}`)).toString("base64")}`;
};
const logoSrc = readFileSync(join(reel, "../../site/public/logo.svg"), "utf8");
const logoRects = logoSrc.match(/<rect [^>]*\/>/g).join("");
const logoLights = logoSrc.match(/<circle [^>]*\/>/g).map((c) => +c.match(/cy="(\d+)"/)[1]);

export const SIZE = { w: 880, h: 440 };
const C = { bg: "#09080f", at: "#a88df2", accent: "#7a57d3", ok: "#00d787", fail: "#ff5f5f", bright: "#f5f5f5", panel: "#14121e", edge: "#3a3358" };
const n = (v) => Math.round(v * 100) / 100;
const ms = (t) => Math.round(t * 1000) / 1000;
const mix = (a, b, u) => `#${[0, 2, 4].map((i) => Math.round(parseInt(a.slice(1 + i, 3 + i), 16) * (1 - u) + parseInt(b.slice(1 + i, 3 + i), 16) * u).toString(16).padStart(2, "0")).join("")}`;

const SWAPS = [
  ["netflix", "Netflix", 15, "jellyfin", "Jellyfin"], ["spotify", "Spotify", 12, "navidrome", "Navidrome"], ["google-drive", "Drive", 10, "nextcloud", "Nextcloud"], ["dropbox", "Dropbox", 12, "syncthing", "Syncthing"],
  ["google-photos", "Photos", 10, "immich", "Immich"], ["1password", "1Password", 3, "vaultwarden", "Vaultwarden"], ["notion", "Notion", 10, "docmost", "Docmost"], ["chatgpt", "ChatGPT", 20, "open-webui", "Open WebUI"],
];
const FAN = [["jellyfin", "Jellyfin"], ["sonarr", "Sonarr"], ["radarr", "Radarr"], ["immich", "Immich"], ["nextcloud", "Nextcloud"], ["homarr", "Homarr"], ["vaultwarden", "Vaultwarden"], ["navidrome", "Navidrome"], ["home-assistant", "Home Assistant"]];

// a hero as one SVG: text is glyph paths from the bundled fonts, so it renders the same in GitHub's <img>
// sandbox where no font loads; animate adds CSS keyframes, and the base state (no keyframes) is fully lit
function kit(loop, animate, size = SIZE) {
  const glyphs = new Map();
  const images = new Set();
  const sheet = [];
  let count = 0;
  const pct = (t) => `${Math.round((t / loop) * 1e5) / 1e3}%`;
  const anim = (stops) => {
    const cls = `a${count++}`;
    sheet.push(`@keyframes ${cls}{${stops.map(([t, css]) => `${pct(t)}{${css}}`).join("")}}.${cls}{animation:${cls} ${loop}s linear infinite}`);
    return cls;
  };
  const measure = (fc, s, size, ls = 0) => [...s].reduce((a, ch) => a + (fc.f.glyph(ch).advance / fc.f.upm + ls) * size, 0);
  const text = (fc, s, x, y, size, fill, { ls = 0, anchor = "start" } = {}) => {
    const k = size / fc.f.upm;
    let cx = 0;
    let uses = "";
    for (const ch of s) {
      const g = fc.f.glyph(ch);
      if (ch !== " ") {
        const id = `${fc.key}-${ch.codePointAt(0).toString(36)}`;
        glyphs.set(id, g.d);
        uses += `<use href="#${id}" x="${n(cx)}"/>`;
      }
      cx += g.advance + ls * fc.f.upm;
    }
    const w = cx * k;
    const dx = anchor === "middle" ? -w / 2 : anchor === "end" ? -w : 0;
    return `<g transform="translate(${n(x + dx)} ${n(y)}) scale(${Math.round(k * 1e5) / 1e5})" fill="${fill}">${uses}</g>`;
  };
  const icon = (id, x, y, s, extra = "") => {
    images.add(id);
    return `<use href="#i-${id}" transform="translate(${n(x)} ${n(y)}) scale(${s})"${extra}/>`;
  };
  const g = (cls, body) => `<g class="${cls}">${body}</g>`;
  const rise = (t0, out, { dy = 0, dur = 0.3 } = {}) => {
    const hide = `opacity:0;transform:translateY(${dy}px)`;
    const show = "opacity:1;transform:translateY(0)";
    const tail = out === undefined ? [[loop, show]] : [[ms(out), show], [ms(out + 0.4), hide], [loop, hide]];
    return anim([[0, hide], [ms(t0), `${hide};animation-timing-function:ease-out`], [ms(t0 + dur), show], ...tail]);
  };
  const fade = (stops) => anim(stops.map(([t, o]) => [ms(t), `opacity:${o}`]));
  const win = (t0, t1) => fade([[0, 0], [t0 - 0.001, 0], [t0, 1], [t1 - 0.001, 1], [t1, 0], [loop, 0]]);
  const track = (init, segs) => {
    const stops = [[0, init]];
    let cur = init;
    for (const [a, b, css, ease = "ease-in-out"] of segs) {
      if (a > stops[stops.length - 1][0] + 1e-6) stops.push([a, cur]);
      stops[stops.length - 1][1] += `;animation-timing-function:${ease}`;
      stops.push([b, css]);
      cur = css;
    }
    if (stops[stops.length - 1][0] < loop - 1e-6) stops.push([loop, cur]);
    return anim(stops.map(([t, css]) => [ms(t), css]));
  };
  const cut = (init, stops) => {
    const all = [[0, init], ...stops];
    all.push([loop, all[all.length - 1][1]]);
    return anim(all.map(([t, css]) => [ms(t), `${css};animation-timing-function:step-end`]));
  };
  const logo = (x, y, s) => `<use href="#logo" transform="translate(${n(x)} ${n(y)}) scale(${s})"/>`;
  const finish = ({ title, desc, bg, body }) => {
    const defs = [...glyphs].map(([id, d]) => `<path id="${id}" d="${d}"/>`).join("")
      + [...images].map((id) => `<image id="i-${id}" width="1" height="1" preserveAspectRatio="xMidYMid meet" href="${icon64(id)}"/>`).join("");
    const css = animate ? `<style>.x{opacity:0}${sheet.join("")}@media (prefers-reduced-motion:reduce){*{animation:none!important}}</style>` : "";
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size.w} ${size.h}" width="${size.w}" height="${size.h}" role="img" aria-labelledby="t d"><title id="t">${title}</title><desc id="d">${desc}</desc><defs>${defs}<g id="logo">${logoRects}</g>${bg.defs}<filter id="grey"><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="linear" slope="1.7"/><feFuncG type="linear" slope="1.7"/><feFuncB type="linear" slope="1.7"/></feComponentTransfer></filter></defs>${css}<rect width="${size.w}" height="${size.h}" rx="20" fill="url(#bg)"/>${body}<rect x=".5" y=".5" width="${size.w - 1}" height="${size.h - 1}" rx="19.5" fill="none" stroke="rgba(255,255,255,.14)"/></svg>`;
  };
  const radial = (cx, cy, rx, ry, a, stop) => ({
    defs: `<radialGradient id="bg" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(${cx} ${cy}) scale(${rx} ${ry})"><stop offset="0" stop-color="${a}"/><stop offset="${stop}" stop-color="${C.bg}"/></radialGradient>`,
  });
  return { anim, text, measure, icon, g, rise, fade, win, track, cut, logo, finish, radial };
}

const arrow = (x, y, w, sw) => `<path d="M${n(x)} ${n(y)}h${n(w)}m${n(-w * 0.35)} ${n(-w * 0.35)}l${n(w * 0.35)} ${n(w * 0.35)}l${n(-w * 0.35)} ${n(w * 0.35)}" fill="none" stroke="#777" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
const blinks = (from, to, loop) => {
  const stops = [];
  for (let t = from, on = true; t < to; t += 0.5, on = !on) stops.push([ms(t), `opacity:${on ? 1 : 0}`], [ms(t + 0.499), `opacity:${on ? 1 : 0}`]);
  return stops.length ? stops : [[0, "opacity:1"], [loop, "opacity:1"]];
};

export const LOOPS = { lockup: 6, swaps: 6.6, command: 3.2 };
export const SIZES = { lockup: SIZE, swaps: SIZE, command: { w: 880, h: 240 } };

export function lockup({ animate = false } = {}) {
  const LOOP = LOOPS.lockup;
  const OUT = 5.4;
  const k = kit(LOOP, animate);
  const { text, measure, g } = k;
  const m8 = mono(800), m7 = mono(700), h = head();
  const base = 303.1;
  const was = measure(m8, "$92", 38, -0.04);
  const slot = 40 + was + 12 + 24 + 12;
  const bx = 553, by = 85, bs = 1.25;
  const cmdW = 41 * 9.6;

  let body = k.logo(40, 59.6, 0.25) + text(m8, "self-host", 109, 95.4, 24, C.bright, { ls: -0.03 });
  body += text(h, "Stop renting", 40, 183.4, 58, C.bright, { ls: -0.045 });
  body += text(h, "your ", 40, 236.7, 58, C.bright, { ls: -0.045 });
  body += text(h, "software.", 40 + measure(h, "your ", 58, -0.045), 236.7, 58, C.at, { ls: -0.045 });
  body += k.logo(bx, by, bs);

  const price = `${text(m8, "$92", 40, base, 38, C.fail, { ls: -0.04 })}${arrow(117, 289, 19, 2.5)}${text(m7, "/ month", slot + measure(m8, "$0", 38, -0.04) + 12, base, 15, "#aaa")}`;
  const final = text(m8, "$0", slot, base, 38, C.ok, { ls: -0.04 });
  const strike = (extra = "") => `<rect${extra} x="40" y="289" width="${n(was)}" height="4" fill="${C.fail}"/>`;
  const box = `<rect x="40.5" y="336.8" width="427" height="43" fill="${C.panel}" stroke="${C.edge}"/>`;
  const cmd = text(m7, "$", 57, 363.6, 16, C.ok) + text(m7, " curl -fsSL self-host.fyi/install | bash", 66.6, 363.6, 16, C.bright);
  const lightsAt = bs;

  if (!animate) {
    const lights = logoLights.map((cy) => `<circle cx="210" cy="${cy}" r="4" fill="${C.ok}"/>`).join("");
    body += price + strike() + final + box + cmd + `<g transform="translate(${bx} ${by}) scale(${bs})">${lights}</g>`;
    return k.finish({ title: "Stop renting your software.", desc: "$92 a month becomes $0. Install with one curl command. The self-host Logo: four containers with their status lights.", bg: k.radial(748, 176, 968, 440, "#2d1f5e", 0.7), body });
  }

  const tail = (v) => [[OUT, v], [OUT + 0.4, "opacity:0"]];
  body += g(k.rise(0.4, OUT, { dy: 8 }), price);
  const strikeAt = 2.5;
  body += strike(` class="${k.anim([[0, "opacity:1;transform:scaleX(0)"], [strikeAt, "opacity:1;transform:scaleX(0)"], [strikeAt + 0.25, "opacity:1;transform:scaleX(1)"], [OUT, "opacity:1;transform:scaleX(1)"], [OUT + 0.4, "opacity:0;transform:scaleX(1)"], [LOOP, "opacity:0;transform:scaleX(0)"]])}" style="transform-box:fill-box;transform-origin:0 50%"`);

  const steps = 12, from = 2.8, dt = 1 / steps;
  for (let i = 0; i < steps - 1; i++) {
    const u = i / (steps - 1);
    const v = Math.round(88 * (1 - u * u * (3 - 2 * u)));
    body += `<g class="x ${k.win(from + i * dt, from + (i + 1) * dt)}">${text(m8, `$${v}`, slot, base, 38, mix(C.fail, C.ok, u), { ls: -0.04 })}</g>`;
  }
  const popAt = from + (steps - 1) * dt;
  body += `<g class="${k.anim([[0, "opacity:0;transform:scale(1)"], [ms(popAt - 0.001), "opacity:0;transform:scale(1)"], [ms(popAt), "opacity:1;transform:scale(1.22)"], [ms(popAt + 0.3), "opacity:1;transform:scale(1)"], [OUT, "opacity:1;transform:scale(1)"], [OUT + 0.4, "opacity:0;transform:scale(1)"], [LOOP, "opacity:0;transform:scale(1)"]])}" style="transform-box:fill-box;transform-origin:50% 60%">${final}</g>`;

  const t0 = 0.8, t1 = 2.2;
  const to = (x) => `opacity:1;transform:translateX(${n(x)}px)`;
  body += box + g(k.fade([[0, 1], ...tail("opacity:1").map(([t]) => [t, t === OUT ? 1 : 0]), [LOOP, 0]]), cmd);
  body += `<rect class="x ${k.anim([[0, to(0)], [ms(t0), `${to(0)};animation-timing-function:steps(41,end)`], [ms(t1), to(cmdW)], [ms(t1 + 0.001), `opacity:0;transform:translateX(${n(cmdW)}px)`], [LOOP, "opacity:0;transform:translateX(0)"]])}" x="57" y="337.8" width="${n(cmdW + 2)}" height="41" fill="${C.panel}"/>`;
  body += `<g class="x ${k.anim([[0, "opacity:0;transform:translateX(0)"], [ms(t0 - 0.001), "opacity:0;transform:translateX(0)"], [ms(t0), `${to(0)};animation-timing-function:steps(41,end)`], [ms(t1), to(cmdW)], [OUT, to(cmdW)], [OUT + 0.3, `opacity:0;transform:translateX(${n(cmdW)}px)`], [LOOP, "opacity:0;transform:translateX(0)"]])}"><rect class="${k.fade([[0, 1], ...blinks(t1, OUT, LOOP).slice(0, -0), [LOOP, 0]].sort((a, b) => a[0] - b[0]))}" x="57" y="349" width="8" height="18" fill="${C.at}"/></g>`;

  const lights = logoLights.map((cy, i) => {
    const t = 3.0 + i * 0.28;
    const on = k.fade([[0, 0], [t - 0.001, 0], [t, 1], [OUT, 1], [OUT + 0.4, 0], [LOOP, 0]]);
    const ring = k.anim([[0, "opacity:0;transform:scale(1)"], [ms(t - 0.001), "opacity:0;transform:scale(1)"], [ms(t), "opacity:.9;transform:scale(1)"], [ms(t + 0.5), "opacity:0;transform:scale(3)"], [LOOP, "opacity:0;transform:scale(3)"]]);
    return `<circle class="${on}" cx="210" cy="${cy}" r="4" fill="${C.ok}"/><circle class="x ${ring}" style="transform-box:fill-box;transform-origin:center" cx="210" cy="${cy}" r="4" fill="none" stroke="${C.ok}" stroke-width="1.5"/>`;
  }).join("");
  body += `<g transform="translate(${bx} ${by}) scale(${bs})">${lights}</g>`;
  return k.finish({ title: "Stop renting your software.", desc: "One curl command is typed, the four containers' status lights come on and $92 a month counts down to $0.", bg: k.radial(748, 176, 968, 440, "#2d1f5e", 0.7), body });
}

export function swaps({ animate = false } = {}) {
  const LOOP = LOOPS.swaps;
  const k = kit(LOOP, animate);
  const { text, measure, g, icon, track, cut } = k;
  const m8 = mono(800), m7 = mono(700), m6 = mono(600), h = head();
  const F = (i) => 0.7 + i * 0.42;
  const B = (i) => 5.2 + (SWAPS.length - 1 - i) * 0.08;
  const SLIDE = 0.4, TOTAL = SWAPS.reduce((a, s) => a + s[2], 0);
  const cum = (c) => SWAPS.slice(0, c).reduce((a, s) => a + s[2], 0);
  const tot = 106.3, right = 840;
  const labelW = measure(m7, "/ month", 13);

  let body = text(h, "Stop renting", 40, 68.4, 46, C.bright, { ls: -0.045 });
  body += text(h, "your ", 40, 111.6, 46, C.bright, { ls: -0.045 });
  body += text(h, "software.", 40 + measure(h, "your ", 46, -0.045), 111.6, 46, C.at, { ls: -0.045 });
  body += text(m7, "$", 40, 409.5, 15, C.ok) + text(m7, " curl -fsSL self-host.fyi/install | bash", 49, 409.5, 15, C.at);
  body += text(m7, "/ month", right - labelW, tot, 13, "#aaa");

  const counts = Array.from({ length: SWAPS.length + 1 }, (_, c) => {
    const el = text(m8, `$${TOTAL - cum(c)}`, right - labelW - 10, tot, 34, mix(C.fail, C.ok, cum(c) / TOTAL), { ls: -0.04, anchor: "end" });
    const last = c === SWAPS.length;
    if (!animate) return last ? el : "";
    const spans = [[c === 0 ? 0 : F(c - 1) + 0.2, last ? B(c - 1) + 0.2 : F(c) + 0.2]];
    if (!last) spans.push([B(c) + 0.2, c === 0 ? LOOP : B(c - 1) + 0.2]);
    const stops = spans.flatMap(([s, e]) => [s > 0 ? [ms(s), "opacity:1"] : null, e < LOOP ? [ms(e), "opacity:0"] : null]).filter(Boolean).sort((x, y) => x[0] - y[0]);
    return `<g${last ? "" : ' opacity="0"'} class="${cut(c === 0 ? "opacity:1" : "opacity:0", stops)}">${el}</g>`;
  }).join("");
  body += counts;

  body += SWAPS.map(([a, an, p, b, bn], i) => {
    const cx = 40 + (i % 4) * 203, cy = 150 + Math.floor(i / 4) * 86;
    const px = cx + 178;
    const pw = measure(m7, `$${p}`, 13);
    const frame = (extra = "") => `<rect${extra} x="${cx + 0.5}" y="${cy + 0.5}" width="190" height="73" fill="${C.panel}" fill-opacity=".8" stroke="#2b2740"/>`;
    const row2 = icon(b, cx + 13, cy + 41, 22) + text(m7, bn, cx + 43, cy + 56.6, 13, C.bright) + text(m7, "$0", px, cy + 56.6, 13, C.ok, { anchor: "end" });
    const grey = (extra = "") => icon(a, cx + 13, cy + 11, 22, extra);
    const name = (extra = "") => `<g${extra}>${text(m6, an, cx + 43, cy + 26.6, 13, "currentColor")}</g>`;
    const priceTxt = text(m7, `$${p}`, px, cy + 26.6, 13, C.fail, { anchor: "end" });
    const bar = (extra = "") => `<rect${extra} x="${n(px - pw - 2)}" y="${cy + 21}" width="${n(pw + 4)}" height="1.6" fill="${C.fail}"/>`;
    if (!animate) return frame() + grey(' filter="url(#grey)" opacity=".55"') + name(' style="color:#9a96ae"') + priceTxt + bar() + row2;
    const f = F(i), r = B(i), e = "cubic-bezier(.2,.8,.2,1)";
    const dim = "filter:grayscale(1) brightness(1.7);opacity:.55", lit = "filter:grayscale(0) brightness(1);opacity:1";
    const edge = k.track("stroke:#2b2740", [[f, f + 0.1, "stroke:rgba(0,215,135,.75)"], [f + 0.1, f + 0.6, "stroke:#2b2740"]]);
    const clip = `<clipPath id="k${i}"><rect x="${cx + 0.5}" y="${cy + 0.5}" width="190" height="73"/></clipPath>`;
    return clip + frame(` class="${edge}"`)
      + grey(` filter="url(#grey)" opacity=".55" class="${track(lit, [[f + 0.05, f + 0.3, dim], [r + 0.05, r + 0.3, lit]])}"`)
      + name(` style="color:#9a96ae" class="${track("color:#d9d6e8", [[f + 0.05, f + 0.3, "color:#9a96ae"], [r + 0.05, r + 0.3, "color:#d9d6e8"]])}"`)
      + priceTxt
      + bar(` class="${track("transform:scaleX(0)", [[f + 0.05, f + 0.3, "transform:scaleX(1)"], [r, r + 0.25, "transform:scaleX(0)"]])}" style="transform-box:fill-box;transform-origin:100% 50%"`)
      + `<g clip-path="url(#k${i})">${g(track("transform:translateX(200px)", [[f + 0.1, f + 0.1 + SLIDE, "transform:translateX(0)", e], [r, r + SLIDE - 0.05, "transform:translateX(200px)", "cubic-bezier(.5,0,.8,.3)"]]), row2)}</g>`;
  }).join("");
  return k.finish({ title: "Stop renting your software.", desc: "Eight subscriptions, Netflix, Spotify, Drive, Dropbox, Photos, 1Password, Notion and ChatGPT, are swapped one by one for Apps you own at $0: $92 a month becomes $0.", bg: k.radial(880, 0, 880, 396, "#2a1d58", 0.68), body });
}

export function command({ animate = false } = {}) {
  const size = SIZES.command;
  const k = kit(LOOPS.command, animate, size);
  const { text, measure, icon, track } = k;
  const m8 = mono(800), m6 = mono(600);
  const line = "curl -fsSL self-host.fyi/install | bash", fs = 24, pad = 24;
  const dw = measure(m8, "$ ", fs);
  const W = 2 * pad + dw + measure(m8, line, fs), bx = size.w / 2 - W / 2, tx = bx + pad;

  let body = `<rect x="${n(bx - 6)}" y="10" width="${n(W + 12)}" height="68" fill="${C.accent}" fill-opacity=".13"/>`;
  body += `<rect x="${n(bx + 0.5)}" y="16.5" width="${n(W - 1)}" height="55" fill="${C.panel}" stroke="${C.edge}"/>`;
  body += text(m8, "$", tx, 52.6, fs, C.ok) + text(m8, line, tx + dw, 52.6, fs, C.bright);

  body += FAN.map(([id, name], i) => {
    const x = 90 + i * 87.5, d = Math.abs(i - 4);
    const dpath = `M440 72C440 108 ${x} 112 ${x} 148`;
    const path = `<path d="${dpath}" pathLength="1" fill="none" stroke="${C.accent}" stroke-width="2" stroke-opacity=".7"/>`;
    const tile = `<circle cx="${x}" cy="148" r="3.5" fill="${C.ok}"/><rect x="${x - 27.5}" y="150.5" width="55" height="55" fill="#181524" stroke="${C.edge}"/>${icon(id, x - 17, 161, 34)}${text(m6, name, x, 224.2, 10, "#8a8a8a", { anchor: "middle" })}`;
    if (!animate) return path + tile;
    const dot = (a) => `<path stroke-dashoffset=".09" class="${track("stroke-dashoffset:.09", [[a, a + 0.85, "stroke-dashoffset:-1.02", "ease-in-out"], [a + 0.85, a + 0.86, "stroke-dashoffset:.09", "step-end"]])}" d="${dpath}" pathLength="1" stroke-dasharray=".08 2" fill="none" stroke="#d6c8ff" stroke-width="3.5"/>`;
    return path + tile + dot(0.3 + d * 0.06) + dot(1.8 + d * 0.06);
  }).join("");
  return k.finish({ title: "One command, every App.", desc: "The install command, curl -fsSL self-host.fyi/install | bash, wired to nine Apps with data pulses travelling the wires: Jellyfin, Sonarr, Radarr, Immich, Nextcloud, Homarr, Vaultwarden, Navidrome and Home Assistant.", bg: k.radial(440, 44, 880, 170, "#2a1d58", 0.7), body });
}
