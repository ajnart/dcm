// The CLI Intro (internal/intro), as recorded for the website: 100×28 terminal cells, 24 fps, each frame a
// delta of [cell, glyph, style] triples. assets/intro.json is a copy of site/public/intro.json.
// paint(n) is a pure function of the frame index: it replays the deltas into a grid, then draws the grid.
// crop draws only the cells in [c0, c0 + w) × [r0, r0 + h).
const SHAPES = {
  "█": [[0, 0, 1, 1]],
  "▀": [[0, 0, 1, 0.5]],
  "▄": [[0, 0.5, 1, 0.5]],
  "─": [[0, 0.46, 1, 0.08]],
  "━": [[0, 0.42, 1, 0.16]],
  "│": [[0.45, 0, 0.1, 1]],
};
const SHADES = { "░": 0.25, "▒": 0.5, "▓": 0.75 };

export async function loadIntro() {
  return (await fetch("assets/intro.json")).json();
}

export function mountIntro(canvas, data, { cw, base, font, crop = { c0: 0, r0: 0, w: data.w, h: data.h } }) {
  const ch = Math.round(cw * (1.25 / 0.6));
  canvas.width = cw * crop.w;
  canvas.height = ch * crop.h;
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  const styles = data.styles.map((key) => {
    const [fg, bg, bold] = key.split("|");
    return { fg: fg || "#e4e4e4", bg: bg || base, bold: bold === "b" };
  });
  const cell = (i, glyph, s) => {
    const c = (i % data.w) - crop.c0, r = Math.floor(i / data.w) - crop.r0;
    if (c < 0 || r < 0 || c >= crop.w || r >= crop.h) return;
    const x = c * cw;
    const y = r * ch;
    ctx.fillStyle = s.bg;
    ctx.fillRect(x, y, cw, ch);
    if (glyph === " ") return;
    ctx.fillStyle = s.fg;
    if (SHAPES[glyph]) {
      for (const [a, b, w, h] of SHAPES[glyph]) ctx.fillRect(x + a * cw, y + Math.round(b * ch), Math.ceil(w * cw), Math.ceil(h * ch));
      return;
    }
    if (SHADES[glyph]) {
      ctx.globalAlpha = SHADES[glyph];
      ctx.fillRect(x, y, cw, ch);
      ctx.globalAlpha = 1;
      return;
    }
    ctx.font = `${s.bold ? "bold " : ""}${Math.round(ch * 0.78)}px ${font}`;
    ctx.fillText(glyph, x + cw / 2, y + ch / 2);
  };
  let shown = -2;
  const grid = new Array(data.w * data.h);
  const last = data.frames.length - 1;
  return {
    frames: data.frames.length,
    fps: data.fps,
    paint(n) {
      n = Math.max(-1, Math.min(last, n));
      if (n === shown) return;
      if (n < shown) grid.fill(undefined);
      if (n < shown || shown < -1) {
        ctx.fillStyle = base;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        shown = -1;
      }
      for (; shown < n; ) {
        const delta = data.frames[++shown];
        for (let k = 0; k < delta.length; k += 3) grid[delta[k]] = [delta[k + 1], styles[delta[k + 2]]];
      }
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      grid.forEach((g, i) => g && cell(i, g[0], g[1]));
    },
  };
}
