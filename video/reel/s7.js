import { gsap, $, $$, proc, prog, clamp, scene, icon, diamond, typed, measure } from "./lib.js";

const MEDIA = ["qbittorrent", "sonarr", "radarr", "prowlarr", "jellyfin", "seerr"];
const ALL = [...MEDIA, "homarr"];
const A = 16.35, B = 22.95;

export function build(tl) {
  const root = scene("s7", A, B);
  tl.fromTo(root, { clipPath: diamond(960, 540, 0) }, { clipPath: diamond(960, 540, 1900), duration: 0.5, ease: "power3.inOut" }, A);

  const left = $("#sk-left");
  left.innerHTML = `
    <div class="eyebrow"><span class="ed">◆</span> self-host skill</div>
    <div class="sk-hs">
      <div class="sk-h" id="h1"><span class="mk"><span class="w">Say a goal.</span></span></div>
      <div class="sk-h" id="h2"><span class="mk"><span class="w">Review</span></span><br><span class="mk"><span class="w">the plan.</span></span></div>
      <div class="sk-h" id="h3"><span class="mk"><span class="w">Approve.</span></span></div>
      <div class="sk-h" id="h4"><span class="mk"><span class="w">Open your</span></span><br><span class="mk"><span class="w">dashboard.</span></span></div>
    </div>
    <div class="sk-lab">Works in</div>
    <div class="sk-agents"><span>Claude Code</span><span>OpenCode</span><span>Codex</span><span>Pi</span><span class="more">+ more</span></div>
    <div class="sk-aud"><div><b class="n">New</b> plain goals</div><div><b class="a">Advanced</b> exact Apps, ports, Exposure</div></div>`;

  const chat = $("#chat");
  chat.innerHTML = `
    <div class="ch-hd"><i></i><i></i><i></i><span>agent · ~/homelab</span><b class="sk">◆ skill: self-host</b></div>
    <div class="ch-body"><div id="flow">
      <div class="m-user" id="m1"><span id="u-t"></span><span class="caretb" id="u-c"></span></div>
      <div class="tool" id="m2"><div class="th">◆ Reading the guide</div>
        <div class="tln"><span class="pr">$</span> self-host skill <span class="res" id="r1">✓ guide loaded</span></div>
        <div class="tln"><span class="pr">$</span> self-host doctor --json <span class="res" id="r2">✓ host ready</span></div></div>
      <div class="plan" id="m3"><div class="pl-h">◆ The plan</div>
        <div class="pl-r"><span class="k">Recipe</span><span class="v"><b>media</b>${MEDIA.map((m) => `<img src="${icon(m)}">`).join("")}</span></div>
        <div class="pl-r"><span class="k">Dashboard</span><span class="v"><img src="${icon("homarr")}"><b>Homarr</b></span></div>
        <div class="pl-r"><span class="k">Exposure</span><span class="v"><b>Local network</b> · nothing on the internet</span></div>
        <div class="pl-r"><span class="k">Admin login</span><span class="v"><b>Generated</b>, one for every App</span></div>
        <div class="pl-b"><div class="btn" id="btn-ok">Approve &amp; install</div><div class="btn ghost">Change</div></div></div>
      <div class="tool" id="m4"><div class="tln"><span class="pr">$</span> self-host install media homarr --yes</div>
        <div class="prog"><div id="prog-f"></div></div>
        <div class="chips">${ALL.map((m) => `<span class="cp"><img src="${icon(m)}"><b>✓</b></span>`).join("")}<em id="prog-n">0/7</em></div></div>
      <div class="m-done" id="m5"><div class="dn1"><span class="okc">●</span> All set. Your dashboard is ready.</div><div class="link">http://192.168.1.20:7575</div><div class="dn2">Admin login: <code>self-host credentials</code></div></div>
    </div></div>
    <div class="ch-in"><span>Ask for anything you want to self-host…</span><b>↑</b></div>`;

  // phases on the left
  tl.fromTo("#sk-left .eyebrow", { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.5, ease: "expo.out" }, A + 0.3);
  const P = [[16.78, 18.45], [18.45, 19.85], [19.85, 20.95], [20.95, 22.95]];
  P.forEach(([a, b], i) => {
    $$(`#h${i + 1} .w`).forEach((w, k) => {
      tl.fromTo(w, { yPercent: 190, rotation: 3 }, { yPercent: 0, rotation: 0, duration: 0.55, ease: "expo.out" }, a + (i ? 0.08 : 0) + k * 0.09);
      if (i < 3) tl.fromTo(w, { yPercent: 0 }, { yPercent: -190, duration: 0.28, ease: "power3.in" }, b - 0.16 + k * 0.03);
    });
  });
  tl.fromTo(".sk-lab", { opacity: 0 }, { opacity: 1, duration: 0.4 }, 17.1);
  $$(".sk-agents span").forEach((s, i) => tl.fromTo(s, { y: 30, opacity: 0, scale: 0.8 }, { y: 0, opacity: 1, scale: 1, duration: 0.45, ease: "back.out(2)" }, 17.15 + i * 0.07));
  $$(".sk-aud > div").forEach((s, i) => tl.fromTo(s, { x: -40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: "expo.out" }, 17.55 + i * 0.12));

  // chat
  tl.fromTo(chat, { y: 90, scale: 0.94, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.6, ease: "expo.out" }, A + 0.2);
  tl.fromTo("#m1", { y: 30, opacity: 0, scale: 0.9 }, { y: 0, opacity: 1, scale: 1, duration: 0.35, ease: "back.out(2)" }, 16.9);
  typed($("#u-t"), "I want to watch my movies on the TV.", 17.0, 17.72);
  proc((t) => { $("#u-c").style.visibility = t >= 17.0 && t < 17.8 ? "visible" : "hidden"; });
  tl.fromTo("#m2", { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "expo.out" }, 17.85);
  tl.fromTo("#r1", { opacity: 0 }, { opacity: 1, duration: 0.15 }, 18.1);
  tl.fromTo("#r2", { opacity: 0 }, { opacity: 1, duration: 0.15 }, 18.4);
  tl.fromTo("#m3", { y: 50, opacity: 0, scale: 0.94 }, { y: 0, opacity: 1, scale: 1, duration: 0.5, ease: "expo.out" }, 18.5);
  $$("#m3 .pl-r").forEach((r, i) => tl.fromTo(r, { x: -30, opacity: 0 }, { x: 0, opacity: 1, duration: 0.4, ease: "expo.out" }, 18.65 + i * 0.1));
  $$("#m3 .pl-r img").forEach((im, i) => tl.fromTo(im, { scale: 0, rotation: -60 }, { scale: 1, rotation: 0, duration: 0.35, ease: "back.out(2.4)" }, 18.75 + i * 0.05));
  tl.fromTo("#m3 .pl-b", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.35, ease: "expo.out" }, 19.15);

  const btn = $("#btn-ok");
  root.style.display = "block";
  const rb = measure(btn);
  root.style.display = "none";
  const cur = $("#cursor");
  tl.fromTo(cur, { x: 1760, y: 1040, opacity: 0 }, { x: rb.cx - 6, y: rb.cy - 4, opacity: 1, duration: 0.7, ease: "power3.inOut" }, 19.15);
  tl.fromTo(cur, { scale: 1 }, { scale: 0.82, duration: 0.07, yoyo: true, repeat: 1 }, 19.86);
  tl.fromTo(btn, { scale: 1 }, { scale: 0.94, duration: 0.07, yoyo: true, repeat: 1 }, 19.86);
  tl.fromTo(cur, { opacity: 1 }, { opacity: 0, duration: 0.2 }, 20.3);
  proc((t) => {
    const ok = t >= 19.9;
    btn.classList.toggle("ok", ok);
    btn.innerHTML = ok ? "Approved ✓" : "Approve &amp; install";
  });

  tl.fromTo("#flow", { y: 0 }, { y: -96, duration: 0.5, ease: "power3.out" }, 19.95);
  tl.fromTo("#m4", { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: "expo.out" }, 20.0);
  $$("#m4 .cp").forEach((c, i) => tl.fromTo(c, { scale: 0.2, opacity: 0.25 }, { scale: 1, opacity: 1, duration: 0.3, ease: "back.out(3)" }, 20.3 + i * 0.13));
  proc((t) => {
    const p = prog(t, 20.1, 21.2);
    $("#prog-f").style.width = `${p * 100}%`;
    $("#prog-n").textContent = `${Math.min(7, Math.floor(prog(t, 20.3, 21.2) * 7 + 0.3))}/7`;
  });
  tl.fromTo("#flow", { y: -96 }, { y: -310, duration: 0.5, ease: "power3.out" }, 21.25);
  tl.fromTo("#m5", { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "expo.out" }, 21.3);
  tl.fromTo("#m5 .link", { scale: 0.85 }, { scale: 1, duration: 0.45, ease: "back.out(2.4)" }, 21.55);
  tl.fromTo("#chat", { boxShadow: "0 0 0 rgba(0,215,135,0)" }, { boxShadow: "0 0 120px rgba(0,215,135,0.35)", duration: 0.6 }, 21.4);
}
