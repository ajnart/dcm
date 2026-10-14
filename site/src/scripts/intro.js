import { $, reduced, sleep } from "./util.js";

const SPEED = 1.6;
const HOLD = 600;
const FADE = 300;

const shapes = {
  "█": [[0, 0, 1, 1]],
  "▀": [[0, 0, 1, 0.5]],
  "▄": [[0, 0.5, 1, 0.5]],
  "─": [[0, 0.46, 1, 0.08]],
  "━": [[0, 0.42, 1, 0.16]],
  "│": [[0.45, 0, 0.1, 1]],
};
const shades = { "░": 0.25, "▒": 0.5, "▓": 0.75 };

let film;
const load = () => (film ??= fetch("./intro.json").then((r) => (r.ok ? r.json() : null)).catch(() => null));

function player(canvas, data, base) {
  const ctx = canvas.getContext("2d");
  const font = getComputedStyle(canvas).fontFamily;
  const styles = data.styles.map((key) => {
    const [fg, bg, bold] = key.split("|");
    return { fg: fg || "#e4e4e4", bg: bg || base, bold: bold === "b" };
  });
  let cw = 0;
  let ch = 0;

  const fit = () => {
    const box = canvas.parentElement.getBoundingClientRect();
    const scale = Math.min(box.width / (data.w * 0.6), box.height / (data.h * 1.25));
    cw = Math.floor(scale * 0.6 * devicePixelRatio);
    ch = Math.floor(scale * 1.25 * devicePixelRatio);
    canvas.width = cw * data.w;
    canvas.height = ch * data.h;
    canvas.style.width = `${canvas.width / devicePixelRatio}px`;
    canvas.style.height = `${canvas.height / devicePixelRatio}px`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
  };

  const cell = (i, glyph, s) => {
    const x = (i % data.w) * cw;
    const y = Math.floor(i / data.w) * ch;
    ctx.fillStyle = s.bg;
    ctx.fillRect(x, y, cw, ch);
    if (glyph === " ") return;
    ctx.fillStyle = s.fg;
    if (shapes[glyph]) {
      for (const [a, b, w, h] of shapes[glyph]) ctx.fillRect(x + a * cw, y + Math.round(b * ch), Math.ceil(w * cw), Math.ceil(h * ch));
      return;
    }
    if (shades[glyph]) {
      ctx.globalAlpha = shades[glyph];
      ctx.fillRect(x, y, cw, ch);
      ctx.globalAlpha = 1;
      return;
    }
    ctx.font = `${s.bold ? "bold " : ""}${Math.round(ch * 0.78)}px ${font}`;
    ctx.fillText(glyph, x + cw / 2, y + ch / 2);
  };

  const grid = new Array(data.w * data.h);
  const draw = (n) => {
    const delta = data.frames[n] ?? [];
    for (let k = 0; k < delta.length; k += 3) {
      grid[delta[k]] = [delta[k + 1], styles[delta[k + 2]]];
      cell(delta[k], delta[k + 1], styles[delta[k + 2]]);
    }
  };
  const repaint = () => {
    fit();
    grid.forEach((g, i) => g && cell(i, g[0], g[1]));
  };
  fit();
  return { draw, repaint, frames: data.frames.length, fps: data.fps };
}

let playing = null;
let skipped = false;
let generation = 0;
let dismissed = false;

async function play() {
  if (playing || reduced) return playing;
  const ticket = ++generation;
  const data = await load();
  const screen = $("#screen");
  if (!data || ticket !== generation || playing) return;
  const layer = document.createElement("div");
  layer.className = "intro";
  const canvas = document.createElement("canvas");
  layer.append(canvas);
  screen.append(layer);
  const film = player(canvas, data, getComputedStyle(document.documentElement).getPropertyValue("--panel").trim());

  skipped = false;
  const stop = (e) => {
    if (!e.metaKey && !e.ctrlKey) skipped = true;
  };
  layer.addEventListener("click", stop);
  addEventListener("keydown", stop);
  addEventListener("resize", film.repaint);

  playing = (async () => {
    screen.focus({ preventScroll: true });
    const start = performance.now();
    for (let n = 0; n < film.frames && !skipped; ) {
      film.draw(n++);
      const next = start + (n * 1000) / (film.fps * SPEED);
      await new Promise((r) => setTimeout(r, Math.max(0, next - performance.now())));
    }
    for (let t = 0; t < HOLD && !skipped; t += 100) await sleep(100);
    layer.classList.add("out");
    await sleep(FADE);
    layer.remove();
    removeEventListener("resize", film.repaint);
    removeEventListener("keydown", stop);
    playing = null;
    $("#cmd").focus({ preventScroll: true });
  })();
  return playing;
}

function onFirstView(el, run) {
  const seen = () => {
    const r = el.getBoundingClientRect();
    return r.top < innerHeight * 0.75 && r.bottom > innerHeight * 0.25;
  };
  const check = () => {
    if (!seen()) return;
    removeEventListener("scroll", check);
    run();
  };
  addEventListener("scroll", check, { passive: true });
  check();
}

export const intro = {
  play,
  get playing() {
    return playing !== null;
  },
  async skip() {
    dismissed = true;
    generation++;
    skipped = true;
    await playing;
  },
  whenSeen: () => onFirstView($("#term"), () => dismissed || play()),
};
