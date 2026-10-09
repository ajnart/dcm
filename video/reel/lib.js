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

export function typed(el, text, a, b, ease = (p) => p) {
  proc((t) => {
    const n = Math.round(text.length * ease(prog(t, a, b)));
    el.textContent = text.slice(0, n);
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
