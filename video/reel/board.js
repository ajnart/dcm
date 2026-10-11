import { $, $$, proc, prog, scene, icon, read, cue, on, cut, drift, p3o } from "./lib.js";
import { SC, b } from "./timeline.js";

const [A, B] = SC.board;
const TILES = [["qbittorrent", "qBittorrent"], ["sonarr", "Sonarr"], ["radarr", "Radarr"], ["prowlarr", "Prowlarr"], ["jellyfin", "Jellyfin"], ["seerr", "Seerr"], ["homarr", "Homarr"]];

// Widgets are the kinds homarr/links.go adds per target: downloads (qBittorrent), mediaServer (Jellyfin),
// mediaRequests-requestList (Seerr), calendar (Sonarr/Radarr), indexerManager (Prowlarr), mediaReleases (Jellyfin).
// beats: 0 the whip up: the board tilts flat with its App tiles · 1 the large widgets, the numbers run up ·
// 2 the small widgets · 3.5 the camera dives into the board, into the next scene
const T = { in: A, big: A + b(1), small: A + b(2), dive: B - b(0.5) };

export function build(tl) {
  const root = scene("boardsc", A, B);
  cut(A, "Homarr board");
  drift($("#board-drift"), A, T.dive, { s0: 1, s1: 1.03 });
  tl.fromTo(root, { y: 420 }, { y: 0, duration: 0.45, ease: "expo.out" }, A);
  const board = $("#board");
  board.innerHTML = `
    <div class="bh"><img src="${icon("homarr")}"><b>Homarr</b><span class="dim">Home board</span><span class="bpill">192.168.1.20:7575</span></div>
    <div class="btiles">${TILES.map(([id, n]) => `<div class="bt1"><img src="${icon(id)}"><span>${n}</span></div>`).join("")}</div>
    <div class="bw">
      <div class="wd"><div class="wt"><img src="${icon("qbittorrent")}">Downloads</div><div class="big">↓ <span id="bn-a">24.1</span><small> MB/s</small></div><svg viewBox="0 0 400 90" class="spark"><path id="sp-a" d="M0 70 C40 60 60 20 100 44 S160 80 200 40 S270 10 300 38 S360 60 400 20" fill="none" stroke="#a88df2" stroke-width="4" stroke-linecap="square"/></svg></div>
      <div class="wd"><div class="wt"><img src="${icon("jellyfin")}">Media server</div><div class="big"><span id="bn-b">3</span><small> streaming</small></div><div class="posters"><i style="background:#7a57d3"></i><i style="background:#00a86b"></i><i style="background:#c98a12"></i><i style="background:#3d7fc4"></i></div></div>
      <div class="wd"><div class="wt"><img src="${icon("seerr")}">Requests</div><div class="big"><span id="bn-c">2</span><small> pending</small></div><div class="req"><span>Dune: Part Two</span><span>Severance S2</span></div></div>
    </div>
    <div class="bf">
      <div class="wd sm"><img src="${icon("sonarr")}"><div><div class="wt2">Calendar</div><div class="ws">3 episodes this week</div></div></div>
      <div class="wd sm"><img src="${icon("prowlarr")}"><div><div class="wt2">Indexers</div><div class="ws">All healthy</div></div></div>
      <div class="wd sm"><img src="${icon("jellyfin")}"><div><div class="wt2">Latest releases</div><div class="ws">Added to your library</div></div></div>
    </div>`;
  const cam = $("#board-cam");
  cam.style.perspective = "2400px";
  tl.fromTo(board, { rotationX: 24, transformOrigin: "50% 100%" }, { rotationX: 0, duration: 0.7, ease: "expo.out" }, A);
  $$(".bt1", board).forEach((el, i) => tl.fromTo(el, { y: 50, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: "expo.out" }, A + 0.08 + i * 0.025));
  $$(".bw .wd", board).forEach((el, i) => tl.fromTo(el, { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: "expo.out" }, T.big + i * 0.04));
  $$(".bf .wd", board).forEach((el, i) => tl.fromTo(el, { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: "expo.out" }, T.small + i * 0.04));
  tl.fromTo("#sp-a", { strokeDasharray: 600, strokeDashoffset: 600 }, { strokeDashoffset: 0, duration: 0.6, ease: "expo.out" }, T.big);
  const na = $("#bn-a"), nb = $("#bn-b"), nc = $("#bn-c");
  proc((t) => {
    const p = p3o(prog(t, T.big, T.big + 0.6));
    na.textContent = (24.1 * p).toFixed(1);
    nb.textContent = String(Math.round(3 * p));
    nc.textContent = String(Math.round(2 * p));
  });
  on(T.big, "large widgets");
  on(T.small, "small widgets");
  [0, 1, 2].forEach((i) => cue(T.big + i * 0.04 + 0.05, "pop", { i: i + 2 }));
  [0, 1, 2].forEach((i) => cue(T.small + i * 0.04 + 0.05, "pop", { i: i + 4, soft: true }));

  // the dive: the camera rushes into the board and the next scene cuts in on the downbeat
  tl.fromTo(cam, { scale: 1, transformOrigin: "50% 55%" }, { scale: 1.6, duration: B - T.dive, ease: "expo.in" }, T.dive);
  on(T.dive, "the camera dives into the board");
  cue(B - 0.05, "whoosh", { dur: 0.4 });

  const w = $("#cap-board .w");
  tl.fromTo(w, { yPercent: 110 }, { yPercent: 0, duration: 0.4, ease: "expo.out" }, A + 0.1);
  tl.fromTo(w, { yPercent: 0 }, { yPercent: -110, duration: 0.2, ease: "power3.in" }, T.dive);
  read("#cap-board", A + 0.5, T.dive - 0.01);
}
