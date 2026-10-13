import { reduced } from "./util.js";

const FPS = 24;
const U = 12;
const GRAV = 400;
const HOP = 1.7;
const SNAP = 1.9;
const LAND = [0.72, 1.0, 1.26, 1.48];
const SKEW = [0, 1, -1, 1];
const LIGHT_LAG = 0.12;
const TICK_FROM = 20 / FPS;
const BEAT = 6 / FPS;
const SETTLED = 2.6;
const CENTER_X = 102;
const WIDTH = 15;
const SVG = "http://www.w3.org/2000/svg";
const OK = "#00d787";
const MUTED = "#8a8a8a";

const clamp01 = (x) => Math.min(Math.max(x, 0), 1);
const outCubic = (x) => 1 - (1 - clamp01(x)) ** 3;
const inQuad = (x) => clamp01(x) ** 2;

function spring(t, omega, zeta) {
  if (t <= 0) return 0;
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t));
}

function noise(seed, a, b) {
  const x = Math.sin(seed * 127.1 + a * 311.7 + b * 74.7) * 43758.5453;
  return x - Math.floor(x);
}

function mixHex(a, b, k) {
  const ch = (hex, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const out = [0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * clamp01(k)));
  return `#${out.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

function rects(parent, n, w, h) {
  return Array.from({ length: n }, () => {
    const r = document.createElementNS(SVG, "rect");
    r.setAttribute("width", w);
    r.setAttribute("height", h);
    r.setAttribute("opacity", "0");
    parent.append(r);
    return r;
  });
}

function crateOf(g) {
  const i = Number(g.dataset.i);
  const top = 12 + (3 - i) * 48;
  const fall = (top + 72) / U;
  return {
    i,
    g,
    top,
    bottom: top + 48,
    fall,
    duration: Math.sqrt((2 * fall) / GRAV),
    lit: Math.max(TICK_FROM + i * BEAT, LAND[i] + LIGHT_LAG),
    color: g.querySelector(".shape rect").getAttribute("fill"),
    shape: g.querySelector(".shape"),
    tint: g.querySelector(".tint"),
    glow: g.querySelector(".glow"),
    led: g.querySelector(".led"),
    lamp: g.querySelector(".lamp"),
    spark: g.querySelector(".spark"),
    streak: g.querySelector(".streak"),
    trail: rects(g.querySelector(".trail"), 14, 3, 6),
    dust: rects(g.querySelector(".dust"), 32, 3, 3),
  };
}

function drop(c, t) {
  const start = LAND[c.i] - c.duration;
  if (t < start) return null;
  let dy = 0;
  let hp = 4;
  let w = WIDTH;
  let vel = 0;
  if (t < LAND[c.i]) {
    const u = t - start;
    dy = Math.round(-c.fall + 0.5 * GRAV * u * u) * U;
    vel = GRAV * u;
    if (u > 0.7 * c.duration) hp = 5;
  } else {
    const q = 1 - spring(t - LAND[c.i], 32, 0.35);
    if (q > 0.3) {
      hp = 3;
      w += 2;
    } else if (q < -0.15) hp = 5;
  }
  const hu = (t - HOP) / (SNAP - HOP);
  let up = 0;
  if (hu >= -0.25 && hu < 0 && w === WIDTH) w += 2;
  if (hu >= 0 && hu < 1 && Math.sin(Math.PI * hu) > 0.45) up = 2;
  if (t >= SNAP && w === WIDTH && 1 - spring(t - SNAP, 30, 0.4) > 0.3) w += 2;
  const sk = hu < 0.35 ? SKEW[c.i] : 0;
  return { dy, hp, w, vel, up, sk };
}

function drawTrail(c, d) {
  const n = d.vel > 0 ? Math.round((d.vel / GRAV / c.duration) * 7) : 0;
  const half = (d.w * U) / 2;
  const x = CENTER_X + d.sk * U;
  const top = c.bottom + d.dy - (d.hp * U);
  c.trail.forEach((r, k) => {
    const j = (k >> 1) + 1;
    const visible = j <= n;
    const a = visible ? (1 - j / (n + 1)) * 0.6 : 0;
    r.setAttribute("x", k & 1 ? x + half - 3 : x - half);
    r.setAttribute("y", top - j * U);
    r.setAttribute("fill", c.color);
    r.setAttribute("opacity", a.toFixed(2));
  });
}

function drawDust(c, d, t) {
  const events = [{ age: t - LAND[c.i], seed: 0 }];
  if (c.i === 0) events.push({ age: t - SNAP, seed: 1 });
  const half = (d.w * U) / 2;
  const x = CENTER_X + d.sk * U;
  const y = c.bottom + d.dy - d.up * U;
  events.forEach(({ age, seed }, e) => {
    const dock = c.i === 0;
    const life = dock ? 0.55 : 0.4;
    const n = dock ? 8 : 4;
    const live = age >= 0 && age < life && !reduced;
    const u = age / life;
    for (let k = 0; k < 16; k++) {
      const r = c.dust[e * 16 + k];
      const dir = k < 8 ? -1 : 1;
      const idx = k % 8;
      if (!live || idx >= n) {
        r.setAttribute("opacity", "0");
        continue;
      }
      const r1 = noise(61 + seed * 7, c.i * 16 + idx, dir + 2);
      const r2 = noise(62 + seed * 7, c.i * 16 + idx, dir + 2);
      const spread = dock ? 1 : 0.6;
      const rise = dock ? 1 : 0.7;
      const x0 = dir < 0 ? x - half - 3 : x + half;
      r.setAttribute("x", (x0 + dir * (6 + (18 + 60 * r1) * outCubic(u) * spread)).toFixed(1));
      r.setAttribute("y", (y - 3 - (6 + 24 * r2) * Math.sin(Math.PI * Math.min(u * 1.3, 1)) * rise).toFixed(1));
      r.setAttribute("opacity", ((1 - u * u) * (0.55 + 0.45 * r2) * 0.9).toFixed(2));
    }
  });
}

function drawCrate(c, t, idle) {
  const d = drop(c, t);
  c.g.setAttribute("display", d ? "inline" : "none");
  if (!d) return;
  const sx = d.w / WIDTH;
  const sy = d.hp / 4;
  c.shape.setAttribute("transform", `translate(${d.sk * U} ${d.dy - d.up * U}) translate(${CENTER_X} ${c.bottom}) scale(${sx} ${sy}) translate(${-CENTER_X} ${-c.bottom})`);

  const age = t - c.lit;
  const lit = age >= 0;
  const on = lit ? outCubic(age / 0.2) : 0;
  let glow = lit && age < 0.45 ? 0.85 * (1 - age / 0.45) ** 2 : 0;
  if (!reduced && t >= SNAP && t < SNAP + 0.45) {
    const pos = ((t - SNAP) / 0.28) * 11 - 1.5;
    const k = (c.i * 2 + 0.5 - pos) / 1.3;
    glow = Math.max(glow, Math.exp(-k * k) * 0.8);
  }
  c.shape.setAttribute("opacity", (0.62 + 0.38 * on).toFixed(2));
  c.tint.setAttribute("opacity", (0.6 * (1 - on)).toFixed(2));
  c.glow.setAttribute("opacity", glow.toFixed(2));
  drawTrail(c, d);
  drawDust(c, d, t);

  const ledY = c.top + 36;
  c.led.setAttribute("transform", `translate(${d.sk * U} ${-(d.up / 2) * 2 * U})`);
  c.led.setAttribute("display", t >= LAND[c.i] - 0.05 ? "inline" : "none");
  c.lamp.setAttribute("cx", "210");
  c.lamp.setAttribute("cy", String(ledY));
  c.spark.setAttribute("transform", `translate(210 ${ledY})`);
  c.streak.setAttribute("y", String(ledY - 1));
  if (!lit) {
    c.lamp.setAttribute("r", "2");
    c.lamp.setAttribute("fill", MUTED);
    c.lamp.setAttribute("opacity", "0.5");
    c.spark.setAttribute("opacity", "0");
    c.streak.setAttribute("opacity", "0");
    return;
  }
  const sparkling = age < 0.09 && !reduced;
  let fill = OK;
  if (age < 0.45 && !reduced) fill = mixHex(OK, "#ffffff", 0.8 * (1 - (age - 0.09) / 0.36) ** 2);
  let r = 4;
  let opacity = 1;
  if (idle > 0 && !reduced && noise(41, c.i, Math.floor(idle * 8)) < 0.07) {
    r = 3;
    opacity = 0.6;
  }
  c.spark.setAttribute("opacity", sparkling ? "1" : "0");
  c.lamp.setAttribute("opacity", sparkling ? "0" : String(opacity));
  c.lamp.setAttribute("r", String(r));
  c.lamp.setAttribute("fill", fill);
  const streak = age < 0.2 && !reduced ? Math.sin(Math.PI * (age / 0.2)) * 0.8 : 0;
  c.streak.setAttribute("opacity", streak.toFixed(2));
}

function drawDock(dock, crates, t) {
  const bottom = crates.find((c) => c.i === 0);
  const t0 = LAND[0] - 0.56;
  if (reduced || t <= t0 || t >= LAND[0]) {
    dock.setAttribute("opacity", "0");
    return;
  }
  const prox = inQuad((t - t0) / 0.56);
  const w = WIDTH * U * (0.25 + 0.75 * prox);
  dock.setAttribute("x", (CENTER_X - w / 2).toFixed(1));
  dock.setAttribute("y", String(bottom.bottom + 3));
  dock.setAttribute("width", w.toFixed(1));
  dock.setAttribute("opacity", (0.25 + 0.55 * prox).toFixed(2));
}

export function mountLogo(button) {
  const crates = [...button.querySelectorAll(".crate")].map(crateOf);
  const dock = button.querySelector(".dock");
  let start = performance.now();
  let frame = -1;
  let visible = true;

  const draw = (t, idle) => {
    for (const c of crates) drawCrate(c, t, idle);
    drawDock(dock, crates, t);
  };

  const tick = (now) => {
    if (!visible) return;
    const f = Math.floor(((now - start) / 1000) * FPS);
    if (f !== frame) {
      frame = f;
      const t = f / FPS;
      draw(Math.min(t, SETTLED), Math.max(0, t - SETTLED));
    }
    requestAnimationFrame(tick);
  };

  if (reduced) {
    draw(SETTLED, 0);
    return;
  }
  draw(0, 0);
  new IntersectionObserver(([entry]) => {
    const was = visible;
    visible = entry.isIntersecting;
    if (visible && !was) requestAnimationFrame(tick);
  }).observe(button);
  requestAnimationFrame(tick);
  button.addEventListener("click", () => {
    start = performance.now();
    frame = -1;
  });
}
