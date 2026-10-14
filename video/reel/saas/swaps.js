import { gsap, $, $$, proc, prog, lerp, scene, icon, read, cue, on, cut, drift, diamond, ICON } from "../lib.js";
import { SC, SWAP_AT } from "./timeline.js";
import { SWAPS, address, wasFace } from "./data.js";

const [A, B] = SC.swaps;
const END = B - 0.01;
const SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const spin = (t) => SPIN[Math.floor(t * 14) % 10];
const ROW = 66;
const SHIFT = 0.2; // the first swap waits for the diamond to open
const RING = 110; // the violet edge of the opening diamond
const GLYPH = { ok: ["●", "#00d787"], attention: ["◐", "#ffaf00"] };
const COLOR = { ok: "#00d787", attention: "#ffaf00" };
// Per swap (S = its start): 0 the rented tile lands, "Replaces ..." · 0.85 it flips to the App · 1 the name and what Setup did ·
// 1.5 (beat 3) the App's row in the Dashboard comes up: Address and Status
const U = { in: 0, hold: 0.38, flip: 0.85, back: 1.33, name: 1.0, pills: 1.1, up: 1.5 };
const start = (k) => SWAP_AT[k] + (k ? 0 : SHIFT);
const stop = (k) => (k + 1 < SWAPS.length ? SWAP_AT[k + 1] : B);
const upAt = (k) => start(k) + U.up;
const rowIn = (i) => A + 0.3 + i * 0.05;

