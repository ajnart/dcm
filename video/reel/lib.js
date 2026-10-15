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

// One stroke weight for every UI glyph the reel draws (24 px grid, 2 px round strokes, no fills).
const glyph = (d) => `<svg class="gl" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const ICON = {
  lock: glyph(`<rect x="5" y="11" width="14" height="9" rx="2"/><path class="sh" d="M8 11V8a4 4 0 0 1 8 0v3"/>`),
  key: glyph(`<circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v3M21 12v2"/>`),
  check: glyph(`<path d="M5 12.5l4.5 4.5L19 7.5"/>`),
  arrow: glyph(`<path d="M5 12h14M13 6l6 6-6 6"/>`),
};

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
// Vaultwarden's own mark is black, which vanishes on the reel's dark tiles; dashboard-icons ships a light variant
const LIGHT = { vaultwarden: "vaultwarden-light" };
export const appIcon = (id) => icon(LIGHT[id] || id);
export const agentLogo = (name) => `assets/agents/${name}.svg`;

// Readability contract: every element meant to be read declares the window in which it must sit
// fully legible, opaque, unoverlapped and steady. lint (render.mjs) checks the window is long enough,
// then samples it. A sentence needs 0.4 s + 0.25 s per word once it has landed; a phrase of one to
// three words needs 0.4 s. Steady allows a slow camera drift, never a fast move (main.js lintRead).
// Text that is not meant to be read sits under [data-deco].
export const READS = [];
export const countWords = (s) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
export const needHold = (s) => (countWords(s) <= 3 ? 0.4 : 0.4 + 0.25 * countWords(s));

// Beat contract: scenes declare what happens on the beats and where the picture cuts. lint requires
// every cut on the beat grid and reports beats with no event; sound cues may fall anywhere.
export const BEATS = [];
export const CUTS = [];
export const on = (t, what) => BEATS.push({ t: +t.toFixed(4), what });
export const cut = (t, what) => { CUTS.push({ t: +t.toFixed(4), what }); on(t, what); };
export function read(el, a, b, label) {
  const els = typeof el === "string" ? [...document.querySelectorAll(el)] : Array.isArray(el) ? el : [el];
  if (!els.length) throw new Error(`read(): nothing matches ${el}`);
  els.forEach((e) => READS.push({ el: e, a, b, label: label || e.id || e.className }));
}

// Sound cues: scenes register them while they build, render.mjs cues writes them to audio/cues.json.
export const CUES = [];
export const cue = (t, kind, o = {}) => CUES.push({ t: +t.toFixed(4), kind, ...o });
let keyN = 0;
export function typeCues(text, a, b) {
  const n = text.length;
  for (let i = 0; i < n; i++) if (text[i] !== " ") cue(a + ((i + 0.5) / n) * (b - a), "key", { i: keyN++ });
}

// a camera that never stops: a slow sine-eased push (and pan) over [a, b] on an element nothing else moves
export function drift(el, a, b, { s0 = 1, s1 = 1.035, x0 = 0, x1 = 0, y0 = 0, y1 = 0, origin = "50% 50%" } = {}) {
  el.style.transformOrigin = origin;
  const e = gsap.parseEase("sine.inOut");
  proc((t) => {
    const p = e(prog(t, a, b));
    el.style.transform = `translate(${lerp(x0, x1, p).toFixed(3)}px, ${lerp(y0, y1, p).toFixed(3)}px) scale(${lerp(s0, s1, p).toFixed(5)})`;
  });
}

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

// a line that reveals word by word from a to b (no sound: the music carries the beat)
export function reveal(el, a, b) {
  const ws = el.querySelectorAll(".rv");
  proc((t) => {
    const n = Math.round(ws.length * prog(t, a, b));
    ws.forEach((w, i) => { w.style.visibility = i < n ? "visible" : "hidden"; });
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
