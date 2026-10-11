import { $, proc, clamp, prog, scene, chars, read, cue, typeCues, on, cut, drift, p3o } from "./lib.js";
import { SC, DUR, b } from "./timeline.js";

const [A] = SC.end;
export const END_INSTALL = "curl -fsSL https://selfhost.ajnart.dev/install.sh | bash";
export const END_REPO = "github.com/ajnart/selfhost";
// beats: 0 the final hit, the logo · 1 the install line types · 2 the agents · 3 the counts run up;
// still from SETTLED but for the caret and a slow push
const T = { logo: b(60), cmd: b(61), type: [b(61) + 0.15, b(61) + 0.75], agents: b(62), stats: b(63) };
export const SETTLED = T.stats + 0.6;
const COUNTS = [93, 20, 1];

export function build(tl) {
  scene("endsc", A, DUR + 1);
  cut(A, "end card");
  drift($("#end-cam"), A, DUR, { s0: 1, s1: 1.035 });
  const end = $("#end");
  end.innerHTML = `
    <div class="e-lock"><div class="e-dia"><svg viewBox="0 0 100 100"><path d="M50 2 98 50 50 98 2 50Z"/></svg></div><div class="e-wm" id="e-wm">self-host</div></div>
    <div class="e-cmd"><div class="e-cmdin" id="e-cmd"><span class="pr">$</span><span id="e-cmd-t"></span><span class="caret" id="e-caret"></span></div></div>
    <div class="e-ag" id="e-ag">Claude Code <i>·</i> Codex <i>·</i> OpenChamber <i>·</i> Hermes Agent <i>·</i> OpenCode <i>·</i> Pi</div>
    <div class="e-stats" id="e-stats"><span><b id="e-n0">93</b> Apps</span><i>·</i><span><b id="e-n1">20</b> Recipes</span><i>·</i><span><b id="e-n2">1</b> binary</span></div>
    <div class="e-repo" id="e-repo">${END_REPO}</div>`;
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

  tl.fromTo("#e-ag", { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: "expo.out" }, T.agents);
  tl.fromTo("#e-stats", { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: "expo.out" }, T.stats);
  tl.fromTo("#e-repo", { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: "expo.out" }, T.stats);
  const ns = COUNTS.map((_, i) => $(`#e-n${i}`));
  proc((t) => {
    const p = p3o(prog(t, T.stats, T.stats + 0.55));
    ns.forEach((el, i) => { el.textContent = String(Math.round(COUNTS[i] * p)); });
  });
  cue(T.agents, "tick");
  cue(T.stats, "success");
  on(T.cmd, "install line");
  on(T.agents, "agents");
  on(T.stats, "counts");
  read("#e-wm", T.logo + 0.04 + letters.length * 0.015 + 0.45, DUR, "end wordmark");
  read("#e-cmd-t", T.type[1] + 0.01, DUR, "install line");
  read("#e-ag", T.agents + 0.45, DUR, "agents");
  read("#e-stats", T.stats + 0.56, DUR, "counts");
  read("#e-repo", T.stats + 0.45, DUR, "release repository");
}
