import { $, $$, proc, clamp, prog, scene, read, cue, typeCues, on, cut, drift, p3o, agentLogo } from "./lib.js";
import { SC, DUR, b } from "./timeline.js";
import { loadIntro, mountIntro } from "./intro.js";

const INTRO = await loadIntro();

const [A] = SC.end;
export const END_INSTALL = "curl -fsSL https://self-host.fyi/install | bash";
export const END_REPO = "github.com/ajnart/self-host";
// beats: 0 the final hit, the CLI Intro plays: the four containers drop, light up and "self-host" morphs in · 1 the install line types · 2 "CLI + your agent",
// then "your agent" morphs through each agent and back · 3 the counts run up;
// still from SETTLED but for the caret and a slow push
const T = { logo: A, cmd: A + b(1), type: [A + b(1) + 0.15, A + b(1) + 0.75], agents: A + b(2), stats: A + b(3) };
export const SETTLED = T.stats + 0.6;
const COUNTS = [89, 7, 1];
// "your agent" morphs through each agent the skill runs in, then settles back
const SLOT = [
  { name: "your agent" },
  { name: "Claude Code", logo: "claude-code" },
  { name: "Codex", logo: "openai" },
  { name: "OpenChamber", logo: "openchamber" },
  { name: "Hermes", logo: "hermes-agent" },
  { name: "OpenCode", logo: "opencode" },
  { name: "Pi", logo: "pi" },
  { name: "your agent" },
];
const MORPH = 0.12, STEP = 0.36;
// the CLI Intro recording, cropped to its logo, horizon and wordmark; starting SKIP frames in lands the first
// container a quarter second after the hit
const SKIP = 14;
const CROP = { c0: 22, r0: 3, w: 58, h: 18 };
// played at 1.5× the recorded 24 fps
const RATE = INTRO.fps * 1.5;
const at = (frame) => A + (frame - SKIP) / RATE;
// "CLI + your agent" enters as "self-host" starts to morph in
T.agents = at(42);
const CIPHER = "ABCDEFGHJKLMNPQRSTUVWXYZabdeghkmnpqrsuvwxyz0123456789#%&*+=<>/?$@";
const noise = (a, k) => {
  const x = Math.sin(a * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export function build(tl) {
  scene("endsc", A, DUR + 1);
  cut(A, "end card");
  drift($("#end-cam"), A, DUR, { s0: 1, s1: 1.035 });
  const end = $("#end");
  end.innerHTML = `
    <canvas class="e-intro" id="e-intro"></canvas>
    <div class="e-cmd"><div class="e-cmdin" id="e-cmd"><span class="pr">$</span><span id="e-cmd-t"></span><span class="caret" id="e-caret"></span></div></div>
    <div class="e-ag" id="e-ag"><span class="e-cli" id="e-cli">CLI</span><i>+</i><span class="e-slot"><span class="e-lg">${SLOT.filter((s) => s.logo).map((s) => `<img src="${agentLogo(s.logo)}" data-n="${s.name}">`).join("")}</span><span id="e-ag-t"></span></span></div>
    <div class="e-stats" id="e-stats"><span><b id="e-n0">89</b> Apps</span><i>·</i><span><b id="e-n1">19</b> Recipes</span><i>·</i><span><b id="e-n2">1</b> binary</span></div>
    <div class="e-repo" id="e-repo">${END_REPO}</div>`;
  const film = mountIntro($("#e-intro"), INTRO, { cw: 12, base: "#09080f", font: '"JetBrains Mono Variable", monospace', crop: CROP });
  proc((t) => film.paint(Math.floor(Math.max(0, t - A) * RATE) + SKIP));
  [18, 24, 30, 36].forEach((f, i) => cue(at(f), "lock", { i, soft: true }));
  [27, 31, 35, 39].forEach((f, i) => cue(at(f), "check", { i, soft: true }));
  cue(at(42), "whoosh", { dur: 0.35, soft: true });
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
  const agT = $("#e-ag-t"), logos = $$(".e-lg img");
  const swaps = SLOT.map((_, i) => T.agents + 0.3 + (i - 1) * STEP).slice(1);
  proc((t) => {
    let k = 0;
    while (k < swaps.length && t >= swaps[k]) k++;
    const cur = SLOT[k], prev = SLOT[Math.max(0, k - 1)], s = k ? swaps[k - 1] : -Infinity;
    const p = clamp((t - s) / MORPH);
    const n = Math.max(prev.name.length, cur.name.length);
    let out = "";
    for (let i = 0; i < n; i++) {
      if (p >= (i + 1) / n) out += cur.name[i] ?? "";
      else out += CIPHER[Math.floor(noise(i + 20, Math.floor(t * 30)) * CIPHER.length)];
    }
    agT.textContent = out.replace(/ /g, "\u00a0");
    agT.classList.toggle("you", !cur.logo);
    const pop = 0.6 + 0.4 * p3o(clamp((t - s) / 0.16));
    logos.forEach((img) => {
      const on = img.dataset.n === cur.name;
      img.style.display = on ? "block" : "none";
      if (on) img.style.transform = `scale(${pop.toFixed(4)})`;
    });
  });
  swaps.forEach((t, i) => cue(t, "tick", { i, soft: true }));
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
  read("#e-cmd-t", T.type[1] + 0.01, DUR, "install line");
  read("#e-cli", T.agents + 0.45, DUR, "CLI");
  read(agT, swaps[swaps.length - 1] + MORPH + 0.01, DUR, "your agent");
  read("#e-stats", T.stats + 0.56, DUR, "counts");
  read("#e-repo", T.stats + 0.45, DUR, "release repository");
}
