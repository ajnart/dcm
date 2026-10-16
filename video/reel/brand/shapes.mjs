import { CANVAS } from "./source.mjs";

export const n = (v) => String(Math.round(v * 100) / 100);
export const DESC = "Four aligned shipping containers: gold, cyan, pink and purple, each with a lit status light.";
const SEAM = 0.15;

export const rectEl = (r, extra = "") => `<rect x="${r.x}" y="${r.y}" width="${n(r.w + SEAM)}" height="${n(r.h + SEAM)}" fill="${r.fill}"${extra}/>`;
export const ledEl = (l, extra = "") => `<circle cx="${l.cx}" cy="${l.cy}" r="${l.r}" fill="${l.fill}"${extra}/>`;

export const markBody = (model) => model.map((c) => c.cols.map((col) => col.rects.map((r) => rectEl(r)).join("")).join("") + ledEl(c.led)).join("");

export const markDoc = (model, box = CANVAS, extra = "") => {
  const { x, y, w, h } = box;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="self-host Logo"><title>self-host Logo</title><desc>${DESC}</desc>${extra}${markBody(model)}</svg>\n`;
};
