import { $, $$, proc, prog, scene, icon, rng, read, cue } from "./lib.js";
import { PROJ_ICONS, ROW } from "./product.js";
import { SC, shown } from "./timeline.js";

const [A, B] = SC.preboot;
const NAMES = { qbittorrent: "qBittorrent", sonarr: "Sonarr", radarr: "Radarr", prowlarr: "Prowlarr", jellyfin: "Jellyfin", seerr: "Seerr", homarr: "Homarr" };
export const PULL = (i) => [A + 0.6 + i * 0.3, A + 1.08 + i * 0.3];
const RUSH = [B - 0.95, B - 0.25];
const Y = 600;

export function build(tl) {
  const root = scene("preboot", A, shown("preboot"));
  tl.fromTo(root, { clipPath: "circle(0px at 960px 865px)" }, { clipPath: "circle(2200px at 960px 865px)", duration: 0.5, ease: "power3.out" }, A);
  cue(A, "whoosh", { dur: 0.5, pan: 0 });

  const cv = $("#stars");
  const g = cv.getContext("2d", { willReadFrequently: true });
  const r = rng(11);
  const stars = Array.from({ length: 330 }, () => {
    const layer = r() < 0.5 ? 0 : r() < 0.6 ? 1 : 2;
    return { a: r() * Math.PI * 2, r0: r(), layer, hue: r(), w: 0.6 + r() * 1.4 };
  });
  const V = [0.09, 0.2, 0.42];
  proc((t) => {
    if (t < A || t > shown("preboot")) return;
    g.clearRect(0, 0, 1920, 1080);
    const bg = g.createRadialGradient(960, 540, 50, 960, 540, 1100);
    bg.addColorStop(0, "#150f2a");
    bg.addColorStop(1, "#05040a");
    g.fillStyle = bg;
    g.fillRect(0, 0, 1920, 1080);
    const age = t - A;
    const rush = Math.pow(prog(t, RUSH[0], RUSH[1]), 2);
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
  cue(RUSH[0] - 0.2, "riser", { dur: 0.75 });

  const dia = $("#pb-dia");
  tl.fromTo(dia, { scale: 0, rotation: -90 }, { scale: 1, rotation: 0, duration: 0.6, ease: "back.out(1.8)" }, A + 0.2);
  tl.fromTo(dia, { y: 0 }, { y: -6, duration: 1.4, ease: "sine.inOut", yoyo: true, repeat: 1 }, A + 0.8);
  tl.fromTo(dia, { opacity: 1 }, { opacity: 0, duration: 0.15 }, RUSH[0]);

  const q = $("#pb-quote .w");
  // no whitespace text nodes between the word spans: GSAP re-inserts hidden targets before nextElementSibling and would shuffle them
  q.innerHTML = q.textContent.trim().split(/\s+/).map((w) => `<span class="ww">${w}</span>`).join("");
  const ws = $$(".ww", q);
  const qIn = A + 0.35, qOut = RUSH[0] - 0.2;
  ws.forEach((w, i) => {
    tl.fromTo(w, { yPercent: 190, rotation: 3 }, { yPercent: 0, rotation: 0, duration: 0.55, ease: "expo.out" }, qIn + i * 0.065);
    tl.fromTo(w, { yPercent: 0 }, { yPercent: -190, duration: 0.3, ease: "power3.in" }, qOut + i * 0.02);
  });
  read("#pb-quote", qIn + 0.2 + 0.6, qOut, "quote");

  const rings = [];
  PROJ_ICONS.forEach((id, i) => {
    const [x] = ROW[i];
    const el = document.createElement("div");
    el.className = "pb-app";
    el.innerHTML = `<div class="pb-box"><svg class="pb-ring" width="182" height="182" viewBox="0 0 182 182"><rect x="4" y="4" width="174" height="174" rx="50" pathLength="100" class="tr"/><rect class="rg" x="4" y="4" width="174" height="174" rx="50" pathLength="100" stroke-dasharray="100 100" stroke-dashoffset="100"/></svg><div class="pi"><img src="${icon(id)}"></div><div class="chk">✓</div></div><div class="pn">${NAMES[id]}</div>`;
    $("#pb-icons").appendChild(el);
    rings.push({ el, rg: $(".rg", el) });
    tl.fromTo(el, { x, y: 865 }, { x, y: Y, duration: 0.6, ease: "expo.out" }, A + 0.1);
    tl.fromTo($(".pn", el), { opacity: 0 }, { opacity: 1, duration: 0.3 }, A + 0.4);
    const [, p1] = PULL(i);
    tl.fromTo($(".chk", el), { scale: 0 }, { scale: 1, duration: 0.3, ease: "back.out(3)" }, p1);
    tl.fromTo($(".pb-box", el), { scale: 1 }, { scale: 1.1, duration: 0.14, ease: "power2.out", yoyo: true, repeat: 1 }, p1);
    tl.fromTo(el, { opacity: 1, scale: 1 }, { opacity: 0, scale: 1.6, duration: 0.35, ease: "power2.in" }, RUSH[0] + 0.1 + Math.abs(i - 3) * 0.03);
    cue(p1, "check", { i });
  });
  read($$("#pb-icons .pn"), A + 0.75, RUSH[0] + 0.1, "App names");

  tl.fromTo("#pb-bar", { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.5, ease: "expo.out" }, A + 0.45);
  tl.fromTo("#pb-bar", { opacity: 1 }, { opacity: 0, duration: 0.25 }, RUSH[0] + 0.1);
  read("#pb-label", A + 1.0, RUSH[0] + 0.1);
  proc((t) => {
    let sum = 0, done = 0;
    rings.forEach((rg, i) => {
      const [p0, p1] = PULL(i);
      const p = prog(t, p0, p1);
      const e = p * (2 - p);
      sum += e;
      if (p >= 1) done++;
      rg.rg.setAttribute("stroke-dashoffset", String(100 * (1 - e)));
      rg.rg.setAttribute("stroke", p >= 1 ? "#00d787" : "#a88df2");
    });
    $("#pb-fill").style.width = `${(sum / 7) * 100}%`;
    $("#pb-n").textContent = `${done} of 7 images`;
    $("#pb-spin").textContent = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"[Math.floor(t * 20) % 10];
  });
}
