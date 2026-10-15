import { $, $$, proc, scene, icon, read, cue, on, cut, drift, ICON } from "./lib.js";
import { SC, b } from "./timeline.js";

const [A, B] = SC.links;
// What each Link really does, from internal/apps:
//   arr/links.go    downloadClientLink: Sonarr/Radarr get qBittorrent as download client with the Admin login
//   arr/links.go    applicationLink: Prowlarr syncs indexers to Sonarr/Radarr with their API keys
//   seerr/seerr.go  serverLink: Seerr sends requests to Sonarr/Radarr with their API keys
//   homarr/links.go target.link: Homarr adds a Jellyfin app tile, integration (API key) and widgets
const CARDS = [
  { from: "sonarr", fromName: "Sonarr", to: ["qbittorrent"], toName: "qBittorrent", desc: "Adds qBittorrent as Sonarr’s download client", key: "Admin login" },
  { from: "prowlarr", fromName: "Prowlarr", to: ["sonarr", "radarr"], toName: "Sonarr · Radarr", desc: "Syncs Prowlarr’s indexers to Sonarr and Radarr", key: "Their API keys" },
  { from: "seerr", fromName: "Seerr", to: ["sonarr", "radarr"], toName: "Sonarr · Radarr", desc: "Sends your requests to Sonarr and Radarr", key: "Their API keys" },
  { from: "homarr", fromName: "Homarr", to: ["jellyfin"], toName: "Jellyfin", desc: "Adds Jellyfin’s tile and widgets to Homarr", key: "Jellyfin API key" },
];
// beats: 0 the cards open out of the push as one grid · 2 the four wires draw a sixteenth apart and each
// credential travels to the App being configured · 4 they tick green a sixteenth apart · 5 4 of 4 linked ·
// the last beat whips up into the board
const T = { open: A, wire: A + b(2), tick: A + b(4), all: A + b(5), whip: B - 0.16 };
const S16 = b(0.25);
const wireEnd = (c) => 824 - 40 - c.to.length * 104 - (c.to.length - 1) * 12 - 22;

export function build(tl) {
  const root = scene("links", A, B);
  cut(A, "Links");
  drift($("#links-cam"), A, B, { s0: 1, s1: 1.03 });
  const grid = $("#lk-grid");
  grid.innerHTML = CARDS.map((c, k) => `
    <div class="lkc" id="lkc${k}">
      <svg class="wire" width="824" height="200" viewBox="0 0 824 200"><line class="w0" x1="166" y1="88" x2="${wireEnd(c)}" y2="88"/><line class="w1" x1="166" y1="88" x2="${wireEnd(c)}" y2="88" pathLength="100" stroke-dasharray="100 100" stroke-dashoffset="100"/></svg>
      <div class="ic l"><div class="sq"><img src="${icon(c.from)}"></div><div class="ok">${ICON.check}</div></div>
      <div class="ic r${c.to.length > 1 ? " two" : ""}">${c.to.map((id) => `<div class="sq"><img src="${icon(id)}"></div>`).join("")}</div>
      <div class="nm l">${c.fromName}</div><div class="nm r">${c.toName}</div>
      <div class="pk" data-deco>${ICON.key}</div>
      <div class="desc">${c.desc}</div>
      <div class="key"><b>${ICON.key}</b><span class="kl">${c.key}</span> <span class="mask">••••••</span></div>
    </div>`).join("");

  // the grid opens out of the setup scene's push: one scale-down, the cards resolving together
  grid.style.transformOrigin = "50% 40%";
  tl.fromTo(grid, { scale: 1.22 }, { scale: 1, duration: 0.6, ease: "expo.out" }, T.open);
  $$(".lkc", grid).forEach((el, k) => tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: "power2.out" }, T.open + k * 0.03));
  on(T.open, "the four cards open out of the push");

  const count = $("#lk-count");
  CARDS.forEach((c, k) => {
    const el = $(`#lkc${k}`), wire = T.wire + k * S16, tick = T.tick + k * S16;
    const w1 = $(".w1", el), pk = $(".pk", el), ok = $(".ok", el);
    tl.fromTo(w1, { attr: { "stroke-dashoffset": 100 } }, { attr: { "stroke-dashoffset": 0 }, duration: 0.3, ease: "expo.out" }, wire);
    cue(wire, "zip", { pan: k % 2 ? 0.4 : -0.4 });
    // the credential travels from the App that owns it to the App being configured
    const px = wireEnd(c) - 22;
    tl.fromTo(pk, { x: px, opacity: 0, scale: 0.4 }, { x: px, opacity: 1, scale: 1, duration: 0.15, ease: "expo.out" }, wire + 0.2);
    tl.fromTo(pk, { x: px }, { x: 150, duration: 0.5, ease: "power3.inOut" }, wire + 0.3);
    tl.fromTo(pk, { opacity: 1 }, { opacity: 0, duration: 0.08 }, tick - 0.08);
    tl.fromTo(ok, { scale: 0, rotation: -90 }, { scale: 1, rotation: 0, duration: 0.3, ease: "expo.out" }, tick);
    cue(tick, "check", { i: k + 2 });
    proc((t) => {
      const done = t >= tick;
      w1.setAttribute("stroke", done ? "#00d787" : "#a88df2");
      el.classList.toggle("on", done);
    });
    read([$(".nm.l", el), $(".nm.r", el), $(".desc", el), $(".key", el)], T.open + 0.6, T.whip - 0.01, `link ${c.fromName}`);
  });
  on(T.wire, "the wires draw");
  on(T.tick, "the Links tick green");
  proc((t) => {
    const n = CARDS.filter((_, k) => t >= T.tick + k * S16).length;
    count.innerHTML = t >= T.all ? `${ICON.check}<span>4 of 4 linked</span>` : `<span>${n} of 4 linked</span>`;
    count.classList.toggle("done", t >= T.all);
  });
  on(T.all, "all four linked");
  cue(T.all, "success");

  const w = $("#cap-links .w");
  tl.fromTo(w, { yPercent: 110 }, { yPercent: 0, duration: 0.4, ease: "expo.out" }, A);
  read("#cap-links", A + 0.4, T.whip - 0.01);

  // a vertical whip into the board: this scene leaves upward, the board arrives from below
  tl.fromTo(root, { y: 0 }, { y: -420, duration: 0.16, ease: "power2.in" }, T.whip);
  cue(B, "whoosh", { dur: 0.4, pan: -0.3 });
}
