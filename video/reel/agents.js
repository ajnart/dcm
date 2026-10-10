import { gsap, $, $$, proc, prog, scene, icon, agentLogo, diamond, measure, read, cue, typeCues } from "./lib.js";
import { SC, shown } from "./timeline.js";

const [A, B] = SC.agents;
const END = B - 0.15; // last held frame before the end card's reveal covers the chat

// assets/agents/SOURCES.md records where each logo comes from
const AGENTS = [
  { id: "claude-code", name: "Claude Code", sub: "Anthropic · terminal", logo: "claude-code", ag: "#D97757", from: A },
  { id: "codex", name: "Codex", sub: "OpenAI · CLI", logo: "openai", ag: "#56C8D8", from: A + 2.3 },
  { id: "openchamber", name: "OpenChamber", sub: "desktop app", logo: "openchamber", ag: "#C9C9D6", from: A + 3.5 },
  { id: "hermes", name: "Hermes Agent", sub: "Nous Research", logo: "hermes-agent", ag: "#E8E2D0", from: A + 6.3 },
  { id: "opencode", name: "OpenCode", sub: "terminal", logo: "opencode", ag: "#FAB283", from: A + 9.25 },
  { id: "pi", name: "Pi", sub: "terminal", logo: "pi", ag: "#B4A6F0", from: A + 10.35 },
];
const ALL_ON = A + 11.0;
const until = (i) => (i + 1 < AGENTS.length ? AGENTS[i + 1].from : END);
const active = (t) => AGENTS.reduce((k, a, i) => (t >= a.from ? i : k), 0);

const T = {
  chat: A + 0.3, bubble: A + 0.75, typeA: A + 0.9, typeB: A + 1.6,
  tools: A + 2.0, r1: A + 2.35, l2: A + 2.45, r2: A + 2.8,
  plan: A + 3.3, rows: A + 3.45, btns: A + 4.2, click: A + 5.85,
  scroll: A + 7.0, inst: A + 7.35, prog: [A + 7.65, A + 8.45], done: A + 8.5,
};
const PROMPT = "I want to watch my movies on the TV.";

