import { gsap, $, $$, proc, prog, clamp, lerp, scene, icon, words } from "./lib.js";

const A = 9.98, B = 14.95;
const APPS = [
  { id: "qbittorrent", name: "qBittorrent", api: "qBittorrent", s: 10.1, e: 10.4 },
  { id: "sonarr", name: "Sonarr", api: "Sonarr", s: 10.4, e: 10.78 },
  { id: "radarr", name: "Radarr", api: "Radarr", s: 10.78, e: 11.12 },
  { id: "prowlarr", name: "Prowlarr", api: "Prowlarr", s: 11.12, e: 11.46 },
  { id: "jellyfin", name: "Jellyfin", api: "Jellyfin", s: 11.46, e: 11.8 },
  { id: "seerr", name: "Seerr", api: "Seerr", s: 11.8, e: 12.14 },
  { id: "homarr", name: "Homarr", api: "Homarr", s: 12.14, e: 12.5 },
];
const LINKS = [
  ["sonarr", "Sonarr", "qbittorrent", "qBittorrent"],
  ["radarr", "Radarr", "qbittorrent", "qBittorrent"],
  ["prowlarr", "Prowlarr", "sonarr", "Sonarr"],
  ["prowlarr", "Prowlarr", "radarr", "Radarr"],
  ["seerr", "Seerr", "jellyfin", "Jellyfin"],
  ["seerr", "Seerr", "sonarr", "Sonarr"],
  ["homarr", "Homarr", "jellyfin", "Jellyfin"],
];
const L0 = 12.0, LSTEP = 0.17, LFILL = 0.3;
const LDONE = L0 + (LINKS.length - 1) * LSTEP + LFILL;
const FLIP = 13.62;
const SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const spin = (t) => SPIN[Math.floor(t * 14) % 10];

const BOARD_TILES = [["qbittorrent", "qBittorrent"], ["sonarr", "Sonarr"], ["radarr", "Radarr"], ["prowlarr", "Prowlarr"], ["jellyfin", "Jellyfin"], ["seerr", "Seerr"], ["homarr", "Homarr"]];

