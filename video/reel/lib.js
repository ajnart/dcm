export const gsap = window.gsap;
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const prog = (t, a, b) => clamp((t - a) / (b - a));
export const lerp = (a, b, p) => a + (b - a) * p;
export const ez = (n) => gsap.parseEase(n);
export const eOut = ez("expo.out");
export const p3o = ez("power3.out");
export const p3io = ez("power3.inOut");
export const p2io = ez("power2.inOut");
export const bOut = ez("back.out(1.6)");

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export const procs = [];
export const proc = (fn) => procs.push(fn);

export const icon = (name, ext = "svg") => `assets/icons/${name}.${ext}`;
export const agentLogo = (name) => `assets/agents/${name}.svg`;

// Readability contract: every element meant to be read declares the window in which it must sit
// fully legible, opaque, unoverlapped and still. lint (render.mjs) checks the window is at least
// 0.6 s + 0.3 s per word, then samples it. Text that is not meant to be read sits under [data-deco].
export const READS = [];
export const countWords = (s) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
export const needHold = (s) => 0.6 + 0.3 * countWords(s);
export function read(el, a, b, label) {
  const els = typeof el === "string" ? [...document.querySelectorAll(el)] : Array.isArray(el) ? el : [el];
  if (!els.length) throw new Error(`read(): nothing matches ${el}`);
  els.forEach((e) => READS.push({ el: e, a, b, label: label || e.id || e.className }));
}

// Sound cues: scenes register them while they build, render.mjs cues writes them to audio/cues.json.
export const CUES = [];
export const cue = (t, kind, o = {}) => CUES.push({ t: +t.toFixed(4), kind, ...o });

export function scene(id, a, b) {
  const el = document.getElementById(id);
  proc((t) => {
    el.style.display = t >= a && t < b ? "block" : "none";
  });
  return el;
}

export function words(el, cls = "w") {
  const parts = [];
  const walk = (node) => {
    [...node.childNodes].forEach((n) => {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach((tok) => {
          if (!tok) return;
          if (/^\s+$/.test(tok)) frag.appendChild(document.createTextNode(" "));
          else {
            const s = document.createElement("span");
            s.className = cls;
            s.textContent = tok;
            frag.appendChild(s);
            parts.push(s);
          }
        });
        n.replaceWith(frag);
      } else if (n.nodeType === 1 && !n.classList.contains(cls)) walk(n);
    });
  };
  walk(el);
  return parts;
}

export function chars(el, cls = "c") {
  const parts = [];
  const text = el.textContent;
  el.textContent = "";
  [...text].forEach((ch) => {
    const s = document.createElement("span");
    s.className = cls;
    s.textContent = ch === " " ? "\u00a0" : ch;
    el.appendChild(s);
    parts.push(s);
  });
  return parts;
}

export function typed(el, text, a, b) {
  proc((t) => {
    const n = Math.round(text.length * prog(t, a, b));
    el.textContent = text.slice(0, n);
  });
  typeCues(text, a, b);
}

// one key click per visible character, at the moment it appears (n = round(len * p))
export function typeCues(text, a, b, kind = "key") {
  [...text].forEach((ch, i) => {
    if (ch === " ") return;
    cue(a + ((i + 0.5) / text.length) * (b - a), kind, { i });
  });
}

export function measure(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
}

export const diamond = (cx, cy, r) => `polygon(${cx}px ${cy - r}px, ${cx + r}px ${cy}px, ${cx}px ${cy + r}px, ${cx - r}px ${cy}px)`;

const SKIP = new Set(["ease", "duration", "yoyo", "repeat", "repeatDelay", "delay", "stagger", "transformOrigin", "overwrite", "immediateRender", "onUpdate", "onStart", "onComplete", "force3D", "willChange"]);
export function track(tl) {
  const first = new Map();
  const orig = tl.fromTo.bind(tl);
  tl.fromTo = (targets, from, to, pos) => {
    const start = typeof pos === "number" ? pos : 0;
    gsap.utils.toArray(targets).forEach((el) => {
      let m = first.get(el);
      if (!m) first.set(el, (m = new Map()));
      for (const k of Object.keys(from)) {
        if (SKIP.has(k)) continue;
        const cur = m.get(k);
        if (!cur || start < cur.start) m.set(k, { start, v: from[k] });
      }
    });
    return orig(targets, from, to, pos);
  };
  tl.finalize = () => {
    first.forEach((m, el) => {
      const vars = {};
      m.forEach((o, k) => { vars[k] = o.v; });
      gsap.set(el, vars);
    });
  };
}
