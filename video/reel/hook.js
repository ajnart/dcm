import { gsap, $, $$, proc, prog, scene, icon, read, cue, on, cut, ICON } from "./lib.js";
import { SC, b } from "./timeline.js";

// Each rented service and the Catalog App that replaces it (self-host apps list --json):
// jellyfin "Streams your movies, shows and music to every screen", navidrome "Streams your own music library",
// nextcloud "Keeps your files, calendars and contacts in sync" (the files Recipe replaces Drive and Dropbox),
// syncthing "Keeps folders in sync between your own devices", immich "Private photo and video backup",
// vaultwarden "Password manager compatible with the Bitwarden apps", docmost "Collaborative wiki and
// documentation workspace", open-webui "Private chat interface for your own language models".
export const TILES = [
  { id: "netflix", name: "Netflix", price: 15, rep: "jellyfin", repName: "Jellyfin", edge: [150, 170] },
  { id: "spotify", name: "Spotify", price: 12, rep: "navidrome", repName: "Navidrome", edge: [600, 120] },
  { id: "google-drive", name: "Drive", price: 10, rep: "nextcloud", repName: "Nextcloud", edge: [1320, 120] },
  { id: "dropbox", name: "Dropbox", price: 12, rep: "syncthing", repName: "Syncthing", edge: [1770, 170] },
  { id: "google-photos", name: "Photos", price: 10, rep: "immich", repName: "Immich", edge: [150, 910] },
  { id: "1password", name: "1Password", price: 3, rep: "vaultwarden", repName: "Vaultwarden", edge: [600, 960] },
  { id: "notion", name: "Notion", price: 10, rep: "docmost", repExt: "png", repName: "Docmost", edge: [1320, 960] },
  { id: "chatgpt", name: "ChatGPT", price: 20, rep: "open-webui", repName: "Open WebUI", edge: [1770, 910] },
];
const [A, B] = SC.hook;
// beats: 0 Stop · 1 renting · 2 your software. · 3 tiles in · 4 prices · 5 tiles step in · 6 the wall,
// "Their servers." · 7 row 1 locks · 8 row 2 locks, $92 · 9 struck out · 10 flip, "Your servers.", $0 · 11 badges
const T = { stop: b(0), renting: b(1), your: b(2), tilesIn: b(3), prices: b(4), step: b(5), wall: b(6), lock1: b(7), lock2: b(8), strike: b(9), flip: b(10), badges: b(11) };
const IN = 0.2;
const WALL = (i) => [960 + ((i % 4) - 1.5) * 322, 560 + (Math.floor(i / 4) - 0.5) * 318];

