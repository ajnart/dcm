import { gsap, $, $$, proc, prog, scene, icon, read, cue, on, cut, drift, rng, ICON } from "./lib.js";
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
// beats: 0 "Stop renting" · 1 "your software." · 2 the rented tiles fly in from beyond the frame · 5 the
// headline leaves, the tiles snap into a wall, "Their servers." · 6 row 1 locks · 7 row 2 locks, $92 ·
// 9 the flip wave: "Your servers.", $0 · 10 badges · 11 the wall collapses into the centre, into the drop
const T = { stop: b(0), your: b(1), fly: b(2), wall: b(5), lock1: b(6), lock2: b(7), flip: b(9), badges: b(10), collapse: b(11) };
const WALL = (i) => [960 + ((i % 4) - 1.5) * 322, 560 + (Math.floor(i / 4) - 0.5) * 318];

export function build(tl) {
  scene("hook", A, B);
  drift($("#hook-cam"), A, B, { s0: 1, s1: 1.045 });
  const layer = $("#tiles");
  const r = rng(11);
  const nodes = TILES.map((tile, i) => {
    const el = document.createElement("div");
    el.className = "tile";
    el.innerHTML = `<div class="flip">
      <div class="face front"><img src="${icon(tile.id)}"><div class="nm">${tile.name}</div><div class="price">$${tile.price}/mo</div><div class="lock">${ICON.lock}</div></div>
      <div class="face back"><div class="was"><img src="${icon(tile.id)}"></div><img src="${icon(tile.rep, tile.repExt)}"><div class="nm">${tile.repName}</div><div class="price">yours</div></div>
    </div>`;
    layer.appendChild(el);
    return { tile, i, el, flip: $(".flip", el), lock: $(".lock", el), was: $(".was", el), rx: (r() - 0.5) * 70, ry: (r() - 0.5) * 80, rz: (r() - 0.5) * 30 };
  });

  // one long flight in from beyond the frame, dim behind the headline; then one snap into the wall
  nodes.forEach((n) => {
    const [ex, ey] = n.tile.edge;
    const dx = ex - 960, dy = ey - 540, len = Math.hypot(dx, dy);
    const sx = ex + (dx / len) * 900, sy = ey + (dy / len) * 900;
    const [wx, wy] = WALL(n.i);
    const col = n.i % 4, row = Math.floor(n.i / 4);
    tl.fromTo(n.el, { x: sx, y: sy, scale: 0.9, rotationX: n.rx, rotationY: n.ry, rotation: n.rz, opacity: 0.45 },
      { x: ex, y: ey, scale: 0.6, rotationX: n.rx * 0.25, rotationY: n.ry * 0.25, rotation: n.rz * 0.25, opacity: 0.45, duration: 1.3, ease: "expo.out" }, T.fly + col * 0.03);
    tl.fromTo(n.el, { x: ex, y: ey, scale: 0.6, rotationX: n.rx * 0.25, rotationY: n.ry * 0.25, rotation: n.rz * 0.25, opacity: 0.45 },
      { x: wx, y: wy, scale: 1, rotationX: 0, rotationY: 0, rotation: 0, opacity: 1, duration: 0.5, ease: "expo.inOut" }, T.wall - 0.12 + col * 0.02);
    const lockAt = (row ? T.lock2 : T.lock1) + col * 0.03;
    tl.fromTo(n.lock, { scale: 0, rotation: -90 }, { scale: 1, rotation: 0, duration: 0.3, ease: "expo.out" }, lockAt);
    tl.fromTo(n.lock, { scale: 1 }, { scale: 0, duration: 0.12, ease: "power2.in" }, T.flip - 0.12);
    tl.fromTo(n.flip, { rotationY: 0 }, { rotationY: 180, duration: 0.5, ease: "power3.inOut" }, T.flip);
    tl.fromTo(n.was, { scale: 0 }, { scale: 1, duration: 0.25, ease: "expo.out" }, T.badges + col * 0.03);
    tl.fromTo(n.el, { x: wx, y: wy, scale: 1, opacity: 1 }, { x: 960, y: 540, scale: 0.12, opacity: 1, duration: 0.5, ease: "expo.in" }, T.collapse);
  });
  on(T.fly, "the rented tiles fly in");
  on(T.lock1, "row 1 locks");
  on(T.lock2, "row 2 locks, $92");
  on(T.badges, "was-badges");
  on(T.collapse, "the wall collapses into the centre");
  cue(T.fly + 0.15, "whoosh", { dur: 0.9, soft: true });
  cue(T.wall, "whoosh", { dur: 0.45, pan: 0.4 });
  [0, 1, 2, 3].forEach((c) => { cue(T.lock1 + c * 0.03, "lock", { i: c }); cue(T.lock2 + c * 0.03, "lock", { i: c + 4 }); });
  cue(T.flip, "flip");
  [0, 1, 2, 3].forEach((c) => cue(T.badges + c * 0.03, "pop", { i: c, soft: true }));
  cue(T.collapse + 0.5, "suck", { dur: 0.5 });
  read($$(".front .nm", layer), T.wall + 0.42, T.flip - 0.01, "rented tile names");
  read($$(".front .price", layer), T.wall + 0.42, T.flip - 0.01, "rented prices");
  read($$(".back .nm", layer), T.flip + 0.53, T.collapse - 0.01, "replacement names");
  read($$(".back .price", layer), T.flip + 0.53, T.collapse - 0.01, "yours pills");

  // the headline: two lines, each one gesture; the type tightens as it lands
  const ws = $$("#hook-t .w");
  [T.stop, T.your].forEach((at, i) => {
    tl.fromTo(ws[i], { yPercent: 110, letterSpacing: "0.02em" }, { yPercent: 0, letterSpacing: "-0.055em", duration: 0.3, ease: "expo.out" }, at);
    tl.fromTo(ws[i], { yPercent: 0 }, { yPercent: -110, duration: 0.3, ease: "power3.in" }, T.wall - 0.3);
    cue(at, "slam", { g: 0.8 });
  });
  cut(T.stop, "Stop renting");
  on(T.your, "your software.");
  read("#hook-t", T.your + 0.3, T.wall - 0.3, "hook");

  const whA = $("#wh-a"), whB = $("#wh-b");
  tl.fromTo(whA, { yPercent: 110 }, { yPercent: 0, duration: 0.4, ease: "expo.out" }, T.wall);
  tl.fromTo(whA, { yPercent: 0 }, { yPercent: -110, duration: 0.3, ease: "expo.inOut" }, T.flip);
  tl.fromTo(whB, { yPercent: 110 }, { yPercent: 0, duration: 0.3, ease: "expo.inOut" }, T.flip);
  tl.fromTo(whB, { yPercent: 0 }, { yPercent: -110, duration: 0.3, ease: "power3.in" }, T.collapse);
  on(T.wall, "the wall, Their servers.");
  on(T.flip, "flip to Your servers.");
  read(whA, T.wall + 0.4, T.flip - 0.01);
  read(whB, T.flip + 0.3, T.collapse - 0.01);

  const mN = $("#m-n"), l1 = $("#m-l1"), l2 = $("#m-l2");
  tl.fromTo("#meter", { yPercent: 40, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.4, ease: "expo.out" }, T.lock1);
  tl.fromTo("#meter", { yPercent: 0, opacity: 1 }, { yPercent: -40, opacity: 0, duration: 0.3, ease: "power3.in" }, T.collapse);
  tl.fromTo(l1, { yPercent: 0 }, { yPercent: -120, duration: 0.3, ease: "expo.inOut" }, T.flip);
  tl.fromTo(l2, { yPercent: 160 }, { yPercent: 0, duration: 0.3, ease: "expo.inOut" }, T.flip);
  // the meter counts up as the locks land and runs down to $0 through the flip
  const lockedAt = (n) => (n.i < 4 ? T.lock1 : T.lock2) + (n.i % 4) * 0.03;
  proc((t) => {
    let sum = 0;
    nodes.forEach((n) => { sum += n.tile.price * gsap.parseEase("power3.out")(prog(t, lockedAt(n), lockedAt(n) + 0.25)); });
    const down = gsap.parseEase("power3.inOut")(prog(t, T.flip, T.flip + 0.5));
    mN.textContent = `$${Math.round(sum * (1 - down))}`;
    mN.style.color = t >= T.flip + 0.25 ? "#00d787" : "#ff5f5f";
  });
  read(mN, lockedAt(nodes[7]) + 0.26, T.flip - 0.01, "$92");
  read(mN, T.flip + 0.51, T.collapse - 0.01, "$0");
  read(l1, T.lock1 + 0.4, T.flip - 0.01);
  read(l2, T.flip + 0.3, T.collapse - 0.01);
  return nodes;
}
