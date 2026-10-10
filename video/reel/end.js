import { $, scene, chars, read, on, cut } from "./lib.js";
import { SC, DUR, b } from "./timeline.js";

const [A] = SC.end;
// the README's one-liner, split with a shell line continuation so it reads at 32 px; the only place the repository name appears
export const END_INSTALL = "curl -fsSL https://raw.githubusercontent.com/ajnart/selfhost-skills/main/install.sh";
// beats: 0 the final hit, the logo · 1 the install line · 2 the agents · 3 the counts; still from SETTLED
const T = { logo: b(56), cmd: b(57), agents: b(58), stats: b(59) };
const IN = 0.2;
export const SETTLED = T.stats + IN;

export function build(tl) {
  scene("endsc", A, DUR + 1);
  cut(A, "end card");
  const end = $("#end");
  end.innerHTML = `
    <div class="e-lock"><div class="e-dia"><svg viewBox="0 0 100 100"><path d="M50 2 98 50 50 98 2 50Z"/></svg></div><div class="e-wm" id="e-wm">self-host</div></div>
    <div class="e-cmd"><div class="e-cmdin" id="e-cmd"><div><span class="pr">$</span> ${END_INSTALL} \\</div><div>&nbsp;&nbsp;| bash</div></div></div>
    <div class="e-ag" id="e-ag">Claude Code <i>·</i> Codex <i>·</i> OpenChamber <i>·</i> Hermes Agent <i>·</i> OpenCode <i>·</i> Pi</div>
    <div class="e-stats" id="e-stats"><span><b>93</b> Apps</span><i>·</i><span><b>20</b> Recipes</span><i>·</i><span><b>1</b> binary</span></div>`;
  const letters = chars($("#e-wm"));
  tl.fromTo(".e-dia", { scale: 0 }, { scale: 1, duration: IN, ease: "expo.out" }, T.logo);
  letters.forEach((c, i) => tl.fromTo(c, { yPercent: 115 }, { yPercent: 0, duration: IN, ease: "expo.out" }, T.logo + i * 0.015));
  tl.fromTo("#e-cmd", { clipPath: "inset(0 100% 0 0 round 20px)" }, { clipPath: "inset(0 0% 0 0 round 20px)", duration: IN, ease: "expo.out" }, T.cmd);
  tl.fromTo("#e-ag", { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: IN, ease: "expo.out" }, T.agents);
  tl.fromTo("#e-stats", { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: IN, ease: "expo.out" }, T.stats);
  on(T.cmd, "install line");
  on(T.agents, "agents");
  on(T.stats, "counts");
  read("#e-wm", T.logo + letters.length * 0.015 + IN, DUR, "end wordmark");
  read("#e-cmd", T.cmd + IN, DUR, "install line");
  read("#e-ag", T.agents + IN, DUR, "agents");
  read("#e-stats", T.stats + IN, DUR, "counts");
}
