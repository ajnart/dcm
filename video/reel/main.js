import { gsap, $, $$, proc, procs, rng, track, prog, READS, CUES, countWords, needHold } from "./lib.js";
import { DUR, FPS, BPM, SC, SECTIONS } from "./timeline.js";
import * as hook from "./hook.js";
import * as product from "./product.js";
import * as preboot from "./preboot.js";
import * as setup from "./setup.js";
import * as links from "./links.js";
import * as board from "./board.js";
import * as pivot from "./pivot.js";
import * as agents from "./agents.js";
import * as end from "./end.js";

gsap.ticker.sleep();
gsap.config({ force3D: false });
const tl = gsap.timeline({ paused: true, defaults: { immediateRender: false } });

track(tl);
[hook, product, preboot, setup, links, board, pivot, agents, end].forEach((s) => s.build(tl));
tl.finalize();

// camera shakes only on the two impacts, and they settle before any text hold starts
const SHAKES = [[SC.product[0] + 0.55, 10], [SC.end[0] + 0.4, 7]];
proc((t) => {
  let x = 0, y = 0;
  for (const [t0, a] of SHAKES) {
    const d = t - t0;
    if (d < 0 || d > 0.45) continue;
    const e = Math.exp(-d * 13) * a;
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
  const grain = $("#grain");
  grain.style.backgroundImage = `url(${c.toDataURL()})`;
  proc((t) => {
    const f = Math.floor(t * 24);
    grain.style.transform = `translate(${(f * 37) % 64}px, ${(f * 53) % 64}px)`;
    // the end card's last seconds are a still frame: no grain either
    grain.style.opacity = String(0.07 * (1 - prog(t, end.SETTLED - 0.3, end.SETTLED)));
  });
})();

window.seek = (t) => {
  tl.time(t, false);
  for (const p of procs) p(t);
};

const visible = (el) => {
  const sc = el.closest(".scene");
  if (sc && getComputedStyle(sc).display === "none") return 0;
  let o = 1;
  for (let e = el; e && e !== document.body; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (cs.display === "none" || cs.visibility === "hidden") return 0;
    o *= +cs.opacity;
  }
  return o;
};
const textNodes = (root) => {
  const out = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (/\S/.test(n.textContent) ? 1 : 3) });
  for (let n; (n = w.nextNode());) out.push(n);
  return out;
};
// does e put pixels at (x, y)? Transparent layout wrappers (clip boxes, cameras, containers) do not.
const paints = (e, x, y) => {
  if (/^(IMG|CANVAS)$/.test(e.tagName) || (e instanceof SVGGraphicsElement && e.tagName !== "svg")) return true;
  const cs = getComputedStyle(e);
  if (cs.backgroundImage !== "none") return true;
  const bg = cs.backgroundColor.match(/[\d.]+/g);
  if (bg && (bg.length < 4 ? 1 : +bg[3]) > 0.05) return true;
  return [...e.childNodes].some((n) => {
    if (n.nodeType !== 3 || !/\S/.test(n.textContent)) return false;
    const r = rectOf(n);
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  });
};
const rectOf = (n) => {
  const rg = document.createRange();
  rg.selectNodeContents(n);
  return rg.getBoundingClientRect();
};

// readable text inside its hold must sit within the 56 px safe margin
window.lint = (t) => {
  const out = [];
  const margin = 56;
  READS.forEach(({ el, a, b }) => {
    if (t < a || t > b || !visible(el)) return;
    textNodes(el).forEach((n) => {
      const r = rectOf(n);
      if (r.width === 0 || visible(n.parentElement) < 0.5) return;
      if (r.left < margin - 1 || r.right > 1920 - margin + 1) out.push({ text: n.textContent.slice(0, 24), l: Math.round(r.left), r: Math.round(r.right) });
    });
  });
  return out;
};

// The words a viewer sees: text runs separated by a visible gap or a line break count as separate
// words, so per-word spans ("Let" "self-host") and per-line blocks ("learn" / "the") are not glued together.
const readText = (el) => {
  let out = "", prev = null;
  for (const n of textNodes(el)) {
    const pe = n.parentElement;
    const cs = getComputedStyle(pe);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const r = rectOf(n);
    if (prev && (r.left - prev.right > 0.12 * parseFloat(cs.fontSize) || r.top - prev.top > r.height * 0.5)) out += " ";
    out += n.textContent;
    prev = r;
  }
  return out.replace(/\s+/g, " ").trim();
};

