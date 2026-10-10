import { $, $$, scene, icon, read, on, cut } from "./lib.js";
import { SC, b } from "./timeline.js";

const [A, B] = SC.board;
const TILES = [["qbittorrent", "qBittorrent"], ["sonarr", "Sonarr"], ["radarr", "Radarr"], ["prowlarr", "Prowlarr"], ["jellyfin", "Jellyfin"], ["seerr", "Seerr"], ["homarr", "Homarr"]];
const IN = 0.2;

// Widgets are the kinds homarr/links.go adds per target: downloads (qBittorrent), mediaServer (Jellyfin),
// mediaRequests-requestList (Seerr), calendar (Sonarr/Radarr), indexerManager (Prowlarr), mediaReleases (Jellyfin).
// beats: 0 the board and its App tiles · 1 the large widgets · 2 the small widgets
export function build(tl) {
  const root = scene("boardsc", A, B);
  tl.fromTo(root, { clipPath: "circle(0px at 960px 630px)" }, { clipPath: "circle(1250px at 960px 630px)", duration: 0.3, ease: "expo.out" }, A);
  cut(A, "Homarr board");
  const board = $("#board");
  board.innerHTML = `
    <div class="bh"><img src="${icon("homarr")}"><b>Homarr</b><span class="dim">Home board</span><span class="bpill">192.168.1.20:7575</span></div>
    <div class="btiles">${TILES.map(([id, n]) => `<div class="bt1"><img src="${icon(id)}"><span>${n}</span></div>`).join("")}</div>
    <div class="bw">
      <div class="wd"><div class="wt"><img src="${icon("qbittorrent")}">Downloads</div><div class="big">↓ 24.1<small> MB/s</small></div><svg viewBox="0 0 400 90" class="spark"><path id="sp-a" d="M0 70 C40 60 60 20 100 44 S160 80 200 40 S270 10 300 38 S360 60 400 20" fill="none" stroke="#a88df2" stroke-width="4" stroke-linecap="round"/></svg></div>
      <div class="wd"><div class="wt"><img src="${icon("jellyfin")}">Media server</div><div class="big">3<small> streaming</small></div><div class="posters"><i style="background:#7a57d3"></i><i style="background:#00a86b"></i><i style="background:#c98a12"></i><i style="background:#3d7fc4"></i></div></div>
      <div class="wd"><div class="wt"><img src="${icon("seerr")}">Requests</div><div class="big">2<small> pending</small></div><div class="req"><span>Dune: Part Two</span><span>Severance S2</span></div></div>
    </div>
    <div class="bf">
      <div class="wd sm"><img src="${icon("sonarr")}"><div><div class="wt2">Calendar</div><div class="ws">3 episodes this week</div></div></div>
      <div class="wd sm"><img src="${icon("prowlarr")}"><div><div class="wt2">Indexers</div><div class="ws">All healthy</div></div></div>
      <div class="wd sm"><img src="${icon("jellyfin")}"><div><div class="wt2">Latest releases</div><div class="ws">Added to your library</div></div></div>
    </div>`;
  $$(".bt1", board).forEach((el, i) => tl.fromTo(el, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: IN, ease: "expo.out" }, A + i * 0.025));
  $$(".bw .wd", board).forEach((el, i) => tl.fromTo(el, { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: IN, ease: "expo.out" }, b(33) + i * 0.03));
  $$(".bf .wd", board).forEach((el, i) => tl.fromTo(el, { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: IN, ease: "expo.out" }, b(34) + i * 0.03));
  tl.fromTo("#sp-a", { strokeDasharray: 600, strokeDashoffset: 600 }, { strokeDashoffset: 0, duration: 0.45, ease: "expo.out" }, b(33));
  on(b(33), "large widgets");
  on(b(34), "small widgets");

  const w = $("#cap-board .w");
  tl.fromTo(w, { yPercent: 110 }, { yPercent: 0, duration: IN, ease: "expo.out" }, A);
  read("#cap-board", A + IN, B - 0.01);
}