export function build(tl) {
  scene("hook", A, B);
  const layer = $("#tiles");
  const nodes = TILES.map((tile, i) => {
    const el = document.createElement("div");
    el.className = "tile";
    el.innerHTML = `<div class="flip">
      <div class="face front"><img src="${icon(tile.id)}"><div class="nm">${tile.name}</div><div class="price">$${tile.price}/mo</div><div class="lock">${ICON.lock}</div></div>
      <div class="face back"><div class="was"><img src="${icon(tile.id)}"></div><img src="${icon(tile.rep, tile.repExt)}"><div class="nm">${tile.repName}</div><div class="price">yours</div></div>
    </div>`;
    layer.appendChild(el);
    return { tile, i, el, flip: $(".flip", el), lock: $(".lock", el), price: $(".front .price", el), was: $(".was", el) };
  });

  // tiles: in from beyond the frame edge on beat 3, prices on 4, one step inward on 5, the wall on 6
  nodes.forEach((n) => {
    const [ex, ey] = n.tile.edge;
    const dx = ex - 960, dy = ey - 540, len = Math.hypot(dx, dy);
    const sx = ex + (dx / len) * 700, sy = ey + (dy / len) * 700;
    const ix = ex - (dx / len) * 70, iy = ey - (dy / len) * 50;
    const [wx, wy] = WALL(n.i);
    tl.fromTo(n.el, { x: sx, y: sy, scale: 0.62, opacity: 0.5 }, { x: ex, y: ey, scale: 0.62, opacity: 0.5, duration: 0.4, ease: "expo.out" }, T.tilesIn + (n.i % 4) * 0.02);
    tl.fromTo(n.price, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.15, ease: "expo.out" }, T.prices);
    tl.fromTo(n.el, { x: ex, y: ey, scale: 0.62, opacity: 0.5 }, { x: ix, y: iy, scale: 0.7, opacity: 0.8, duration: 0.3, ease: "expo.out" }, T.step);
    tl.fromTo(n.el, { x: ix, y: iy, scale: 0.7, opacity: 0.8 }, { x: wx, y: wy, scale: 1, opacity: 1, duration: 0.32, ease: "expo.inOut" }, T.wall);
    const lockAt = n.i < 4 ? T.lock1 : T.lock2;
    tl.fromTo(n.lock, { scale: 0 }, { scale: 1, duration: 0.15, ease: "expo.out" }, lockAt + (n.i % 4) * 0.02);
    tl.fromTo(n.lock, { scale: 1 }, { scale: 0, duration: 0.1, ease: "power2.in" }, T.flip - 0.1);
    tl.fromTo(n.flip, { rotationY: 0 }, { rotationY: 180, duration: 0.28, ease: "power3.inOut" }, T.flip + (n.i % 4) * 0.02);
    tl.fromTo(n.was, { scale: 0 }, { scale: 1, duration: 0.15, ease: "expo.out" }, T.badges + (n.i % 4) * 0.02);
  });
  on(T.tilesIn, "rented tiles fly in");
  on(T.prices, "prices");
  on(T.step, "tiles step in");
  on(T.lock1, "row 1 locks");
  on(T.lock2, "row 2 locks, $92");
  on(T.badges, "was-badges");
  cue(T.lock1, "lock");
  cue(T.lock2, "lock");
  cue(T.flip, "flip");
  read($$(".front .nm", layer), T.wall + 0.34, T.flip - 0.12, "rented tile names");
  read($$(".front .price", layer), T.wall + 0.34, T.flip - 0.12, "rented prices");
  read($$(".back .nm", layer), T.flip + 0.36, B - 0.01, "replacement names");
  read($$(".back .price", layer), T.flip + 0.36, B - 0.01, "yours pills");

  // "Stop / renting / your software." one beat each, out on beat 6 as the wall snaps
  const ws = $$("#hook-t .w");
  [T.stop, T.renting, T.your].forEach((at, i) => {
    tl.fromTo(ws[i], { yPercent: 110 }, { yPercent: 0, duration: IN, ease: "expo.out" }, at);
    tl.fromTo(ws[i], { yPercent: 0 }, { yPercent: -110, duration: 0.18, ease: "power3.in" }, T.wall);
  });
  cut(T.stop, "Stop");
  on(T.renting, "renting");
  on(T.your, "your software.");
  read("#hook-t", T.your + IN, T.wall, "hook");

  const whA = $("#wh-a"), whB = $("#wh-b"), strike = $("#wh-x");
  tl.fromTo(whA, { yPercent: 110 }, { yPercent: 0, duration: IN, ease: "expo.out" }, T.wall);
  tl.fromTo(whA, { yPercent: 0 }, { yPercent: -110, duration: 0.14, ease: "power3.in" }, T.flip);
  tl.fromTo(whB, { yPercent: 110 }, { yPercent: 0, duration: IN, ease: "expo.out" }, T.flip);
  tl.fromTo(strike, { scaleX: 0 }, { scaleX: 1, duration: 0.2, ease: "expo.out" }, T.strike);
  on(T.wall, "the wall, Their servers.");
  on(T.strike, "struck out");
  on(T.flip, "flip to Your servers.");
  read(whA, T.wall + IN, T.flip - 0.01);
  read(whB, T.flip + IN, B - 0.01);

  const mN = $("#m-n"), l1 = $("#m-l1"), l2 = $("#m-l2");
  tl.fromTo("#meter", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: IN, ease: "expo.out" }, T.lock1);
  tl.fromTo(l1, { yPercent: 0 }, { yPercent: -120, duration: 0.14, ease: "power3.in" }, T.flip);
  tl.fromTo(l2, { yPercent: 160 }, { yPercent: 0, duration: IN, ease: "expo.out" }, T.flip);
  const lockedAt = (n) => (n.i < 4 ? T.lock1 : T.lock2) + (n.i % 4) * 0.02;
  proc((t) => {
    let sum = 0;
    nodes.forEach((n) => { if (t >= lockedAt(n)) sum += n.tile.price; });
    const down = gsap.parseEase("power3.out")(prog(t, T.flip, T.flip + 0.3));
    mN.textContent = `$${Math.round(sum * (1 - down))}`;
    mN.style.color = t >= T.flip + 0.3 ? "#00d787" : "#ff5f5f";
  });
  read(mN, lockedAt(nodes[7]) + 0.02, T.flip - 0.01, "$92");
  read(mN, T.flip + 0.31, B - 0.01, "$0");
  read(l1, T.lock1 + IN, T.flip - 0.01);
  read(l2, T.flip + IN, B - 0.01);
  return nodes;
}
