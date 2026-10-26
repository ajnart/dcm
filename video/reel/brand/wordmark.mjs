import { join } from "node:path";
import { loadFont } from "../readme/glyphs.mjs";
import { markBody, DESC, n } from "./shapes.mjs";
import { INK_BOX, MARKS, THEME, root } from "./source.mjs";

const FONT = join(root, "video/reel/node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2");
const TEXT = "self-host";
const TOP = -760;
const BOTTOM = 20;
const HEIGHT = BOTTOM - TOP;
const MARK_H = 1000;
const GAP = 320;
const STACK_MARK_H = 2200;
const STACK_GAP = 420;
const PAD = 60;

const font = loadFont(FONT, { wght: 700 });

const layout = (() => {
  let x = 0;
  const parts = [...TEXT].map((ch) => {
    const g = font.glyph(ch);
    const p = `<path transform="translate(${x} 0)" d="${g.d}"/>`;
    x += g.advance;
    return p;
  });
  return { width: x, paths: parts.join("") };
})();

const svgDoc = (w, h, label, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(w)} ${n(h)}" width="${n(w / 10)}" height="${n(h / 10)}" role="img" aria-label="${label}"><title>${label}</title><desc>${DESC}</desc>${body}</svg>\n`;

const text = (fill, tx, ty) => `<g fill="${fill}" transform="translate(${n(tx)} ${n(ty)})">${layout.paths}</g>`;
const mark = (model, h, tx, ty) => {
  const s = h / INK_BOX.h;
  return `<g transform="translate(${n(tx - INK_BOX.x * s)} ${n(ty - INK_BOX.y * s)}) scale(${n(s)})">${markBody(model)}</g>`;
};

export const wordmarkDoc = (ink) => svgDoc(layout.width + PAD * 2, HEIGHT + PAD * 2, "self-host", text(ink, PAD, PAD - TOP));

export const lockupHDoc = (model, ink) => {
  const mw = (MARK_H * INK_BOX.w) / INK_BOX.h;
  const w = PAD + mw + GAP + layout.width + PAD;
  const h = MARK_H + PAD * 2;
  return svgDoc(w, h, "self-host", mark(model, MARK_H, PAD, PAD) + text(ink, PAD + mw + GAP, PAD + (MARK_H - HEIGHT) / 2 - TOP));
};

export const lockupVDoc = (model, ink) => {
  const mw = (STACK_MARK_H * INK_BOX.w) / INK_BOX.h;
  const w = Math.max(mw, layout.width) + PAD * 2;
  const h = PAD + STACK_MARK_H + STACK_GAP + HEIGHT + PAD;
  return svgDoc(w, h, "self-host", mark(model, STACK_MARK_H, (w - mw) / 2, PAD) + text(ink, (w - layout.width) / 2, PAD + STACK_MARK_H + STACK_GAP - TOP));
};

export const WORDMARK_THEMES = [
  { id: "dark", theme: "dark", model: MARKS.dark.model, ink: THEME.dark.text, note: "for dark backgrounds" },
  { id: "light", theme: "light", model: MARKS.light.model, ink: THEME.light.text, note: "for light backgrounds" },
];
