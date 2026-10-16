import { CANVAS, MARKS, mix, THEME } from "./source.mjs";
import { DESC, ledEl, n, rectEl } from "./shapes.mjs";

const pct = (t, T) => n((t / T) * 100);

const track = (name, T, initial, events) => {
  const frames = [[0, initial]];
  let cur = initial;
  for (const [t0, t1, css, ease] of events) {
    if (t0 < frames[frames.length - 1][0] - 1e-9) throw new Error(`${name}: events out of order at ${t0}`);
    frames.push([t0, ease ? `${cur};animation-timing-function:${ease}` : cur]);
    frames.push([t1, css]);
    cur = css;
  }
  if (cur !== initial) throw new Error(`${name}: loop does not close`);
  if (frames[frames.length - 1][0] < T) frames.push([T, cur]);
  return `@keyframes ${name}{${frames.map(([t, css]) => `${pct(t, T)}%{${css}}`).join("")}}`;
};

const flip = (t, css) => [t, t + 0.001, css];

const STATIC = "@media (prefers-reduced-motion:reduce){.a,.a *{animation:none!important}}";
const BASE = (T) => `.a{animation-duration:${T}s;animation-iteration-count:infinite;animation-timing-function:linear;transform-box:fill-box}`;
const OUT = "cubic-bezier(.2,.8,.3,1)";
const POP = "cubic-bezier(.3,1.5,.5,1)";

const doc = (css, body) => {
  const { x, y, w, h } = CANVAS;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="self-host Logo"><title>self-host Logo</title><desc>${DESC}</desc><style>${css}</style>${body}</svg>\n`;
};

const rank = (b, c) => b * 15 + c;

const build = (theme) => {
  const T = 7;
  const model = MARKS[theme.mark].model;
  const css = [BASE(T), ".g{transform-origin:50% 100%}", ".l{transform-origin:50% 50%}"];
  const body = model.map((cont) => {
    const cols = cont.cols.map((col) => {
      const j = rank(cont.b, col.c);
      const gone = "transform:scaleY(0)";
      const full = "transform:scaleY(1)";
      css.push(track(`c${j}`, T, full, [[3 + (59 - j) * 0.0075, 3.22 + (59 - j) * 0.0075, gone], [4 + j * 0.026, 4.34 + j * 0.026, full, OUT]]));
      return `<g class="a g" style="animation-name:c${j}">${col.rects.map((r) => rectEl(r)).join("")}</g>`;
    });
    const t = 4 + rank(cont.b, 14) * 0.026 + 0.1;
    css.push(track(`d${cont.b}`, T, "transform:scale(1)", [[2.9 + (3 - cont.b) * 0.02, 3.1 + (3 - cont.b) * 0.02, "transform:scale(0)"], [t, t + 0.3, "transform:scale(1)", POP]]));
    return cols.join("") + ledEl(cont.led, ` class="a l" style="animation-name:d${cont.b}"`);
  });
  return doc(css.join("") + STATIC, body.join(""));
};

const lightUp = (theme) => {
  const T = 7;
  const model = MARKS[theme.mark].model;
  const css = [BASE(T), ".l{transform-origin:50% 50%}"];
  const lit = "fill:var(--c)";
  const unlit = "fill:var(--u)";
  const body = model.map((cont) => {
    const cols = cont.cols.map((col) => {
      const j = rank(cont.b, col.c);
      const off = 3 + (3 - cont.b) * 0.04;
      const on = 3.9 + cont.b * 0.5 + col.c * 0.028;
      css.push(track(`u${j}`, T, lit, [[off, off + 0.12, unlit], [on, on + 0.14, lit]]));
      return col.rects.map((r) => rectEl(r, ` class="a" style="--c:${r.fill};--u:${mix(r.fill, theme.grey, 0.8)};animation-name:u${j}"`)).join("");
    });
    const on = 3.9 + cont.b * 0.5 + 14 * 0.028 + 0.14;
    const off = 3 + (3 - cont.b) * 0.04;
    css.push(track(`v${cont.b}`, T, `${lit};transform:scale(1)`, [[off, off + 0.12, `${unlit};transform:scale(.55)`], [on, on + 0.3, `${lit};transform:scale(1)`, POP]]));
    return cols.join("") + ledEl(cont.led, ` class="a l" style="--c:${cont.led.fill};--u:${theme.grey};animation-name:v${cont.b}"`);
  });
  return doc(css.join("") + STATIC, body.join(""));
};

const pulse = (theme) => {
  const T = 6.4;
  const model = MARKS[theme.mark].model;
  const css = [BASE(T), ".l{transform-origin:50% 50%}", ".p{fill:none;transform-origin:50% 50%}"];
  const ok = (s) => `fill:${theme.ok};transform:scale(${s})`;
  const body = model.map((cont) => {
    const wait = 2 + cont.b * 0.5;
    const run = wait + 0.4;
    css.push(
      track(`s${cont.b}`, T, ok(1), [
        [1.4, 1.55, `fill:${theme.grey};transform:scale(.55)`],
        [wait, wait + 0.15, `fill:${theme.amber};transform:scale(.8)`],
        [run, run + 0.3, ok(1), POP],
      ]),
      track(`r${cont.b}`, T, "transform:scale(1);stroke-width:0", [
        flip(run, "transform:scale(1);stroke-width:2.5"),
        [run + 0.001, run + 0.75, "transform:scale(3);stroke-width:0", OUT],
        flip(run + 0.76, "transform:scale(1);stroke-width:0"),
      ]),
    );
    const static_ = cont.cols.map((col) => col.rects.map((r) => rectEl(r)).join("")).join("");
    const led = cont.led;
    return `${static_}${ledEl(led, ` class="a l" style="animation-name:s${cont.b}"`)}<circle class="a p" cx="${led.cx}" cy="${led.cy}" r="${led.r}" stroke="${theme.ok}" stroke-width="0" style="animation-name:r${cont.b}"/>`;
  });
  return doc(css.join("") + STATIC, body.join(""));
};

export const animated = (theme) => ({
  build: build(THEME[theme]),
  "light-up": lightUp(THEME[theme]),
  pulse: pulse(THEME[theme]),
});
