import { $, $$, scene, icon, read, cue, on, cut, drift, ICON } from "../lib.js";
import { SC, b } from "./timeline.js";
import { HOME } from "./data.js";

const [A, B] = SC.hook;
// beats: 0 "Replace the SaaS" · 1 "you pay for." · the five rented tiles fly in from beyond the frame behind the
// headline, dim, and lock one after the other from beat 2.5; the headline holds to the cut
const T = { first: b(0), second: b(1), fly: b(0), lock: b(2.5) };
const TILES = [
  { face: `<img src="${icon("google-photos")}">`, edge: [150, 170] },
  { face: `<img src="${icon("google-drive")}">`, edge: [1770, 170] },
  { face: `<img src="${icon("dropbox")}">`, edge: [150, 910] },
  { face: `<img src="${icon("uptimerobot")}">`, edge: [1770, 910] },
  { face: `<div class="gi">${HOME}</div>`, edge: [960, 985] },
];

export function build(tl) {
  scene("shook", A, B);
  cut(A, "Replace the SaaS");
  drift($("#shook-cam"), A, B, { s0: 1, s1: 1.045 });
  const layer = $("#sh-tiles");
  TILES.forEach((tile, i) => {
    const el = document.createElement("div");
    el.className = "tile";
    el.innerHTML = `<div class="flip"><div class="face front">${tile.face}<div class="lock">${ICON.lock}</div></div></div>`;
    layer.appendChild(el);
    const [ex, ey] = tile.edge;
    const dx = ex - 960, dy = ey - 540, len = Math.hypot(dx, dy) || 1;
    const sx = ex + (dx / len) * 900, sy = ey + (dy / len) * 900;
    const rot = ((i * 37) % 60) - 30;
    tl.fromTo(el, { x: sx, y: sy, scale: 0.9, rotation: rot, opacity: 0.45 }, { x: ex, y: ey, scale: 0.6, rotation: rot * 0.25, opacity: 0.45, duration: 1.3, ease: "expo.out" }, T.fly + i * 0.04);
    tl.fromTo($(".lock", el), { scale: 0, rotation: -90 }, { scale: 1, rotation: 0, duration: 0.3, ease: "expo.out" }, T.lock + i * 0.1);
    cue(T.lock + i * 0.1, "lock", { i });
  });
  on(T.fly, "the rented tiles fly in");
  on(T.lock, "the tiles lock");
  cue(T.fly + 0.1, "whoosh", { dur: 0.9, soft: true });

  const ws = $$("#sh-t .w");
  [T.first, T.second].forEach((at, i) => {
    tl.fromTo(ws[i], { yPercent: 110, letterSpacing: "0.02em" }, { yPercent: 0, letterSpacing: "-0.055em", duration: 0.3, ease: "expo.out" }, at);
    cue(at, "slam", { g: 0.8 });
  });
  on(T.second, "you pay for.");
  read("#sh-t", T.second + 0.3, B - 0.01, "hook");
}
