import { gsap, $, $$, proc, prog, scene, icon, read, cue, on, cut } from "./lib.js";
import { SC, b } from "./timeline.js";

const [A, B] = SC.setup;
// beats: 0 the TUI (a match cut from the Compose Project box), "Sets up every App." · then one App ready
// on each beat from 1 while the camera eases in on the Apps box · 6 the Links start · 7 the camera pushes
// into the Links box
const STEP = 0.5;
const APPS = [
  ["qbittorrent", "qBittorrent"], ["sonarr", "Sonarr"], ["radarr", "Radarr"], ["prowlarr", "Prowlarr"],
  ["jellyfin", "Jellyfin"], ["seerr", "Seerr"], ["homarr", "Homarr"],
].map(([id, name], i) => ({ id, name, s: A + i * STEP, e: A + (i + 1) * STEP }));
// the Links each App declares (new-cli/internal/apps/{arr,seerr,homarr})
export const LINKS = [
  ["sonarr", "Sonarr", "qbittorrent", "qBittorrent"],
  ["radarr", "Radarr", "qbittorrent", "qBittorrent"],
  ["prowlarr", "Prowlarr", "sonarr", "Sonarr"],
  ["prowlarr", "Prowlarr", "radarr", "Radarr"],
  ["seerr", "Seerr", "jellyfin", "Jellyfin"],
  ["seerr", "Seerr", "sonarr", "Sonarr"],
  ["homarr", "Homarr", "jellyfin", "Jellyfin"],
];
const L0 = APPS[5].e, LSTEP = 0.06, LFILL = 0.22;
const SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const spin = (t) => SPIN[Math.floor(t * 14) % 10];
const CAP_IN = A, PUSH = b(27);

