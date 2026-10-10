import { $, $$, proc, scene, read, on, cut } from "./lib.js";
import { SC, BEAT } from "./timeline.js";

const [A, B] = SC.flurry;
// one phrase per beat over the track's biggest riser, each a hard cut; the bar under them fills a
// quarter per beat and the next downbeat is the logo
export const PHRASES = [
  ["Your", "hardware."],
  ["Your", "rules."],
  ["No", "rent."],
  ["Your", "data."],
];
const IN = 0.08;

export function build(tl) {
  scene("flurry", A, B);
  $("#fl-words").innerHTML = PHRASES.map(([a, z], i) => `<div class="fp${i === 2 ? " red" : ""}" id="fp${i}"><span class="mk"><span class="w">${a} <b>${z}</b></span></span></div>`).join("");
  const bar = $("#fl-bar i");
  $$(".fp").forEach((p, i) => {
    const at = A + i * BEAT, end = at + BEAT;
    proc((t) => { p.style.visibility = t >= at && t < end ? "visible" : "hidden"; });
    tl.fromTo($(".w", p), { yPercent: 160 }, { yPercent: 0, duration: IN, ease: "expo.out" }, at);
    tl.fromTo(bar, { scaleX: i / 4 }, { scaleX: (i + 1) / 4, duration: IN, ease: "expo.out" }, at);
    cut(at, PHRASES[i].join(" "));
    read(p, at + IN, end - 0.01, PHRASES[i].join(" "));
  });
  on(A, "flurry");
}
