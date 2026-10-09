import { gsap, $, $$, proc, prog, clamp, scene, icon, rng, p3o } from "./lib.js";
import { PROJ_ICONS, ROW } from "./s3.js";

const NAMES = ["qbittorrent", "sonarr", "radarr", "prowlarr", "jellyfin", "seerr", "homarr"];
const A = 7.0, B = 10.06;
export const PULL = (i) => [7.62 + i * 0.3, 8.0 + i * 0.3 + 0.18];

export function build(tl) {
  const root = scene("s4", A, B);
  tl.fromTo(root, { clipPath: "circle(0px at 960px 865px)" }, { clipPath: "circle(2200px at 960px 865px)", duration: 0.5, ease: "power3.out" }, A);

  const cv = $("#stars");
  const g = cv.getContext("2d", { willReadFrequently: true });
  const r = rng(11);
  const stars = Array.from({ length: 330 }, () => {
    const layer = r() < 0.5 ? 0 : r() < 0.6 ? 1 : 2;
    return { a: r() * Math.PI * 2, r0: r(), layer, hue: r(), w: 0.6 + r() * 1.4 };
  });
  const V = [0.09, 0.2, 0.42];
  proc((t) => {
    if (t < A || t > B) return;
    g.clearRect(0, 0, 1920, 1080);
    const bg = g.createRadialGradient(960, 540, 50, 960, 540, 1100);
    bg.addColorStop(0, "#150f2a");
    bg.addColorStop(1, "#05040a");
    g.fillStyle = bg;
    g.fillRect(0, 0, 1920, 1080);
    const age = t - A;
    const rush = Math.pow(prog(t, 9.55, 10.0), 2);
    g.lineCap = "round";
    for (const s of stars) {
      const rr = (s.r0 + V[s.layer] * age + rush * 0.5 * (s.layer + 1) * 0.5) % 1;
      const d = Math.pow(rr, 1.7) * 1500 + 10;
      const len = 4 + d * (0.025 + rush * 0.55) * (1 + s.layer * 0.6);
      const ca = Math.cos(s.a), sa = Math.sin(s.a);
      const alpha = Math.min(1, rr * 4) * (0.35 + s.layer * 0.28);
      g.strokeStyle = s.hue < 0.3 ? `rgba(168,141,242,${alpha})` : `rgba(235,230,255,${alpha})`;
      g.lineWidth = s.w * (0.6 + rr * 1.7) * (s.layer === 2 ? 1.4 : 1);
      g.beginPath();
      g.moveTo(960 + ca * (d - len), 540 + sa * (d - len) * 0.78);
      g.lineTo(960 + ca * d, 540 + sa * d * 0.78);
      g.stroke();
    }
  });

  const dia = $("#pb-dia");
  tl.fromTo(dia, { scale: 0, rotation: -90 }, { scale: 1, rotation: 0, duration: 0.6, ease: "back.out(1.8)" }, A + 0.25);
  tl.fromTo(dia, { y: 0 }, { y: -4, duration: 1.4, ease: "sine.inOut", yoyo: true, repeat: 1 }, A + 0.9);
  tl.fromTo(dia, { opacity: 1 }, { opacity: 0, duration: 0.12 }, 9.85);

  const q = $("#pb-quote .w");
  // no whitespace text nodes between the word spans: GSAP re-inserts hidden targets before nextElementSibling and would shuffle them
  q.innerHTML = q.textContent.trim().split(/\s+/).map((w) => `<span class="ww">${w}</span>`).join("");
  const ws = $$(".ww", q);
  ws.forEach((w, i) => {
    tl.fromTo(w, { yPercent: 190, rotation: 3 }, { yPercent: 0, rotation: 0, duration: 0.55, ease: "expo.out" }, 7.3 + i * 0.065);
    tl.fromTo(w, { yPercent: 0 }, { yPercent: -190, duration: 0.3, ease: "power3.in" }, 9.62 + i * 0.02);
  });
  const rings = [];
  NAMES.forEach((id, i) => {
    const [x] = ROW[i];
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;left:0;top:0;width:150px;height:150px;margin:-75px 0 0 -75px;";
    el.innerHTML = `<div class="pi" style="left:0;top:0"><img src="${icon(id)}"></div>
      <svg width="190" height="190" viewBox="0 0 190 190" style="position:absolute;left:-20px;top:-20px;overflow:visible"><circle cx="95" cy="95" r="92" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="5"/><circle class="rg" cx="95" cy="95" r="92" fill="none" stroke="#a88df2" stroke-width="5" stroke-linecap="round" transform="rotate(-90 95 95)" stroke-dasharray="578" stroke-dashoffset="578"/></svg>
      <div class="chk">✓</div><div class="pn">${id}</div>`;
    $("#pb-icons").appendChild(el);
    rings.push({ el, rg: $(".rg", el), chk: $(".chk", el) });
    tl.fromTo(el, { x, y: 865, scale: 1 }, { x, y: 668, scale: 1, duration: 0.6, ease: "expo.out" }, A + 0.1);
    const [p0, p1] = PULL(i);
    tl.fromTo($(".chk", el), { scale: 0 }, { scale: 1, duration: 0.3, ease: "back.out(3)" }, p1);
    tl.fromTo(el, { scale: 1 }, { scale: 1.12, duration: 0.14, ease: "power2.out", yoyo: true, repeat: 1 }, p1);
    tl.fromTo(el, { yPercent: 0 }, { yPercent: 0, duration: 0.001 }, p1);
  });
  tl.fromTo("#pb-bar", { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.5, ease: "expo.out" }, A + 0.45);
  proc((t) => {
    let sum = 0, done = 0;
    rings.forEach((rg, i) => {
      const [p0, p1] = PULL(i);
      const p = prog(t, p0, p1);
      const e = p * (2 - p);
      sum += e;
      if (p >= 1) done++;
      rg.rg.setAttribute("stroke-dashoffset", String(578 * (1 - e)));
      rg.rg.setAttribute("stroke", p >= 1 ? "#00d787" : "#a88df2");
    });
    $("#pb-fill").style.width = `${(sum / 7) * 100}%`;
    $("#pb-n").textContent = `${done} of 7 images`;
    $("#pb-spin").textContent = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"[Math.floor(t * 20) % 10];
  });
}
