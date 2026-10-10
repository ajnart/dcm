import { gsap, $, $$, scene, icon, read, cue } from "./lib.js";
import { SC, shown } from "./timeline.js";

const [A, B] = SC.board;
const TILES = [["qbittorrent", "qBittorrent"], ["sonarr", "Sonarr"], ["radarr", "Radarr"], ["prowlarr", "Prowlarr"], ["jellyfin", "Jellyfin"], ["seerr", "Seerr"], ["homarr", "Homarr"]];
const CAP_IN = A + 0.15, OUT = B - 0.2;

// Widgets are the kinds homarr/links.go adds per target: downloads (qBittorrent), mediaServer (Jellyfin),
// mediaRequests-requestList (Seerr), calendar (Sonarr/Radarr), indexerManager (Prowlarr), mediaReleases (Jellyfin).
export function build(tl) {
  const root = scene("boardsc", A, shown("board"));
  tl.fromTo(root, { clipPath: "circle(0px at 960px 640px)" }, { clipPath: "circle(1400px at 960px 640px)", duration: 0.45, ease: "power3.out" }, A);
  cue(A, "whoosh", { dur: 0.45, pan: -0.3 });
  const board = $("#board");
  board.innerHTML = `
    <div class="bh"><img src="${icon("homarr")}"><b>Homarr</b><span class="dim">Home board</span><span class="bpill">192.168.1.20:7575</span></div>
    <div class="btiles">${TILES.map(([id, n]) => `<div class="bt1"><img src="${icon(id)}"><span>${n}</span></div>`).join("")}</div>
    <div class="bw">
      <div class="wd"><div class="wt"><img src="${icon("qbittorrent")}">Downloads</div><div class="big">↓ 24.1<small> MB/s</small></div><svg viewBox="0 0 400 90" class="spark"><path id="sp-a" d="M0 70 C40 60 60 20 100 44 S160 80 200 40 S270 10 300 38 S360 60 400 20" fill="none" stroke="#a88df2" stroke-width="4" stroke-linecap="round"/></svg></div>
      <div class="wd"><div class="wt"><img src="${icon("jellyfin")}">Media server</div><div class="big">3<small> streaming</small></div><div class="posters"><i style="background:linear-gradient(160deg,#7a57d3,#2b2140)"></i><i style="background:linear-gradient(160deg,#00d787,#0b2a22)"></i><i style="background:linear-gradient(160deg,#ffaf00,#3a2a0a)"></i><i style="background:linear-gradient(160deg,#5fafff,#10243a)"></i></div></div>
      <div class="wd"><div class="wt"><img src="${icon("seerr")}">Requests</div><div class="big">2<small> pending</small></div><div class="req"><span>Dune: Part Two</span><span>Severance S2</span></div></div>
    </div>
    <div class="bf">
      <div class="wd sm"><img src="${icon("sonarr")}"><div><div class="wt2">Calendar</div><div class="ws">3 episodes this week</div></div></div>
      <div class="wd sm"><img src="${icon("prowlarr")}"><div><div class="wt2">Indexers</div><div class="ws">All healthy</div></div></div>
      <div class="wd sm"><img src="${icon("jellyfin")}"><div><div class="wt2">Latest releases</div><div class="ws">Added to your library</div></div></div>
    </div>`;
  const T0 = A + 0.1;
  tl.fromTo(board, { rotationX: 24, y: 120, opacity: 0, transformPerspective: 2600 }, { rotationX: 0, y: 0, opacity: 1, duration: 0.6, ease: "expo.out" }, T0);
  $$(".bt1", board).forEach((el, i) => {
    tl.fromTo(el, { y: 160, scale: 0.2, rotation: -25, opacity: 0 }, { y: 0, scale: 1, rotation: 0, opacity: 1, duration: 0.55, ease: "back.out(1.7)" }, T0 + 0.25 + i * 0.06);
    cue(T0 + 0.45 + i * 0.06, "pop", { i, soft: 1 });
  });
  $$(".wd", board).forEach((el, i) => {
    tl.fromTo(el, { y: 70, scale: 0.88, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.5, ease: "expo.out" }, T0 + 0.6 + i * 0.07);
  });
  tl.fromTo("#sp-a", { strokeDasharray: 600, strokeDashoffset: 600 }, { strokeDashoffset: 0, duration: 0.8, ease: "power2.out" }, T0 + 0.8);
  tl.fromTo("#board-cam", { scale: 1 }, { scale: 1.035, duration: B - A, ease: "none" }, A);
  tl.fromTo("#board-cam", { opacity: 1 }, { opacity: 0, duration: 0.2 }, OUT);

  const w = $("#cap-board .w");
  tl.fromTo(w, { yPercent: 190, rotation: 3 }, { yPercent: 0, rotation: 0, duration: 0.55, ease: "expo.out" }, CAP_IN);
  tl.fromTo(w, { yPercent: 0 }, { yPercent: -190, duration: 0.2, ease: "power3.in" }, OUT);
  cue(CAP_IN + 0.04, "thump", { i: 2 });
  read("#cap-board", CAP_IN + 0.6, OUT);
}
