import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const RECT = /<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" fill="(#[0-9a-f]{6})"/;
const LED = /<circle cx="(\d+)" cy="(\d+)" r="(\d+)" fill="(#[0-9a-f]{6})"/;

const merge = (rects) => {
  const out = [];
  for (const r of rects) {
    const last = out[out.length - 1];
    if (last && last.x === r.x && last.fill === r.fill && last.y + last.h === r.y) last.h += r.h;
    else out.push({ ...r });
  }
  return out;
};

const columns = (rects) => {
  const byX = new Map();
  for (const r of rects) byX.set(r.x, [...(byX.get(r.x) ?? []), r]);
  return [...byX].sort((a, b) => a[0] - b[0]).map(([x, rs]) => ({ x, c: (x - 12) / 12, rects: merge(rs.sort((a, b) => a.y - b.y)) }));
};

const parse = (file) => {
  const svg = readFileSync(join(root, "docs/assets", file), "utf8");
  if (!svg.includes('viewBox="0 0 228 216"')) throw new Error(`${file}: the Logo grid changed, update video/reel/brand`);
  const containers = [];
  let rects = [];
  for (const line of svg.split("\n")) {
    const r = line.match(RECT);
    if (r) {
      rects.push({ x: +r[1], y: +r[2], w: +r[3], h: +r[4], fill: r[5] });
      continue;
    }
    const l = line.match(LED);
    if (!l) continue;
    containers.push({ cols: columns(rects), led: { cx: +l[1], cy: +l[2], r: +l[3], fill: l[4] } });
    rects = [];
  }
  if (containers.length !== 4 || rects.length) throw new Error(`${file}: expected four containers, each closed by a light`);
  return containers.map((c, f) => ({ ...c, b: 3 - f }));
};

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export const hex = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
export const mix = (a, b, t) => {
  const [x, y] = [rgb(a), rgb(b)];
  return hex(x.map((v, i) => v + (y[i] - v) * t));
};

const recolor = (model, fn) => model.map((c) => ({ ...c, cols: c.cols.map((col) => ({ ...col, rects: col.rects.map((r) => ({ ...r, fill: fn(r.fill) })) })), led: { ...c.led, fill: fn(c.led.fill) } }));

const dark = parse("logo-dark.svg");
const light = parse("logo-light.svg");

const pairs = (a, b) =>
  a.flatMap((c, i) => [...c.cols.flatMap((col, j) => col.rects.map((r, k) => [r, b[i].cols[j].rects[k]])), [c.led, b[i].led]]);

const shape = (m) => JSON.stringify(m.map((c) => [c.cols.map((k) => k.rects.map((r) => [r.x, r.y, r.w, r.h])), c.led.cx, c.led.cy, c.led.r]));
if (shape(dark) !== shape(light)) throw new Error("logo-dark.svg and logo-light.svg differ in geometry");

const halfway = (() => {
  const m = recolor(dark, (f) => f);
  for (const [r, l] of pairs(m, light)) r.fill = mix(r.fill, l.fill, 0.5);
  return m;
})();

const ink = { black: "#12101a", white: "#f5f5f5" };

export const MARKS = {
  color: { model: halfway, label: "Colour", note: "mid-tone brand colours, readable on light and dark backgrounds" },
  dark: { model: dark, label: "Dark", note: "for dark backgrounds, the Dashboard's palette" },
  light: { model: light, label: "Light", note: "for light backgrounds, the Logo's light palette" },
  mono: { model: recolor(dark, () => ink.black), label: "Mono", note: "one ink, for light backgrounds and print" },
  "mono-white": { model: recolor(dark, () => ink.white), label: "Mono white", note: "one ink, for dark backgrounds" },
};

export const ACCENT = "#7a57d3";
const inkBox = (model) => {
  const xs = model.flatMap((c) => [...c.cols.flatMap((col) => col.rects.flatMap((r) => [r.x, r.x + r.w])), c.led.cx - c.led.r, c.led.cx + c.led.r]);
  const ys = model.flatMap((c) => [...c.cols.flatMap((col) => col.rects.flatMap((r) => [r.y, r.y + r.h])), c.led.cy - c.led.r, c.led.cy + c.led.r]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};

export const INK_BOX = inkBox(dark);
export const PULSE_REACH = 13;
export const CANVAS = { x: -16, y: -20, w: 256, h: 256 };

const reach = INK_BOX.x + INK_BOX.w - 4 + PULSE_REACH;
if (reach > CANVAS.x + CANVAS.w || INK_BOX.x < CANVAS.x || INK_BOX.y < CANVAS.y || INK_BOX.y + INK_BOX.h > CANVAS.y + CANVAS.h) throw new Error("the mark or its pulse no longer fits CANVAS, update video/reel/brand/source.mjs");
export const THEME = {
  dark: { mark: "dark", text: ink.white, grey: "#4a4856", amber: "#ffaf00", ok: "#00d787", accent: ACCENT },
  light: { mark: "light", text: ink.black, grey: "#bcbac6", amber: "#cf8a00", ok: "#1a7f37", accent: ACCENT },
};
