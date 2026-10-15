import { gsap, $, $$, proc, clamp, scene, icon, agentLogo, measure, read, cue, typeCues, on, cut, drift, ICON } from "./lib.js";
import { SC, b } from "./timeline.js";

const [A, B] = SC.agents;
const END = B - 0.01;
const j = (n) => A + b(n); // beat n of this scene

// assets/agents/SOURCES.md records where each logo comes from. The chat window changes agent every
// second beat while the conversation carries on: the same skill, in each of them.
const AGENTS = [
  { id: "claude-code", name: "Claude Code", logo: "claude-code", ag: "#D97757", from: j(0) },
  { id: "codex", name: "Codex", logo: "openai", ag: "#56C8D8", from: j(2) },
  { id: "openchamber", name: "OpenChamber", logo: "openchamber", ag: "#C9C9D6", from: j(4) },
  { id: "hermes", name: "Hermes Agent", logo: "hermes-agent", ag: "#E8E2D0", from: j(6) },
  { id: "opencode", name: "OpenCode", logo: "opencode", ag: "#FAB283", from: j(8) },
  { id: "pi", name: "Pi", logo: "pi", ag: "#B4A6F0", from: j(10) },
];
const ALL_ON = j(11);
const until = (i) => (i + 1 < AGENTS.length ? AGENTS[i + 1].from : B);
const active = (t) => AGENTS.reduce((k, a, i) => (t >= a.from ? i : k), 0);
// internal/skill/guide.md, "Every conversation": pick the Recipe or Apps from `apps list`, show the plan in goals and Apps,
// get approval, run `self-host install <recipe> --yes --json`, point to `self-host credentials`.
const T = { request: j(1), typed: j(1) + 0.4, tool: j(2), result: j(3), plan: j(3), hover: j(4), click: j(5), chips: [j(6), j(6) + b(0.5)], done: j(7), link: j(9) };
const PROMPT = "I want to watch my movies on the TV.";
const IN = 0.35;