export function build(tl) {
  const root = scene("s5", A, B);
  const win = $("#win");
  win.innerHTML = `
    <div class="tb"><i></i><i></i><i></i><span>self-host</span></div>
    <div class="hd"><div class="hl"><b class="d">◆</b> <b>homelab</b><span class="dim">  ~/.self-host</span></div><div class="hr"><span class="dim">LAN </span>192.168.1.20<span class="dim">  ·  </span><span class="okc">●</span> ok<span class="dim">  ·  </span>14:32</div></div>
    <div class="tabs"><span><i>1</i> Overview</span><span><i>2</i> Apps</span><span class="on"><i>3</i> Activity</span><span><i>4</i> Catalog</span><span><i>5</i> Settings</span></div>
    <div class="act">
      <div class="a-title" id="a-title"></div>
      <div class="a-stages" id="a-stages"></div>
      <div class="boxes">
        <div class="box" id="apps-box"><div class="bt"><span>Apps</span><em id="apps-count"></em></div><div class="bb" id="apps-rows"></div></div>
        <div class="box" id="links-box"><div class="bt"><span>Links</span><em id="links-count"></em></div><div class="bb" id="links-rows"></div></div>
      </div>
      <div class="a-narr" id="a-narr"></div>
    </div>
    <div class="keys"><span><kbd>tab</kbd> next</span><span><kbd>1-5</kbd> tabs</span><span><kbd>/</kbd> search</span><span><kbd>?</kbd> help</span><span><kbd>q</kbd> quit</span></div>`;

  const linkRows = LINKS.map(([c, cn, tg, tn]) => `<div class="lk"><img src="${icon(c)}"><span class="ln1">${cn}</span><span class="ln-line"><i class="fillbar"></i><b class="head">▶</b></span><img src="${icon(tg)}"><span class="ln2">${tn}</span><span class="lst"></span></div>`).join("");
  $("#links-rows").innerHTML = linkRows;
  const lkEls = $$("#links-rows .lk");
  const appsRows = $("#apps-rows");

  proc((t) => {
    const tau = t - 10;
    const doneCount = APPS.filter((a) => t >= a.e).length;
    $("#apps-count").textContent = `${doneCount}/7 set up`;
    let html = "";
    APPS.forEach((a, i) => {
      const running = t >= a.s && t < a.e;
      const done = t >= a.e;
      const pulse = done && t - a.e < 0.25;
      const wave = t >= LDONE + 0.25 && t < LDONE + 0.25 + 7 * 0.08 + 0.3 ? (t - LDONE - 0.25 - i * 0.08) : -1;
      const lit = pulse || (wave >= 0 && wave < 0.25);
      let mark = `<span class="faintc">○</span>`, fact = "waiting", cls = "muted";
      if (running) { mark = `<span class="acc">${spin(t)}</span>`; fact = "setting up"; cls = "bright"; }
      if (done) { mark = lit ? `<span class="okc b">◉</span>` : `<span class="okc">●</span>`; fact = "ready"; cls = lit ? "okc b" : "text"; }
      html += `<div class="ar"><span class="mk1">${mark}</span><img src="${icon(a.id)}"><span class="an ${cls}">${a.name}</span><span class="af">${fact}</span></div>`;
      if (running) {
        const p = prog(t, a.s, a.e);
        const steps = [[`wait for the ${a.api} API`, 0.0], [`read the ${a.api} API key`, 0.28], [i === 0 ? "set the web login" : "create the admin account", 0.58]];
        steps.forEach(([label, at], k) => {
          if (p < at) return;
          const dn = p >= at + 0.3 || k < 2 && p >= steps[k + 1][1];
          const dots = k > 0 ? (dn ? `<span class="muted">••••••</span> <span class="saved">saved</span>` : `<span class="acc">${"•".repeat(Math.min(5, Math.floor((p - at) / 0.06)))}</span><span class="faintc">${"·".repeat(6 - Math.min(5, Math.floor((p - at) / 0.06)))}</span>`) : "";
          html += `<div class="st">${dn ? '<span class="okc">✓</span>' : `<span class="acc">${spin(t)}</span>`} <span class="text">${label}</span> ${dots}</div>`;
        });
      }
    });
    appsRows.innerHTML = html;

    let linked = 0;
    lkEls.forEach((el, k) => {
      const p = prog(t, L0 + k * LSTEP, L0 + k * LSTEP + LFILL);
      const e = 1 - Math.pow(1 - p, 3);
      if (p >= 1) linked++;
      $(".fillbar", el).style.width = `${e * 100}%`;
      const head = $(".head", el);
      head.style.opacity = p > 0.85 ? 1 : 0;
      head.style.color = p >= 1 ? "#00d787" : "#a88df2";
      $(".ln-line", el).style.setProperty("--c", p >= 1 ? "#00d787" : "#a88df2");
      const st = $(".lst", el);
      st.innerHTML = p >= 1 ? '<span class="okc">✓</span>' : p > 0 ? `<span class="acc">${spin(t)}</span>` : '<span class="faintc">○</span>';
      el.style.opacity = t >= L0 + k * LSTEP - 0.2 ? 1 : 0.35;
      const snap = t - (L0 + k * LSTEP + LFILL);
      el.style.background = snap >= 0 && snap < 0.3 ? `rgba(0,215,135,${0.18 * (1 - snap / 0.3)})` : "transparent";
    });
    $("#links-count").textContent = `${linked}/7 linked`;

    const setupDone = t >= APPS[6].e + 0.1;
    const linksRun = t >= L0 - 0.1 && t < LDONE;
    const allDone = t >= LDONE + 0.05;
    const mk = (d, run, ico) => `${d ? '<span class="okc">✓</span>' : run ? `<span class="acc">${spin(t)}</span>` : '<span class="faintc">○</span>'} <span class="${run ? "bright b" : d ? "text" : "muted"}">${ico}</span>`;
    $("#a-stages").innerHTML = [
      mk(true, false, "▣ Pull"), mk(true, false, "▣ Start"), mk(setupDone, !setupDone, "Setup"),
      mk(setupDone, !setupDone, "✱ Credentials"), mk(allDone, linksRun, "⇄ Links"), mk(allDone, false, "Check"),
    ].join('<span class="gap"></span>');
    $("#a-title").innerHTML = `${allDone ? '<span class="okc">✓</span>' : `<span class="acc">${spin(t)}</span>`} <b>install qbittorrent sonarr radarr prowlarr jellyfin seerr homarr</b>`;
    let narr = "Pulled 7 images and started 7 Apps";
    const run = APPS.find((a) => t >= a.s && t < a.e);
    if (run) narr = `Setting up ${run.name}: ${t - run.s > (run.e - run.s) * 0.58 ? "create the admin account" : "read the API key"}`;
    else if (linksRun) {
      const k = clamp(Math.floor((t - L0) / LSTEP), 0, 6);
      narr = `Linking ${LINKS[k][1]} to ${LINKS[k][3]}`;
    } else if (allDone) narr = "Everything is set up and linked. Dashboard: http://192.168.1.20:7575";
    $("#a-narr").innerHTML = allDone ? `<b class="bright">${narr}</b>` : `<span class="text">${narr}</span>`;
  });

  // window entrance and camera
  const cam = $("#s5-cam");
  const view = (px, py, s) => ({ x: 960 - px * s, y: 540 - py * s, scale: s });
  const W0 = { x: 220, y: 250 };
  const appsC = [W0.x + 28 + 350, W0.y + 380];
  const linksC = [W0.x + 28 + 350 + 722, W0.y + 380];
  const full = view(960, 560, 1);
  gsap.set(cam, { transformOrigin: "0 0" });
  tl.fromTo(win, { scale: 1.12, opacity: 0, y: 60 }, { scale: 1, opacity: 1, y: 0, duration: 0.5, ease: "expo.out" }, A);
  tl.fromTo(cam, { ...view(960, 600, 1.0) }, { ...view(appsC[0] + 30, appsC[1] - 30, 1.28), duration: 1.0, ease: "power3.out" }, A);
  tl.fromTo(cam, { ...view(appsC[0] + 30, appsC[1] - 30, 1.28) }, { ...view(linksC[0] - 100, linksC[1] - 30, 1.36), duration: 0.55, ease: "power3.inOut" }, 11.78);
  tl.fromTo(cam, { ...view(linksC[0] - 100, linksC[1] - 30, 1.36) }, { ...view(960, 610, 1.0), duration: 0.5, ease: "power3.inOut" }, 13.12);
  tl.fromTo(cam, { ...view(960, 610, 1.0) }, { ...view(960, 585, 1.07), duration: 1.4, ease: "none" }, 13.62);

  // headline captions
  const heads = ["Sets up every App.", "Links them together.", "Then builds your dashboard."];
  const hs = [[A + 0.2, 11.7], [11.74, 13.5], [13.54, 14.95]];
  heads.forEach((txt, i) => {
    const d = document.createElement("div");
    d.className = "hcap";
    d.innerHTML = `<span class="mk"><span class="w">${txt}</span></span>`;
    $("#s5-heads").appendChild(d);
    const w = $(".w", d);
    tl.fromTo(w, { yPercent: 190, rotation: 3 }, { yPercent: 0, rotation: 0, duration: 0.55, ease: "expo.out" }, hs[i][0]);
    if (i < 2) tl.fromTo(w, { yPercent: 0 }, { yPercent: -190, duration: 0.28, ease: "power3.in" }, hs[i][1] - 0.04);
  });

  // board
  buildBoard(tl);
  tl.fromTo(win, { rotationY: 0, transformPerspective: 2600 }, { rotationY: -88, duration: 0.3, ease: "power2.in" }, FLIP - 0.2);
  tl.fromTo(win, { opacity: 1 }, { opacity: 0, duration: 0.01 }, FLIP + 0.1);
}