export function build(tl) {
  scene("sw", A, B);
  cut(A, "the drop: the Dashboard");
  drift($("#sw-cam"), A, B, { s0: 1, s1: 1.03 });
  // the drop: a diamond opens from the centre with a violet edge, the Dashboard inside it
  tl.fromTo("#sw-clip", { clipPath: diamond(960, 540, 40) }, { clipPath: diamond(960, 540, 1560), duration: 0.45, ease: "expo.out" }, A);
  tl.fromTo("#sw-wipe", { clipPath: diamond(960, 540, 40 + RING) }, { clipPath: diamond(960, 540, 1560 + RING), duration: 0.45, ease: "expo.out" }, A);
  cue(A, "impact", { size: 0.9 });
  cue(A + 0.05, "whoosh", { dur: 0.4, soft: true });

  // the Dashboard: Overview, the Apps pane; every App spins until its swap brings it up
  const dash = $("#dash");
  dash.innerHTML = `
    <div class="tb" data-deco><i></i><i></i><i></i><span>self-host</span></div>
    <div class="hd" data-deco><div class="hl"><b class="d">◆</b> <b>homelab</b><span class="dim">  ~/.self-host</span></div><div class="hr"><span class="dim">LAN </span>192.168.1.20<span class="dim">  ·  </span>14:32</div></div>
    <div class="tabs" data-deco><span class="on"><i>1</i> Overview</span><span><i>2</i> Apps</span><span><i>3</i> Activity</span><span><i>4</i> Catalog</span><span><i>5</i> Settings</span></div>
    <div class="dbox"><div class="bt" data-deco><span>Apps</span><em>${SWAPS.length}</em></div>
      <div class="dsel" id="dsel"></div>
      <div class="drows">${SWAPS.map((s) => `<div class="dr"><span class="dm"></span><img class="di" src="${icon(s.id)}"><span class="dn">${s.name}</span><span class="dc">${s.category}</span><span class="da">${address(s)}</span><span class="ds" style="color:${COLOR[s.level]}">${s.level === "ok" ? "ok" : "attention"}</span></div>`).join("")}</div>
    </div>`;
  const rows = $$(".dr", dash);
  rows.forEach((row, i) => {
    tl.fromTo(row, { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: "expo.out" }, rowIn(i));
    const up = upAt(i);
    tl.fromTo([$(".da", row), $(".ds", row)], { x: -14, opacity: 0 }, { x: 0, opacity: 1, duration: 0.25, ease: "expo.out" }, up);
    read([$(".dn", row), $(".dc", row)], rowIn(i) + 0.36, END, `App ${SWAPS[i].name}`);
    read([$(".da", row), $(".ds", row)], up + 0.26, END, `Address and Status ${SWAPS[i].name}`);
    on(up, `${SWAPS[i].name} is ${SWAPS[i].level}`);
    cue(up, "check", { i });
    cue(up + 0.03, "tick", { soft: true, pan: i % 2 ? 0.4 : -0.4 });
  });
  cue(rowIn(0) + 0.1, "pop", { i: 3, soft: true });
  const dm = rows.map((r) => $(".dm", r));
  const sel = $("#dsel");
  const ease = gsap.parseEase("expo.out");
  proc((t) => {
    rows.forEach((_, i) => {
      const up = upAt(i);
      if (t >= up) {
        const [g, c] = GLYPH[SWAPS[i].level];
        dm[i].textContent = g;
        dm[i].style.color = c;
        dm[i].style.transform = `scale(${(1 + 0.7 * Math.max(0, 1 - (t - up) / 0.35)).toFixed(3)})`;
      } else {
        dm[i].textContent = spin(t);
        dm[i].style.color = "#a88df2";
        dm[i].style.transform = "";
      }
    });
    let y = 0;
    for (let k = 1; k < SWAPS.length; k++) y += ROW * ease(prog(t, upAt(k) - 0.2, upAt(k)));
    sel.style.transform = `translateY(${y.toFixed(2)}px)`;
    sel.style.opacity = prog(t, upAt(0) - 0.2, upAt(0)).toFixed(3);
  });

  const blocks = $("#sw-blocks");
  SWAPS.forEach((s, k) => {
    const S = start(k), E = stop(k), last = k === SWAPS.length - 1;
    const el = document.createElement("div");
    el.className = "sb";
    el.innerHTML = `
      <div class="tile"><div class="flip">
        <div class="face front">${wasFace(s)}<div class="nm">${s.tile}</div><div class="price">rented</div><div class="lock">${ICON.lock}</div></div>
        <div class="face back"><div class="was">${wasFace(s)}</div><img src="${icon(s.id)}"><div class="nm">${s.name}</div><div class="price">yours</div></div>
      </div></div>
      <div class="sb-txt">
        <div class="sb-was"><span class="mk"><span class="w">Replaces <b>${s.was}</b></span></span></div>
        <div class="sb-name"><span class="mk"><span class="w">${s.name}</span></span></div>
        <div class="sb-pills">${s.pills.map(([kind, text]) => `<span class="pill ${kind}"><i>${kind === "ok" ? "✓" : "!"}</i> <span>${text}</span></span>`).join("")}</div>
      </div>`;
    blocks.appendChild(el);
    proc((t) => { el.style.display = t >= SWAP_AT[k] && t < E ? "block" : "none"; });

    const tile = $(".tile", el), flip = $(".flip", el), lock = $(".lock", el), was = $(".was", el);
    const gone = E - 0.2;
    tl.fromTo(tile, { x: 240, y: 250, scale: 0.55, opacity: 0 }, { x: 240, y: 250, scale: 1, opacity: 1, duration: 0.35, ease: "expo.out" }, S + U.in);
    tl.fromTo(lock, { scale: 0, rotation: -90 }, { scale: 1, rotation: 0, duration: 0.3, ease: "expo.out" }, S + 0.12);
    tl.fromTo(lock, { scale: 1 }, { scale: 0, duration: 0.12, ease: "power2.in" }, S + U.flip - 0.12);
    tl.fromTo(flip, { rotationY: 0 }, { rotationY: 180, duration: 0.45, ease: "power3.inOut" }, S + U.flip);
    tl.fromTo(was, { scale: 0 }, { scale: 1, duration: 0.25, ease: "expo.out" }, S + U.pills);
    cue(S + U.in, "whoosh", { dur: 0.3, soft: true, pan: -0.3 });
    cue(S + 0.12, "lock", { i: k });
    cue(S + U.flip, "flip");
    cue(S + U.pills, "pop", { i: k, soft: true });
    if (k) cut(S, `swap ${k + 1}: ${s.name}`);
    else on(S, `swap 1: ${s.name}`);
    on(S + U.flip, `flip to ${s.name}`);

    const was$ = $(".sb-was .w", el), name$ = $(".sb-name .w", el);
    tl.fromTo(was$, { yPercent: 110 }, { yPercent: 0, duration: 0.35, ease: "expo.out" }, S + 0.05);
    tl.fromTo(name$, { yPercent: 110, letterSpacing: "0.01em" }, { yPercent: 0, letterSpacing: "-0.055em", duration: 0.35, ease: "expo.out" }, S + U.name);
    cue(S + U.name, "slam", { g: 0.5 });
    $$(".pill", el).forEach((p, i) => tl.fromTo(p, { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: "expo.out" }, S + U.pills + i * 0.08));
    if (!last) tl.fromTo(el, { x: 0, opacity: 1 }, { x: -70, opacity: 0, duration: 0.2, ease: "power3.in" }, gone);

    const hold = last ? END : gone - 0.01;
    read($(".sb-was", el), S + 0.42, hold, `replaces ${s.was}`);
    read([$(".front .nm", el), $(".front .price", el)], S + U.hold, S + U.flip - 0.01, `rented ${s.tile}`);
    read([$(".back .nm", el), $(".back .price", el)], S + U.back, hold, `yours ${s.name}`);
    read($(".sb-name", el), S + U.name + 0.36, hold, s.name);
    read($$(".pill span", el), S + U.pills + 0.08 * (s.pills.length - 1) + 0.31, hold, `Setup ${s.name}`);
  });
}
