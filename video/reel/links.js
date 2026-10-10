import { $, proc, scene, icon, read, cue, on, cut, ICON } from "./lib.js";
import { SC, b } from "./timeline.js";

const [A, B] = SC.links;
// What each Link really does, from new-cli/internal/apps:
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
// beats: card k lands on beat k; its wire draws on beat k+1 and the credential travels to the App being
// configured; it ticks green on beat k+3. Beat 7: the counter completes.
const land = (k) => b(24 + k);
const wireEnd = (c) => 824 - 40 - c.to.length * 104 - (c.to.length - 1) * 12 - 22;
const IN = 0.2;

export function build(tl) {
  scene("links", A, B);
  cut(A, "Links");
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

  const count = $("#lk-count");
  CARDS.forEach((c, k) => {
    const el = $(`#lkc${k}`), t0 = land(k), wire = t0 + b(1), tick = t0 + b(3);
    tl.fromTo(el, { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: IN, ease: "expo.out" }, t0);
    on(t0, `card ${c.fromName} lands`);
    const w1 = $(".w1", el), pk = $(".pk", el), ok = $(".ok", el);
    tl.fromTo(w1, { attr: { "stroke-dashoffset": 100 } }, { attr: { "stroke-dashoffset": 0 }, duration: 0.25, ease: "expo.out" }, wire);
    on(wire, `wire ${c.fromName}`);
    // the credential travels from the App that owns it to the App being configured
    const px = wireEnd(c) - 22;
    tl.fromTo(pk, { x: px, opacity: 0 }, { x: px, opacity: 1, duration: 0.08 }, wire + 0.25);
    tl.fromTo(pk, { x: px }, { x: 150, duration: 0.5, ease: "power3.inOut" }, wire + 0.3);
    tl.fromTo(pk, { opacity: 1 }, { opacity: 0, duration: 0.08 }, tick - 0.1);
    tl.fromTo(ok, { scale: 0 }, { scale: 1, duration: 0.15, ease: "expo.out" }, tick);
    on(tick, `${c.fromName} linked`);
    cue(tick, "check", { pan: k % 2 ? 0.3 : -0.3 });
    proc((t) => {
      const done = t >= tick;
      w1.setAttribute("stroke", done ? "#00d787" : "#a88df2");
      el.classList.toggle("on", done);
    });
    read([$(".nm.l", el), $(".nm.r", el), $(".desc", el), $(".key", el)], t0 + IN, B - 0.01, `link ${c.fromName}`);
  });
  proc((t) => {
    const n = CARDS.filter((_, k) => t >= land(k) + b(3)).length;
    count.innerHTML = t >= b(31) ? `${ICON.check}<span>4 of 4 linked</span>` : `<span>${n} of 4 linked</span>`;
    count.classList.toggle("done", t >= b(31));
  });
  on(b(31), "all four linked");

  const w = $("#cap-links .w");
  tl.fromTo(w, { yPercent: 110 }, { yPercent: 0, duration: IN, ease: "expo.out" }, A);
  read("#cap-links", A + IN, B - 0.01);
}
