import { $, proc, clamp, scene, chars, read, cue, typeCues, on, cut, drift } from "../lib.js";
import { SC, DUR, b } from "./timeline.js";
import { END_INSTALL } from "../end.js";

const [A] = SC.end;
// beats: 0 the final hit, the logo · 1 the install line types · 2.5 self-host.fyi · 3 "Or ask your agent."; still from
// SETTLED but for the caret and a slow push
const T = { logo: A, cmd: A + b(1), type: [A + b(1) + 0.15, A + b(1) + 0.75], url: A + b(2.5), or: A + b(3) };
export const SETTLED = T.or + 0.6;

export function build(tl) {
  scene("endsc", A, DUR + 1);
  cut(A, "end card");
  drift($("#end-cam"), A, DUR, { s0: 1, s1: 1.035 });
  const end = $("#end");
  end.innerHTML = `
    <div class="e-lock"><div class="e-dia"><svg viewBox="0 0 100 100"><path d="M50 2 98 50 50 98 2 50Z"/></svg></div><div class="e-wm" id="e-wm">self-host</div></div>
    <div class="e-cmd"><div class="e-cmdin" id="e-cmd"><span class="pr">$</span><span id="e-cmd-t"></span><span class="caret" id="e-caret"></span></div></div>
    <div class="e-url" id="e-url">self-host.fyi</div>
    <div class="e-or" id="e-or">Or ask your agent.</div>`;
  const letters = chars($("#e-wm"));
  tl.fromTo(".e-dia", { scale: 0, rotation: -90 }, { scale: 1, rotation: 0, duration: 0.6, ease: "expo.out" }, T.logo);
  letters.forEach((c, i) => tl.fromTo(c, { yPercent: 115 }, { yPercent: 0, duration: 0.45, ease: "expo.out" }, T.logo + 0.04 + i * 0.015));
  cue(T.logo, "impact", { size: 1 });

  tl.fromTo("#e-cmd", { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 0.4, ease: "expo.out" }, T.cmd);
  const cmdT = $("#e-cmd-t"), caret = $("#e-caret");
  proc((t) => {
    const n = Math.round(END_INSTALL.length * clamp((t - T.type[0]) / (T.type[1] - T.type[0])));
    cmdT.textContent = END_INSTALL.slice(0, n).replace(/ /g, "\u00a0");
    caret.style.visibility = t >= T.type[0] && t < T.type[1] ? "visible" : Math.floor((t - T.cmd) * 2.4) % 2 === 0 ? "visible" : "hidden";
  });
  typeCues(END_INSTALL, T.type[0], T.type[1]);
  cue(T.cmd, "zip");

  tl.fromTo("#e-url", { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: "expo.out" }, T.url);
  tl.fromTo("#e-or", { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: "expo.out" }, T.or);
  cue(T.url, "success");
  cue(T.or, "tick");
  on(T.cmd, "install line");
  on(T.url, "self-host.fyi");
  on(T.or, "or ask your agent");
  read("#e-wm", T.logo + 0.04 + letters.length * 0.015 + 0.45, DUR, "end wordmark");
  read("#e-cmd-t", T.type[1] + 0.01, DUR, "install line");
  read("#e-url", T.url + 0.46, DUR, "self-host.fyi");
  read("#e-or", T.or + 0.46, DUR, "or ask your agent");
}
