import { $, $$, proc, clamp, scene, icon, chars, diamond, read, cue, on, cut } from "./lib.js";
import { SC, b } from "./timeline.js";

export const PROJ_ICONS = ["qbittorrent", "sonarr", "radarr", "prowlarr", "jellyfin", "seerr", "homarr"];
const CMD = [["self-host", ""], [" install", "acc"], [" media", "app"], [" homarr", "app"]];
export const CMD_TEXT = "self-host install media homarr";
export const WIN = { x: 220, y: 270, w: 1480, h: 720 };
const [A, B] = SC.product;
// beats: 0 the drop, violet flood, wordmark · 1 the flood collapses into the mark · 2 dock, "One command."
// 3 the command types · 4 enter, "A whole stack.", the Compose Project · 5 four Apps · 6 three Apps · 7 the box becomes the TUI
const T = { drop: b(12), mark: b(13), dock: b(14), type: [b(15), b(15) + 0.36], enter: b(16), apps1: b(17), apps2: b(18), morph: b(19) };
const IN = 0.2;

export function build(tl) {
  const root = scene("product", A, B);
  const wm = $("#wm"), lockup = $("#lockup"), mark = $("#mark");
  wm.textContent = "self-host";
  root.style.display = "block";
  const lw = lockup.offsetWidth, lh = lockup.offsetHeight, mw = mark.offsetWidth;
  const mx = mark.offsetLeft + mw / 2, my = mark.offsetTop + mark.offsetHeight / 2;
  root.style.display = "none";
  const letters = chars(wm);
  const x0 = 960 - lw / 2, y0 = 540 - lh / 2;
  const sc = 0.3, x1 = 112, y1 = 100;

  const dia = $("#dia");
  tl.fromTo(dia, { clipPath: diamond(960, 540, 0) }, { clipPath: diamond(960, 540, 1560), duration: 0.3, ease: "expo.out" }, T.drop);
  tl.fromTo(dia, { clipPath: diamond(960, 540, 1560) }, { clipPath: diamond(x0 + mx, y0 + my, mw / 2), duration: 0.3, ease: "expo.inOut" }, T.mark);
  proc((t) => {
    const docked = t >= T.mark + 0.3;
    dia.style.visibility = docked ? "hidden" : "visible";
    mark.style.opacity = docked ? 1 : 0;
  });
  cut(T.drop, "the drop: violet flood, wordmark");
  on(T.mark, "the flood collapses into the mark");

  letters.forEach((c, i) => tl.fromTo(c, { yPercent: 115 }, { yPercent: 0, duration: IN, ease: "expo.out" }, T.drop + i * 0.02));
  tl.fromTo(lockup, { x: x0, y: y0, scale: 1 }, { x: x1, y: y1, scale: sc, duration: 0.34, ease: "expo.inOut" }, T.dock);
  read(wm, T.drop + letters.length * 0.02 + IN, T.dock - 0.01, "wordmark");
  read(wm, T.dock + 0.35, T.morph - 0.01, "docked wordmark");

  tl.fromTo("#cap-a", { yPercent: 110 }, { yPercent: 0, duration: IN, ease: "expo.out" }, T.dock);
  tl.fromTo("#cap-b", { yPercent: 110 }, { yPercent: 0, duration: IN, ease: "expo.out" }, T.enter);
  tl.fromTo("#cap", { opacity: 1 }, { opacity: 0, duration: 0.12 }, T.morph);
  on(T.dock, "dock, One command.");
  read("#cap-a", T.dock + IN, T.morph - 0.01);
  read("#cap-b", T.enter + IN, T.morph - 0.01);

  const cmdT = $("#cmd-t"), caret = $("#cmd-c");
  proc((t) => {
    const n = Math.round(CMD_TEXT.length * clamp((t - T.type[0]) / (T.type[1] - T.type[0])));
    let left = n, html = "";
    for (const [txt, cls] of CMD) {
      if (left <= 0) break;
      const part = txt.slice(0, left);
      left -= part.length;
      html += `<span class="${cls}">${part.replace(/ /g, "&nbsp;")}</span>`;
    }
    cmdT.innerHTML = html;
    caret.style.visibility = t >= T.type[0] && t < T.enter ? "visible" : "hidden";
  });
  tl.fromTo("#cmd", { opacity: 0 }, { opacity: 1, duration: 0.01 }, T.type[0]);
  tl.fromTo("#cmd", { opacity: 1 }, { opacity: 0, duration: 0.12 }, T.morph);
  on(T.type[0], "the command types");
  on(T.enter, "enter, A whole stack., the Compose Project");
  cue(T.enter, "enter");
  read("#cmd", T.type[1] + 0.02, T.morph - 0.01, "command");

  // the Compose Project draws on beat 4; on beat 7 it opens into the TUI window of the next scene
  const box = $("#proj-box");
  tl.fromTo(box, { clipPath: "inset(0 100% 0 0 round 34px)" }, { clipPath: "inset(0 0% 0 0 round 34px)", duration: 0.3, ease: "expo.out" }, T.enter);
  tl.fromTo(box, { left: 0, top: 0, width: 1696, height: 262, borderRadius: 34, borderColor: "rgba(168,141,242,0.55)", backgroundColor: "rgba(122,87,211,0.07)" },
    { left: WIN.x - 112, top: WIN.y - 718, width: WIN.w, height: WIN.h, borderRadius: 22, borderColor: "rgba(255,255,255,0.12)", backgroundColor: "#0d0b14", duration: 0.5, ease: "expo.inOut" }, T.morph);
  tl.fromTo("#p-label", { yPercent: 110, opacity: 0 }, { yPercent: 0, opacity: 1, duration: IN, ease: "expo.out" }, T.enter);
  tl.fromTo("#p-label", { opacity: 1 }, { opacity: 0, duration: 0.1 }, T.morph);
  read("#p-label", T.enter + IN, T.morph - 0.01);

  PROJ_ICONS.forEach((id, i) => {
    const el = document.createElement("div");
    el.className = "pi";
    el.style.cssText = `left:${145 + i * 234.33 - 75 - 112}px;top:${865 - 75 - 718}px`;
    el.innerHTML = `<img src="${icon(id)}">`;
    $("#proj").appendChild(el);
    const at = i < 4 ? T.apps1 + i * 0.04 : T.apps2 + (i - 4) * 0.04;
    tl.fromTo(el, { y: 26, opacity: 0 }, { y: 0, opacity: 1, duration: IN, ease: "expo.out" }, at);
    tl.fromTo(el, { opacity: 1 }, { opacity: 0, duration: 0.1 }, T.morph);
  });
  on(T.apps1, "four Apps land");
  on(T.apps2, "three Apps land");
  on(T.morph, "the box opens into the TUI");
}