export function build(tl) {
  scene("setup", A, B);
  cut(A, "the TUI");
  const win = $("#win");
  win.innerHTML = `
    <div class="tb"><i></i><i></i><i></i><span>self-host</span></div>
    <div class="hd"><div class="hl"><b class="d">◆</b> <b>homelab</b><span class="dim">  ~/.self-host</span></div><div class="hr"><span class="dim">LAN </span>192.168.1.20<span class="dim">  ·  </span><span class="okc">●</span> ok<span class="dim">  ·  </span>14:32</div></div>
    <div class="tabs"><span><i>1</i> Overview</span><span><i>2</i> Apps</span><span class="on"><i>3</i> Activity</span><span><i>4</i> Catalog</span><span><i>5</i> Settings</span></div>
    <div class="act">
      <div class="a-title" id="a-title"></div>
      <div class="a-stages" id="a-stages"></div>
      <div class="boxes">
        <div class="box"><div class="bt"><span>Apps</span><em id="apps-count"></em></div><div class="bb" id="apps-rows"></div></div>
        <div class="box"><div class="bt"><span>Links</span><em id="links-count"></em></div><div class="bb" id="links-rows"></div></div>
      </div>
      <div class="a-narr" id="a-narr"></div>
    </div>
    <div class="keys"><span><kbd>tab</kbd> next</span><span><kbd>1-5</kbd> tabs</span><span><kbd>/</kbd> search</span><span><kbd>?</kbd> help</span><span><kbd>q</kbd> quit</span></div>`;

  $("#links-rows").innerHTML = LINKS.map(([c, cn, tg, tn]) => `<div class="lk"><img src="${icon(c)}"><span class="ln1">${cn}</span><span class="ln-line"><i class="fillbar"></i><b class="head">▶</b></span><img src="${icon(tg)}"><span class="ln2">${tn}</span><span class="lst"></span></div>`).join("");
  const lkEls = $$("#links-rows .lk");
  const appsRows = $("#apps-rows");
  APPS.forEach((a, i) => {
    on(a.e, `${a.name} ready`);
    cue(a.e, "check", { i });
    cue(a.s + STEP * 0.3, "tick", { soft: true, pan: 0.3 });
    cue(a.s + STEP * 0.62, "tick", { soft: true, pan: -0.3 });
  });
  LINKS.forEach((_, k) => cue(L0 + k * LSTEP + LFILL, "tick", { pan: k % 2 ? 0.4 : -0.4 }));

  proc((t) => {
    if (t < A || t > B) return;
    $("#apps-count").textContent = `${APPS.filter((a) => t >= a.e).length}/7 set up`;
    let html = "";
    APPS.forEach((a, i) => {
      const running = t >= a.s && t < a.e;
      const done = t >= a.e;
      const lit = done && t - a.e < 0.25;
      let mark = `<span class="faintc">○</span>`, fact = "waiting", cls = "muted";
      if (running) { mark = `<span class="acc">${spin(t)}</span>`; fact = "setting up"; cls = "bright"; }
      if (done) { mark = lit ? `<span class="okc b">◉</span>` : `<span class="okc">●</span>`; fact = "ready"; cls = lit ? "okc b" : "text"; }
      html += `<div class="ar"><span class="mk1">${mark}</span><img src="${icon(a.id)}"><span class="an ${cls}">${a.name}</span><span class="af">${fact}</span></div>`;
      if (running) {
        const p = prog(t, a.s, a.e);
        const steps = [[`wait for the ${a.name} API`, 0.0], [`read the ${a.name} API key`, 0.3], [i === 0 ? "set the web login" : "create the admin account", 0.62]];
        steps.forEach(([label, at], k) => {
          if (p < at) return;
          const dn = k < 2 && p >= steps[k + 1][1];
          const dots = k > 0 ? (dn ? `<span class="muted">••••••</span> <span class="saved">saved</span>` : `<span class="acc">••••</span>`) : "";
          html += `<div class="st">${dn ? '<span class="okc">✓</span>' : `<span class="acc">${spin(t)}</span>`} <span class="text">${label}</span> ${dots}</div>`;
        });
      }
    });
    appsRows.innerHTML = html;

    let linked = 0;
    lkEls.forEach((el, k) => {
      const p = prog(t, L0 + k * LSTEP, L0 + k * LSTEP + LFILL);
      if (p >= 1) linked++;
      $(".fillbar", el).style.width = `${(1 - Math.pow(1 - p, 3)) * 100}%`;
      const head = $(".head", el);
      head.style.opacity = p > 0.85 ? 1 : 0;
      head.style.color = p >= 1 ? "#00d787" : "#a88df2";
      $(".ln-line", el).style.setProperty("--c", p >= 1 ? "#00d787" : "#a88df2");
      $(".lst", el).innerHTML = p >= 1 ? '<span class="okc">✓</span>' : p > 0 ? `<span class="acc">${spin(t)}</span>` : '<span class="faintc">○</span>';
      el.style.opacity = p > 0 ? 1 : 0.4;
    });
    $("#links-count").textContent = `${linked}/7 linked`;

    const setupDone = t >= APPS[6].e;
    const mk = (d, run, ico) => `${d ? '<span class="okc">✓</span>' : run ? `<span class="acc">${spin(t)}</span>` : '<span class="faintc">○</span>'} <span class="${run ? "bright b" : d ? "text" : "muted"}">${ico}</span>`;
    $("#a-stages").innerHTML = [
      mk(true, false, "▣ Pull"), mk(true, false, "▣ Start"), mk(setupDone, !setupDone, "Setup"),
      mk(setupDone, !setupDone, "✱ Credentials"), mk(false, setupDone, "⇄ Links"), mk(false, false, "Check"),
    ].join('<span class="gap"></span>');
    $("#a-title").innerHTML = `<span class="acc">${spin(t)}</span> <b>install qbittorrent sonarr radarr prowlarr jellyfin seerr homarr</b>`;
    const run = APPS.find((a) => t >= a.s && t < a.e);
    const narr = run ? `Setting up ${run.name}: ${t - run.s > STEP * 0.62 ? "create the admin account" : "read the API key"}` : setupDone ? "Linking the Apps together" : "Pulled 7 images and started 7 Apps";
    $("#a-narr").innerHTML = `<span class="text">${narr}</span>`;
  });

  // the camera eases in on the Apps box while they set up, then pushes into the Links box, which the
  // next scene opens out of
  const cam = $("#setup-cam");
  const view = (px, py, s) => ({ x: 960 - px * s, y: 540 - py * s, scale: s });
  gsap.set(cam, { transformOrigin: "0 0" });
  tl.fromTo(cam, { ...view(960, 540, 1.0) }, { ...view(840, 600, 1.16), duration: PUSH - A, ease: "power2.inOut" }, A);
  tl.fromTo(cam, { ...view(840, 600, 1.16) }, { ...view(1310, 690, 2.6), duration: 0.5, ease: "expo.in" }, PUSH);
  on(PUSH, "push into the Links box");
  cue(B - 0.08, "whoosh", { dur: 0.5, pan: 0.5 });

  const w = $("#cap-setup .w");
  tl.fromTo(w, { yPercent: 110 }, { yPercent: 0, duration: 0.4, ease: "expo.out" }, CAP_IN);
  read("#cap-setup", CAP_IN + 0.4, B - 0.01);
}
