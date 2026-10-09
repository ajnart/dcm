import { gsap, $, $$, proc, procs, rng, track } from "./lib.js";
import * as s1 from "./s1.js";
import * as s3 from "./s3.js";
import * as s4 from "./s4.js";
import * as s5 from "./s5.js";
import * as s6 from "./s6.js";
import * as s7 from "./s7.js";
import * as s8 from "./s8.js";

gsap.ticker.sleep();
gsap.config({ force3D: false });
gsap.registerPlugin(window.CustomEase);
const tl = gsap.timeline({ paused: true, defaults: { immediateRender: false } });

track(tl);
s1.build(tl);
s3.build(tl);
s4.build(tl);
s5.build(tl);
s6.build(tl);
s7.build(tl);
s8.build(tl);
tl.finalize();

const SHAKES = [[1.9, 7], [3.3, 4], [4.32, 16], [6.16, 9]];
proc((t) => {
  let x = 0, y = 0;
  for (const [t0, a] of SHAKES) {
    const d = t - t0;
    if (d < 0 || d > 0.5) continue;
    const e = Math.exp(-d * 11) * a;
    x += Math.sin(d * 85) * e;
    y += Math.cos(d * 71) * e * 0.8;
  }
  $$(".scene").forEach((s) => { s.style.transform = x || y ? `translate(${x.toFixed(2)}px,${y.toFixed(2)}px)` : "none"; });
});

(() => {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const im = g.createImageData(256, 256);
  const r = rng(7);
  for (let i = 0; i < im.data.length; i += 4) {
    const v = Math.floor(r() * 255);
    im.data[i] = im.data[i + 1] = im.data[i + 2] = v;
    im.data[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  $("#grain").style.backgroundImage = `url(${c.toDataURL()})`;
  proc((t) => {
    const f = Math.floor(t * 24);
    $("#grain").style.transform = `translate(${(f * 37) % 64}px, ${(f * 53) % 64}px)`;
  });
})();

window.seek = (t) => {
  tl.time(t, false);
  for (const p of procs) p(t);
};

window.lint = () => {
  const out = [];
  const margin = 56;
  $$("#hook .w, #wallhead .w, #s3-cap .w, #cmd, #pb-quote .ww, #pivot .w, .e-cmdin, .e-stats, .e-ag, .safe").forEach((el) => {
    const sc = el.closest(".scene");
    if (!sc || getComputedStyle(sc).display === "none") return;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden") return;
    const rg = document.createRange();
    rg.selectNodeContents(el);
    const r = rg.getBoundingClientRect();
    if (r.width === 0) return;
    if (r.left < margin - 1 || r.right > 1920 - margin + 1) out.push({ el: el.id || el.className || el.tagName, text: el.textContent.slice(0, 24), l: Math.round(r.left), r: Math.round(r.right) });
  });
  return out;
};

const faces = [
  '800 100px "Inter Tight Variable"', '700 100px "Inter Tight Variable"', '500 100px "Inter Tight Variable"',
  '800 100px "Unbounded Variable"', '600 100px "JetBrains Mono Variable"', '400 100px "JetBrains Mono Variable"', '800 100px "JetBrains Mono Variable"',
  '400 100px "Instrument Serif"', 'italic 400 100px "Instrument Serif"',
];
await Promise.all(faces.map((f) => document.fonts.load(f, "Aa Zz 0123 ◆ ⠋ ✓ ● ▶ →")));
await document.fonts.ready;
await Promise.all($$("img").map((i) => i.decode().catch(() => {})));
await window.__prepMosaic();
window.seek(0);
window.__ready = true;
