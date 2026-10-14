import { gsap, $, $$, proc, clamp, scene, icon, agentLogo, measure, read, cue, typeCues, on, cut, drift, ICON } from "../lib.js";
import { SC, b } from "./timeline.js";
import { SWAPS } from "./data.js";

const [A, B] = SC.ask;
const END = B - 0.01;
const IN = 0.35;
// assets/agents/SOURCES.md records where each logo comes from; the media cut's agents scene uses the same six
const AGENTS = [
  ["claude-code", "Claude Code", "#D97757"], ["openai", "Codex", "#56C8D8"], ["openchamber", "OpenChamber", "#C9C9D6"],
  ["hermes-agent", "Hermes Agent", "#E8E2D0"], ["opencode", "OpenCode", "#FAB283"], ["pi", "Pi", "#B4A6F0"],
];
const PROMPT = "Swap my subscriptions for apps I own.";
// internal/skill/guide.md, "Every conversation": the plan names the Apps, the person approves, then the agent runs
// self-host install. Loading the skill is never approval (ADR 0005), so the Approve click comes before the command.
// beats: 0 the chat · 0.4-1.0 s the sentence types · 3 the plan lands · 5 Approve, the command · 6 the Apps check
const T = { type: [A + 0.4, A + 1.0], plan: A + b(3), click: A + b(5), chips: A + b(6) };
const INSTALL = ["self-host install immich syncthing nextcloud", "home-assistant uptime-kuma"];

export function build(tl) {
  scene("sk", A, B);
  cut(A, "Ask your agent");
  drift($("#sk-cam"), A, B, { s0: 1, s1: 1.025, origin: "50% 50%" });

  $("#sk-strip").innerHTML = AGENTS.map(([logo, name, ag]) => `<div class="agp on" style="--ag:${ag}"><img src="${agentLogo(logo)}"><span>${name}</span></div>`).join("");
  $$("#sk-strip .agp").forEach((p, i) => tl.fromTo(p, { y: -40, opacity: 0 }, { y: 0, opacity: 1, duration: IN, ease: "expo.out" }, A + i * 0.02));
  read($$("#sk-strip .agp span"), A + 5 * 0.02 + IN, END, "agent names");

  const chat = $("#sk-chat");
  chat.innerHTML = `
    <div class="cw-hd"><div class="hdv" style="visibility:visible"><span class="hm">◆</span><b>Your agent</b></div><span class="hsk" data-deco>◆ skill: self-host</span></div>
    <div class="cw-body"><div class="flow">
      <div class="m-user" id="sk-user"><span id="sk-u">${PROMPT}</span></div>
      <div class="plan" id="sk-plan"><div class="pl-h" id="sk-plh">The plan</div>
        ${SWAPS.map((s) => `<div class="pl-r"><span class="k">${s.category}</span><span class="v"><img src="${icon(s.id)}"><b>${s.name}</b></span></div>`).join("")}
        <div class="pl-b"><div class="btn" id="sk-ok"><span id="sk-a">Approve &amp; install</span><span id="sk-b">Approved</span></div><div class="btn ghost" id="sk-c">Change</div></div></div>
      <div class="tool" id="sk-inst">
        <div class="tln"><span class="pr">$</span> <span id="sk-i1">${INSTALL[0]}</span></div>
        <div class="tln"><span id="sk-i2">&nbsp; ${INSTALL[1]}</span><span class="chips" data-deco>${SWAPS.map((s) => `<span class="cp"><img src="${icon(s.id)}"><b>${ICON.check}</b></span>`).join("")}</span></div>
      </div>
    </div></div>`;
  tl.fromTo(chat, { x: 220, opacity: 0 }, { x: 0, opacity: 1, duration: 0.55, ease: "expo.out" }, A);
  cue(A, "whoosh", { dur: 0.45, pan: 0.6 });
  read($("b", chat), A + 0.6, END, "agent");

  const msg = (sel, at) => { tl.fromTo(sel, { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: IN, ease: "expo.out" }, at); cue(at, "pop", { i: 3 }); };
  tl.fromTo("#sk-user", { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: IN, ease: "expo.out" }, T.type[0] - 0.05);
  const uT = $("#sk-u");
  proc((t) => {
    const n = Math.round(PROMPT.length * clamp((t - T.type[0]) / (T.type[1] - T.type[0])));
    uT.textContent = PROMPT.slice(0, Math.max(1, n));
  });
  typeCues(PROMPT, T.type[0], T.type[1]);
  on(T.type[0], "the sentence types");
  read(uT, T.type[1] + 0.01, END, "request");

  msg("#sk-plan", T.plan);
  on(T.plan, "the plan lands");
  read("#sk-plh", T.plan + IN, END);
  read($$("#sk-plan .pl-r"), T.plan + IN, END, "plan rows");
  read("#sk-c", T.plan + IN, END);

  const btn = $("#sk-ok");
  $("#sk").style.display = "block";
  const rb = measure(btn);
  $("#sk").style.display = "none";
  const cur = $("#sk-cursor");
  tl.fromTo(cur, { x: 1960, y: 1120 }, { x: rb.x + rb.w * 0.72, y: rb.cy + 4, duration: 0.45, ease: "expo.out" }, T.click - 0.7);
  tl.fromTo(cur, { scale: 1 }, { scale: 0.86, duration: 0.06, ease: "power2.out" }, T.click);
  tl.fromTo(cur, { scale: 0.86 }, { scale: 1, duration: 0.1, ease: "power2.out" }, T.click + 0.06);
  tl.fromTo(btn, { scale: 1 }, { scale: 0.96, duration: 0.06, ease: "power2.out" }, T.click);
  tl.fromTo(btn, { scale: 0.96 }, { scale: 1, duration: 0.2, ease: "expo.out" }, T.click + 0.06);
  on(T.click - 0.5, "cursor on Approve");
  cue(T.click, "click");
  proc((t) => {
    const ok = t >= T.click;
    btn.classList.toggle("ok", ok);
    $("#sk-a").style.display = ok ? "none" : "inline";
    $("#sk-b").style.display = ok ? "inline" : "none";
  });
  read("#sk-a", T.plan + IN, T.click - 0.01, "approve");
  read("#sk-b", T.click + 0.26, END, "approved");

  msg("#sk-inst", T.click);
  on(T.click, "approved, the install command");
  read([$("#sk-i1"), $("#sk-i2")], T.click + IN, END, "install command");
  $$("#sk-inst .cp").forEach((c, i) => {
    const at = T.chips + i * 0.1;
    tl.fromTo($("b", c), { scale: 0, rotation: -90 }, { scale: 1, rotation: 0, duration: 0.3, ease: "expo.out" }, at);
    tl.fromTo(c, { opacity: 0.35 }, { opacity: 1, duration: 0.1 }, at);
    cue(at, "check", { i: i + 3 });
  });
  on(T.chips, "the Apps check");
}