export function build(tl) {
  scene("agents", A, B);
  cut(A, "Just ask your agent.");
  drift($("#agents-cam"), A, B, { s0: 1, s1: 1.025, origin: "70% 50%" });

  $("#ag-strip").innerHTML = AGENTS.map((a) => `<div class="agp" style="--ag:${a.ag}"><img src="${agentLogo(a.logo)}"><span>${a.name}</span></div>`).join("");
  const pills = $$("#ag-strip .agp");
  pills.forEach((p, i) => tl.fromTo(p, { y: -40, opacity: 0 }, { y: 0, opacity: 1, duration: IN, ease: "expo.out" }, A + i * 0.02));
  read($$("#ag-strip .agp span"), A + 5 * 0.02 + IN, END, "agent names");

  $("#ag-left").innerHTML = `
    <div class="eyebrow" data-deco><span class="ed">◆</span> self-host skill</div>
    <div class="ag-h" id="ag-h"><span class="ln"><span class="mk"><span class="w">Just ask</span></span></span><span class="ln"><span class="mk"><span class="w">your <b>agent.</b></span></span></span></div>
    <div class="ag-sub" id="ag-sub"><span class="mk"><span class="w">One skill.</span></span><span class="mk"><span class="w">Every agent.</span></span></div>`;
  tl.fromTo("#ag-left .eyebrow", { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: IN, ease: "expo.out" }, A);
  $$("#ag-h .w").forEach((w, k) => tl.fromTo(w, { yPercent: 110, letterSpacing: "0.01em" }, { yPercent: 0, letterSpacing: "-0.055em", duration: 0.45, ease: "expo.out" }, A + k * 0.06));
  $$("#ag-sub .w").forEach((w, k) => tl.fromTo(w, { yPercent: 110 }, { yPercent: 0, duration: IN, ease: "expo.out" }, T.request + k * 0.06));
  cue(A, "slam", { g: 0.7 });
  read("#ag-h", A + 0.06 + 0.45, END, "headline");
  read("#ag-sub", T.request + 0.06 + IN, END, "subhead");

  const chat = $("#chat");
  chat.innerHTML = `
    <div class="cw-hd">${AGENTS.map((a) => `<div class="hdv" data-agent="${a.id}"><img src="${agentLogo(a.logo)}"><b>${a.name}</b></div>`).join("")}<span class="hsk" data-deco>◆ skill: self-host</span></div>
    <div class="cw-body"><div id="flow">
      <div class="m-user" id="m-user"><span id="u-t">${PROMPT}</span></div>
      <div class="tool" id="m-tools"><div class="tln"><span class="pr">$</span> <span id="tl-c">self-host apps list --json</span><span class="spin" id="tl-s" data-deco></span><span class="res" id="tl-r">${ICON.check}<span>7 Recipes</span></span></div></div>
      <div class="plan" id="m-plan"><div class="pl-h" id="pl-h">The plan</div>
        <div class="pl-r"><span class="k">App</span><span class="v"><img src="${icon("jellyfin")}"><code>jellyfin</code></span></div>
        <div class="pl-r"><span class="k">Dashboard</span><span class="v"><img src="${icon("homarr")}"><b>Homarr</b></span></div>
        <div class="pl-r"><span class="k">Access</span><span class="v"><b>Home network</b></span></div>
        <div class="pl-b"><div class="btn" id="btn-ok"><span id="btn-a">Approve &amp; install</span><span id="btn-b">Approved</span></div><div class="btn ghost" id="btn-c">Change</div></div></div>
      <div class="tool" id="m-inst"><div class="tln" id="in1"><span class="pr">$</span> self-host install jellyfin homarr</div><div class="tln"><span id="in2">&nbsp; --yes --json</span><span class="chips" data-deco><span class="cp"><img src="${icon("jellyfin")}"><b>${ICON.check}</b></span><span class="cp"><img src="${icon("homarr")}"><b>${ICON.check}</b></span></span></div></div>
      <div class="m-done" id="m-done"><div class="dn1"><span id="dn1">All set.</span><span class="link" id="dn-url">http://192.168.1.20:7575</span></div><div class="dn2" id="dn2">Admin login: <code>self-host credentials</code></div></div>
    </div></div>`;
  const hdvs = $$(".hdv", chat);

  tl.fromTo(chat, { x: 220, opacity: 0 }, { x: 0, opacity: 1, duration: 0.55, ease: "expo.out" }, A);
  cue(A, "whoosh", { dur: 0.45, pan: 0.6 });
  proc((t) => {
    if (t < A || t >= B) return;
    const k = active(t);
    chat.style.setProperty("--ag", AGENTS[k].ag);
    hdvs.forEach((h, i) => {
      h.style.visibility = i === k || (i === k - 1 && t < AGENTS[k].from + 0.2) ? "visible" : "hidden";
      const into = clamp((t - AGENTS[i].from) / 0.3), away = k > i ? clamp((t - AGENTS[i + 1].from) / 0.2) : 0;
      h.style.transform = i === 0 && k === 0 ? "" : `translateY(${(away ? -100 * gsap.parseEase("power3.in")(away) : 100 * (1 - gsap.parseEase("expo.out")(into))).toFixed(2)}%)`;
    });
    pills.forEach((p, i) => p.classList.toggle("on", t >= ALL_ON || i === k));
  });
  AGENTS.forEach((a, i) => {
    if (i) on(a.from, `switch to ${a.name}`);
    if (i) cut(a.from, `${a.name} header`);
    if (i) cue(a.from, "switch");
    read($(".hdv b", hdvs[i]), i ? a.from + 0.3 : A + 0.55, until(i) - 0.01, `${a.name} header`);
  });
  on(ALL_ON, "all six light up");

  const msg = (sel, at) => { tl.fromTo(sel, { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: IN, ease: "expo.out" }, at); cue(at, "pop", { i: 3 }); };
  msg("#m-user", T.request);
  on(T.request, "the request");
  const uT = $("#u-t");
  proc((t) => {
    const n = Math.round(PROMPT.length * clamp((t - T.request) / (T.typed - T.request)));
    uT.textContent = PROMPT.slice(0, Math.max(1, n));
  });
  typeCues(PROMPT, T.request, T.typed);
  read("#u-t", T.typed + 0.01, END, "request");

  msg("#m-tools", T.tool);
  const res = $("#tl-r"), spin = $("#tl-s");
  proc((t) => {
    res.style.visibility = t >= T.result ? "visible" : "hidden";
    spin.textContent = t >= T.result ? "" : "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"[Math.floor(t * 16) % 10];
  });
  tl.fromTo(res, { x: -16 }, { x: 0, duration: 0.25, ease: "expo.out" }, T.result);
  on(T.result, "7 Recipes");
  cue(T.result, "tick");
  read("#tl-c", T.tool + IN, END, "apps list");
  read($("span", res), T.result + 0.25, END, "result");

  msg("#m-plan", T.plan);
  on(T.plan, "the plan lands");
  read("#pl-h", T.plan + IN, END);
  read($$("#m-plan .pl-r"), T.plan + IN, END, "plan rows");
  read("#btn-c", T.plan + IN, END);

  const btn = $("#btn-ok");
  $("#agents").style.display = "block";
  const rb = measure(btn), ru = measure($("#dn-url"));
  $("#agents").style.display = "none";
  const cur = $("#cursor");
  tl.fromTo(cur, { x: 1960, y: 1120 }, { x: rb.x + rb.w * 0.72, y: rb.cy + 4, duration: 0.45, ease: "expo.out" }, T.hover - 0.3);
  tl.fromTo(cur, { scale: 1 }, { scale: 0.86, duration: 0.06, ease: "power2.out" }, T.click);
  tl.fromTo(cur, { scale: 0.86 }, { scale: 1, duration: 0.1, ease: "power2.out" }, T.click + 0.06);
  tl.fromTo(cur, { x: rb.x + rb.w * 0.72, y: rb.cy + 4 }, { x: ru.x + ru.w * 0.8, y: ru.cy + 6, duration: 0.4, ease: "expo.inOut" }, T.link - 0.4);
  tl.fromTo("#btn-ok", { scale: 1 }, { scale: 0.96, duration: 0.06, ease: "power2.out" }, T.click);
  tl.fromTo("#btn-ok", { scale: 0.96 }, { scale: 1, duration: 0.2, ease: "expo.out" }, T.click + 0.06);
  on(T.hover, "cursor on Approve");
  on(T.link, "cursor on the dashboard link");
  cue(T.click, "click");
  cue(T.link, "tick");
  proc((t) => {
    const ok = t >= T.click;
    btn.classList.toggle("ok", ok);
    $("#btn-a").style.display = ok ? "none" : "inline";
    $("#btn-b").style.display = ok ? "inline" : "none";
    $("#dn-url").classList.toggle("hover", t >= T.link);
  });
  read("#btn-a", T.plan + IN, T.click - 0.01, "approve");
  read("#btn-b", T.click + 0.26, END, "approved");

  msg("#m-inst", T.click);
  on(T.click, "approved, install runs");
  read(["#in1", "#in2"].map((s) => $(s)), T.click + IN, END, "install command");
  $$("#m-inst .cp").forEach((c, i) => {
    tl.fromTo($("b", c), { scale: 0, rotation: -90 }, { scale: 1, rotation: 0, duration: 0.3, ease: "expo.out" }, T.chips[i]);
    tl.fromTo(c, { opacity: 0.35 }, { opacity: 1, duration: 0.1 }, T.chips[i]);
    cue(T.chips[i], "check", { i: 5 + i });
  });
  on(T.chips[0], "Apps installed");

  msg("#m-done", T.done);
  on(T.done, "All set.");
  cue(T.done, "success");
  read("#dn1", T.done + IN, END);
  read("#dn-url", T.done + IN, END);
  read("#dn2", T.done + IN, END);
}