// The readability contract (lib.js read()): sampled at 30 Hz through every declared hold.
window.lintRead = () => {
  const issues = [];
  const holds = READS.map((r) => ({ ...r, text: "", sig: null, bad: null }));
  holds.forEach((h) => {
    window.seek(h.a + 1e-4);
    h.raw = h.el.textContent.replace(/\s+/g, " ").trim();
    h.text = readText(h.el);
    h.words = countWords(h.text);
    h.need = needHold(h.text);
    if (h.b - h.a < h.need - 1e-6) issues.push({ kind: "hold too short", label: h.label, text: h.text.slice(0, 50), words: h.words, have: +(h.b - h.a).toFixed(2), need: +h.need.toFixed(2) });
  });
  const times = new Set();
  holds.forEach((h) => { for (let t = h.a; t <= h.b + 1e-9; t += 1 / 30) times.add(+t.toFixed(4)); times.add(+h.b.toFixed(4)); });
  for (const t of [...times].sort((x, y) => x - y)) {
    window.seek(Math.min(t, DUR - 1e-4));
    for (const h of holds) {
      if (h.bad || t < h.a - 1e-6 || t > h.b + 1e-6) continue;
      const fail = (why, extra = {}) => { h.bad = { kind: why, label: h.label, text: h.text.slice(0, 50), t: +t.toFixed(3), ...extra }; };
      const txt = h.el.textContent.replace(/\s+/g, " ").trim();
      if (txt !== h.raw) { fail("text changed", { now: txt.slice(0, 50) }); continue; }
      const nodes = textNodes(h.el).filter((n) => { const cs = getComputedStyle(n.parentElement); return cs.display !== "none" && cs.visibility !== "hidden"; });
      const sig = [];
      for (const n of nodes) {
        const pe = n.parentElement;
        const op = visible(pe);
        if (op < 0.97) { fail("not fully opaque", { opacity: +op.toFixed(2), word: n.textContent.slice(0, 20) }); break; }
        const r = rectOf(n);
        const size = parseFloat(getComputedStyle(pe).fontSize) * (pe.getBoundingClientRect().height / (pe.offsetHeight || pe.getBoundingClientRect().height));
        if (size < 31.5) { fail("smaller than 32 px", { px: +size.toFixed(1), word: n.textContent.slice(0, 20) }); break; }
        if (r.left < -1 || r.top < -1 || r.right > 1921 || r.bottom > 1081) { fail("off screen", { word: n.textContent.slice(0, 20) }); break; }
        sig.push([r.left, r.top, r.width, r.height]);
        // what sits on top of the word's centre must be the word itself
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const stack = document.elementsFromPoint(cx, cy);
        const top = stack.find((e) => e === pe || (visible(e) > 0.05 && !e.matches("#stage, html, body, .scene") && paints(e, cx, cy)));
        if (top && top !== pe && !pe.contains(top) && !top.contains(pe)) { fail("overlapped", { word: n.textContent.slice(0, 20), by: top.id || top.className || top.tagName }); break; }
      }
      if (h.bad) continue;
      if (!h.sig) h.sig = sig;
      else {
        let d = 0;
        sig.forEach((s, i) => { const o = h.sig[i] || s; for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs(s[k] - o[k])); });
        if (sig.length !== h.sig.length || d > 0.6) fail("moved", { px: +d.toFixed(2) });
      }
    }
  }
  holds.forEach((h) => { if (h.bad) issues.push(h.bad); });
  return { issues, holds: holds.map((h) => ({ label: h.label, text: h.text.slice(0, 60), a: h.a, b: h.b, words: h.words, need: +h.need.toFixed(2), have: +(h.b - h.a).toFixed(2) })) };
};

// every visible piece of text must be declared readable (read()) or decorative ([data-deco])
window.lintUndeclared = (t) => {
  window.seek(t);
  const out = [];
  const declared = READS.map((r) => r.el);
  $$(".scene").forEach((sc) => {
    if (getComputedStyle(sc).display === "none") return;
    textNodes(sc).forEach((n) => {
      const pe = n.parentElement;
      // symbols (✓ ● ◆ ⠋ ••••) are not text to read
      if (!/[\p{L}\p{N}]/u.test(n.textContent)) return;
      if (pe.closest("[data-deco]") || declared.some((d) => d === pe || d.contains(pe))) return;
      const r = rectOf(n);
      if (r.width < 1 || r.right < 0 || r.left > 1920 || r.bottom < 0 || r.top > 1080) return;
      if (visible(pe) < 0.05) return;
      out.push({ t, text: n.textContent.trim().slice(0, 30), in: pe.id || pe.className });
    });
  });
  return out;
};

window.__reads = READS;
window.lintHolds = () => READS.map(({ a, b, label }) => ({ a, b, label }));
window.cueSheet = () => ({ duration: DUR, fps: FPS, bpm: BPM, scenes: SC, sections: SECTIONS, cues: [...CUES].sort((a, b) => a.t - b.t) });

const faces = [
  '800 100px "Inter Tight Variable"', '700 100px "Inter Tight Variable"', '600 100px "Inter Tight Variable"', '500 100px "Inter Tight Variable"',
  '800 100px "Unbounded Variable"', '600 100px "JetBrains Mono Variable"', '400 100px "JetBrains Mono Variable"', '800 100px "JetBrains Mono Variable"',
  '400 100px "Instrument Serif"', 'italic 400 100px "Instrument Serif"',
];
await Promise.all(faces.map((f) => document.fonts.load(f, "Aa Zz 0123 ◆ ⠋ ✓ ● ▶ → › •")));
await document.fonts.ready;
await Promise.all($$("img").map((i) => i.decode().catch(() => {})));
await window.__prepMosaic();
window.seek(0);
window.__ready = true;