export function build(tl) {
  const root = scene("agents", A, shown("agents"));
  tl.fromTo(root, { clipPath: diamond(960, 540, 0) }, { clipPath: diamond(960, 540, 1900), duration: 0.5, ease: "power3.inOut" }, A);
  cue(A, "whoosh", { dur: 0.5, pan: -0.2 });

  // logo strip: the active agent lights up
  $("#ag-strip").innerHTML = AGENTS.map((a) => `<div class="agp" style="--ag:${a.ag}"><img src="${agentLogo(a.logo)}"><span>${a.name}</span></div>`).join("");
  const pills = $$("#ag-strip .agp");
  pills.forEach((p, i) => tl.fromTo(p, { y: -40, opacity: 0, scale: 0.85 }, { y: 0, opacity: 1, scale: 1, duration: 0.45, ease: "back.out(2)" }, A + 0.15 + i * 0.06));
  read($$("#ag-strip .agp span"), A + 0.95, END, "agent names");

  $("#ag-left").innerHTML = `
    <div class="eyebrow" data-deco><span class="ed">◆</span> self-host skill</div>
    <div class="ag-h" id="ag-h"><span class="ln"><span class="mk"><span class="w">Just</span></span> <span class="mk"><span class="w">ask</span></span></span><span class="ln"><span class="mk"><span class="w">your</span></span> <span class="mk"><span class="w">agent.</span></span></span></div>
    <div class="ag-sub" id="ag-sub">One skill.<br>Every agent.</div>`;
  tl.fromTo("#ag-left .eyebrow", { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.5, ease: "expo.out" }, A + 0.3);
  $$("#ag-h .w").forEach((w, k) => tl.fromTo(w, { yPercent: 190, rotation: 3 }, { yPercent: 0, rotation: 0, duration: 0.55, ease: "expo.out" }, A + 0.35 + k * 0.09));
  tl.fromTo("#ag-sub", { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.5, ease: "expo.out" }, A + 1.3);
  cue(A + 0.4, "thump", { i: 3 });
  read("#ag-h", A + 1.2, END, "headline");
  read("#ag-sub", A + 1.85, END, "subhead");

  const chat = $("#chat");
  chat.innerHTML = `
    <div class="cw-hd">${AGENTS.map((a) => `<div class="hdv" data-agent="${a.id}"><img src="${agentLogo(a.logo)}"><b>${a.name}</b><span class="hsub" data-deco>${a.sub} · ~/homelab</span></div>`).join("")}<span class="hsk" data-deco>◆ skill: self-host</span></div>
    <div class="cw-body"><div id="flow">
      <div class="m-user" id="m-user"><span id="u-t"></span><span class="caretb" id="u-c"></span></div>
      <div class="tool" id="m-tools">
        <div class="tln" id="tl1"><span class="pr">$</span> self-host skill <span class="res" id="r1"></span></div>
        <div class="tln" id="tl2"><span class="pr">$</span> self-host apps list --json <span class="res" id="r2"></span></div></div>
      <div class="plan" id="m-plan"><div class="pl-h" id="pl-h">◆ The plan</div>
        <div class="pl-r"><span class="k">Recipe</span><span class="v"><img src="${icon("jellyfin")}"><code>owned-video-library</code></span></div>
        <div class="pl-r"><span class="k">Dashboard</span><span class="v"><img src="${icon("homarr")}"><b>Homarr</b></span></div>
        <div class="pl-r"><span class="k">Exposure</span><span class="v"><b>Local network only</b></span></div>
        <div class="pl-r"><span class="k">Admin login</span><span class="v"><b>Generated for you</b></span></div>
        <div class="pl-b"><div class="btn" id="btn-ok"><span id="btn-a">Approve &amp; install</span><span id="btn-b">Approved ✓</span></div><div class="btn ghost" id="btn-c">Change</div></div></div>
      <div class="tool" id="m-inst"><div class="tln"><span class="pr">$</span> self-host install owned-video-library homarr</div><div class="tln">&nbsp; --yes --json</div>
        <div class="prog" data-deco><div id="prog-f"></div></div>
        <div class="chips" data-deco><span class="cp"><img src="${icon("jellyfin")}"><b>✓</b></span><span class="cp"><img src="${icon("homarr")}"><b>✓</b></span><em id="prog-n">0/2</em></div></div>
      <div class="m-done" id="m-done"><div class="dn1" id="dn1"><span class="okc">●</span> All set. Your dashboard is ready.</div><div class="link" id="dn-url">http://192.168.1.20:7575</div><div class="dn2" id="dn2">Admin login: <code>self-host credentials</code></div></div>
    </div></div>
    <div class="cw-in" data-deco><span class="pin">›</span><span>Ask for anything you want to self-host…</span></div>`;
  const hdvs = $$(".hdv", chat);

  tl.fromTo(chat, { y: 90, scale: 0.94, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.6, ease: "expo.out" }, T.chat);
  proc((t) => {
    if (t < A || t > shown("agents")) return;
    const k = active(t);
    const a = AGENTS[k];
    chat.style.setProperty("--ag", a.ag);
    const x = prog(t, a.from, a.from + 0.15);
    hdvs.forEach((h, i) => { h.style.opacity = i === k ? x : i === k - 1 ? 1 - x : 0; });
    const sweep = prog(t, a.from, a.from + 0.35);
    chat.style.setProperty("--sweep", `${(sweep > 0 && sweep < 1 ? sweep : 0) * 100}%`);
    const all = t >= ALL_ON;
    pills.forEach((p, i) => p.classList.toggle("on", all || i === k));
  });
  AGENTS.forEach((a, i) => {
    if (i) cue(a.from, "switch", { i });
    read($(".hdv b", hdvs[i]), (i ? a.from : T.chat + 0.6) + 0.15, until(i), `${a.name} header`);
  });
  cue(ALL_ON, "shimmer");

  // 1 · the request
  tl.fromTo("#m-user", { y: 30, opacity: 0, scale: 0.9 }, { y: 0, opacity: 1, scale: 1, duration: 0.35, ease: "back.out(2)" }, T.bubble);
  const uT = $("#u-t");
  proc((t) => {
    const n = Math.round(PROMPT.length * prog(t, T.typeA, T.typeB));
    uT.textContent = PROMPT.slice(0, n);
    $("#u-c").style.visibility = t >= T.typeA - 0.1 && t < T.typeB + 0.1 ? "visible" : "hidden";
  });
  typeCues(PROMPT, T.typeA, T.typeB);
  cue(T.typeB + 0.1, "enter");
  read("#u-t", T.typeB + 0.15, T.scroll - 0.05, "request");

  // 2 · the agent reads the guide and the Catalog
  tl.fromTo("#m-tools", { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: "expo.out" }, T.tools);
  tl.fromTo("#tl2", { opacity: 0 }, { opacity: 1, duration: 0.15 }, T.l2);
  proc((t) => {
    const sp = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"[Math.floor(t * 14) % 10];
    $("#r1").innerHTML = t >= T.r1 ? "✓ guide loaded" : `<span class="spin">${sp}</span>`;
    $("#r2").innerHTML = t >= T.r2 ? "✓ 20 Recipes" : `<span class="spin">${sp}</span>`;
  });
  cue(T.r1, "tick");
  cue(T.r2, "tick");
  read("#tl1", T.r1 + 0.05, T.scroll - 0.05);
  read("#tl2", T.r2 + 0.05, T.scroll - 0.05);

  // 3 · the plan, then approval
  tl.fromTo("#m-plan", { y: 40, opacity: 0, scale: 0.96 }, { y: 0, opacity: 1, scale: 1, duration: 0.45, ease: "expo.out" }, T.plan);
  cue(T.plan, "pop", { i: 2 });
  $$("#m-plan .pl-r").forEach((r, i) => tl.fromTo(r, { x: -30, opacity: 0 }, { x: 0, opacity: 1, duration: 0.4, ease: "expo.out" }, T.rows + i * 0.12));
  $$("#m-plan .pl-r img").forEach((im, i) => tl.fromTo(im, { scale: 0, rotation: -60 }, { scale: 1, rotation: 0, duration: 0.35, ease: "back.out(2.4)" }, T.rows + 0.1 + i * 0.12));
  tl.fromTo("#m-plan .pl-b", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.35, ease: "expo.out" }, T.btns);
  read("#pl-h", T.plan + 0.5, T.scroll - 0.05);
  read($$("#m-plan .pl-r"), T.rows + 0.36 + 0.4 + 0.05, T.scroll - 0.05, "plan rows");
  read("#btn-c", T.btns + 0.4, T.scroll - 0.05);

  const btn = $("#btn-ok");
  root.style.display = "block";
  const rb = measure(btn);
  root.style.display = "none";
  const cur = $("#cursor");
  tl.fromTo(cur, { x: 1800, y: 1060, opacity: 0 }, { x: rb.x + rb.w - 16, y: rb.cy + 2, opacity: 1, duration: 0.7, ease: "power3.inOut" }, T.click - 0.85);
  tl.fromTo(cur, { scale: 1 }, { scale: 0.82, duration: 0.07, yoyo: true, repeat: 1 }, T.click);
  tl.fromTo(btn, { scale: 1 }, { scale: 0.94, duration: 0.07, yoyo: true, repeat: 1 }, T.click);
  tl.fromTo(cur, { opacity: 1 }, { opacity: 0, duration: 0.2 }, T.click + 0.4);
  cue(T.click, "click");
  proc((t) => {
    const ok = t >= T.click + 0.04;
    btn.classList.toggle("ok", ok);
    $("#btn-a").style.display = ok ? "none" : "inline";
    $("#btn-b").style.display = ok ? "inline" : "none";
  });
  read("#btn-a", T.btns + 0.4, T.click - 0.01, "approve");
  read("#btn-b", T.click + 0.16, T.scroll - 0.05, "approved");

  // 4 · install, then the dashboard link
  tl.fromTo("#flow", { y: 0 }, { y: -420, duration: 0.45, ease: "power3.inOut" }, T.scroll);
  cue(T.scroll, "whoosh", { dur: 0.45, pan: 0.2, soft: 1 });
  tl.fromTo("#m-inst", { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: "expo.out" }, T.inst);
  $$("#m-inst .cp").forEach((c, i) => {
    const at = T.prog[0] + 0.3 + i * 0.45;
    tl.fromTo(c, { scale: 0.2, opacity: 0.25 }, { scale: 1, opacity: 1, duration: 0.3, ease: "back.out(3)" }, at);
    cue(at, "check", { i: 7 + i });
  });
  proc((t) => {
    $("#prog-f").style.width = `${prog(t, T.prog[0], T.prog[1]) * 100}%`;
    $("#prog-n").textContent = `${t >= T.prog[0] + 0.75 ? 2 : t >= T.prog[0] + 0.3 ? 1 : 0}/2`;
  });
  read($$("#m-inst .tln"), T.inst + 0.4, END, "install command");
  tl.fromTo("#m-done", { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "expo.out" }, T.done);
  tl.fromTo("#dn-url", { scale: 0.85 }, { scale: 1, duration: 0.45, ease: "back.out(2.4)" }, T.done + 0.15);
  tl.fromTo("#chat", { boxShadow: "0 0 0 rgba(0,215,135,0)" }, { boxShadow: "0 0 120px rgba(0,215,135,0.35)", duration: 0.6 }, T.done + 0.1);
  cue(T.done, "success");
  read("#dn1", T.done + 0.45, END);
  read("#dn-url", T.done + 0.65, END);
  read("#dn2", T.done + 0.45, END);
  cue(B - 1.5, "riser", { dur: 1.8 });
}