function buildBoard(tl) {
  const board = $("#board");
  board.innerHTML = `
    <div class="bh"><img src="${icon("homarr")}"><b>Homarr</b><span class="dim">Home board</span><span class="bpill">192.168.1.20:7575</span></div>
    <div class="btiles">${BOARD_TILES.map(([id, n]) => `<div class="bt1"><img src="${icon(id)}"><span>${n}</span></div>`).join("")}</div>
    <div class="bw">
      <div class="wd" id="wd1"><div class="wt"><img src="${icon("qbittorrent")}">Downloads</div><div class="big">↓ 24.1<small> MB/s</small></div><svg viewBox="0 0 400 90" class="spark"><path id="sp-a" d="M0 70 C40 60 60 20 100 44 S160 80 200 40 S270 10 300 38 S360 60 400 20" fill="none" stroke="#a88df2" stroke-width="4" stroke-linecap="round"/></svg></div>
      <div class="wd" id="wd2"><div class="wt"><img src="${icon("jellyfin")}">Now playing</div><div class="big">3<small> watching</small></div><div class="posters"><i style="background:linear-gradient(160deg,#7a57d3,#2b2140)"></i><i style="background:linear-gradient(160deg,#00d787,#0b2a22)"></i><i style="background:linear-gradient(160deg,#ffaf00,#3a2a0a)"></i><i style="background:linear-gradient(160deg,#5fafff,#10243a)"></i></div></div>
      <div class="wd" id="wd3"><div class="wt"><img src="${icon("seerr")}">Requests</div><div class="big">2<small> pending</small></div><div class="req"><span>Dune: Part Two</span><span>Severance S2</span></div></div>
    </div>
    <div class="bf">
      <div class="wd sm" id="wf1"><b>⚿</b><div><div class="wt2">Admin login</div><div class="ws">One login, every App</div></div></div>
      <div class="wd sm" id="wf2"><b>▣</b><div><div class="wt2">Backups</div><div class="ws">Encrypted, restore any App</div></div></div>
      <div class="wd sm" id="wf3"><b>⌁</b><div><div class="wt2">Exposure</div><div class="ws">Local network only</div></div></div>
    </div>`;
  const T0 = FLIP + 0.04;
  tl.fromTo(board, { rotationY: 88, transformPerspective: 2600 }, { rotationY: 0, duration: 0.42, ease: "back.out(1.2)" }, FLIP + 0.08);
  tl.fromTo(board, { opacity: 0 }, { opacity: 1, duration: 0.01 }, FLIP + 0.08);
  $$(".bt1", board).forEach((el, i) => {
    tl.fromTo(el, { y: 160, scale: 0.2, rotation: -25, opacity: 0 }, { y: 0, scale: 1, rotation: 0, opacity: 1, duration: 0.55, ease: "back.out(1.7)" }, T0 + 0.34 + i * 0.06);
  });
  ["wd1", "wd2", "wd3", "wf1", "wf2", "wf3"].forEach((id, i) => {
    tl.fromTo("#" + id, { y: 70, scale: 0.88, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.5, ease: "expo.out" }, T0 + 0.62 + i * 0.07);
  });
  tl.fromTo("#sp-a", { strokeDasharray: 600, strokeDashoffset: 600 }, { strokeDashoffset: 0, duration: 0.8, ease: "power2.out" }, T0 + 0.8);
}
