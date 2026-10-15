import { $, $$, proc, prog, lerp, scene, read, cue, on, cut, eOut } from "./lib.js";
import { SC, BEAT } from "./timeline.js";

const [A, B] = SC.flurry;
// one phrase per beat over the track's biggest riser, each a hard cut into its own composition: a slam
// from scale, a whip from either side, a flood of violet; then a slow push until the next cut
export const PHRASES = [
  { a: "Your", z: "hardware.", size: 250, align: "c", from: { s: 1.6 }, ink: "#f5f5f5", bg: "#09080f" },
  { a: "Your", z: "rules.", size: 300, align: "l", from: { x: -520 }, ink: "#09080f", bg: "#7a57d3" },
  { a: "Your", z: "data.", size: 290, align: "c", from: { s: 0.55 }, ink: "#f5f5f5", bg: "#09080f", accent: "#a88df2" },
  { a: "No", z: "rent.", size: 380, align: "r", from: { x: 520 }, ink: "#f5f5f5", bg: "#09080f" },
];
const IN = 0.08;

export function build() {
  scene("flurry", A, B);
  const bg = $("#fl-bg");
  $("#fl-words").innerHTML = PHRASES.map((p, i) => `<div class="fp ${p.align === "l" ? "" : p.align}" id="fp${i}" style="font-size:${p.size}px;color:${p.ink}"><span class="w">${p.a} <b${p.accent ? ` style="color:${p.accent}"` : ""}>${p.z}</b></span></div>`).join("");
  $$(".fp").forEach((el, i) => {
    const p = PHRASES[i], at = A + i * BEAT, end = at + BEAT, w = $(".w", el);
    w.style.display = "inline-block";
    w.style.transformOrigin = p.align === "l" ? "0% 50%" : p.align === "r" ? "100% 50%" : "50% 50%";
    proc((t) => {
      const on = t >= at && t < end;
      el.style.visibility = on ? "visible" : "hidden";
      if (!on) return;
      bg.style.background = p.bg;
      const k = eOut(prog(t, at, at + IN));
      const drift = prog(t, at + IN, end);
      const s = lerp(p.from.s ?? 1, 1, k) * lerp(1, 1.045, drift);
      const x = lerp(p.from.x ?? 0, 0, k) + (p.from.x ? -Math.sign(p.from.x) * 40 * drift : 0);
      w.style.transform = `translateX(${x.toFixed(2)}px) scale(${s.toFixed(4)})`;
    });
    cut(at, `${p.a} ${p.z}`);
    cue(at, "slam", { g: i === 3 ? 1.1 : 0.9, pan: p.align === "l" ? -0.4 : p.align === "r" ? 0.4 : 0 });
    if (p.from.x) cue(at, "whoosh", { dur: 0.2, pan: -Math.sign(p.from.x) * 0.6, soft: true });
    read(el, at + IN, end - 0.01, `${p.a} ${p.z}`);
  });
  on(A, "flurry");
}
