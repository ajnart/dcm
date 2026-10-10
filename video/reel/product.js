import { gsap, $, proc, clamp, scene, icon, chars, diamond, read, cue, typeCues } from "./lib.js";
import { SC } from "./timeline.js";

export const PROJ_ICONS = ["qbittorrent", "sonarr", "radarr", "prowlarr", "jellyfin", "seerr", "homarr"];
export const ROW = PROJ_ICONS.map((_, i) => [257 + i * 234.33, 865]);

const CMD = [["self-host", ""], [" install", "acc"], [" media", "app"], [" homarr", "app"]];
export const CMD_TEXT = "self-host install media homarr";
const [A, B] = SC.product;
const T = { burst: A + 0.15, letters: A + 0.2, impact: A + 0.55, dock: A + 2.0, capA: A + 2.2, capB: A + 2.75, typeA: A + 2.4, typeB: A + 3.15, enter: A + 3.2, proj: A + 2.7, hold: A + 5.3 };

export function build(tl) {
  const root = scene("product", A, B);
  const wm = $("#wm");
  const wmt = document.createElement("span");
  wmt.className = "wmt";
  wmt.textContent = "self-host";
  wm.textContent = "";
  wm.appendChild(wmt);
  root.style.display = "block";
  const wmW = wmt.offsetWidth;
  root.style.display = "none";
  const letters = chars(wmt);
  const sc = 56 / 230;
  const finalX = 236 + (wmW * sc) / 2 - 960;
  const finalY = 124 - 540;

  const dia = $("#dia");
  tl.fromTo(dia, { clipPath: diamond(960, 560, 0) }, { clipPath: diamond(960, 560, 96), duration: 0.15, ease: "power2.out" }, A);
  tl.fromTo(dia, { clipPath: diamond(960, 560, 96) }, { clipPath: diamond(960, 560, 1800), duration: 0.5, ease: "expo.out" }, T.burst);
  tl.fromTo(dia, { clipPath: diamond(960, 560, 1800) }, { clipPath: diamond(144, 124, 32), duration: 0.5, ease: "power4.inOut" }, T.dock);
  cue(A, "boom");

  letters.forEach((c, i) => {
    tl.fromTo(c, { y: -220, scale: 1.6, opacity: 0, rotation: i % 2 ? 14 : -14 }, { y: 0, scale: 1, opacity: 1, rotation: 0, duration: 0.5, ease: "back.out(1.6)" }, T.letters + i * 0.035);
  });
  cue(T.impact, "impact", { size: 0.7 });
  tl.fromTo(wm, { x: 0, y: 0, scale: 1 }, { x: finalX, y: finalY, scale: sc, duration: 0.5, ease: "power4.inOut" }, T.dock);
  cue(T.dock, "whoosh", { dur: 0.5, pan: -0.6 });
  proc((t) => {
    $("#mark").style.opacity = t >= T.dock + 0.48 ? 1 : 0;
    dia.style.visibility = t >= T.dock + 0.5 ? "hidden" : "visible";
  });
  read(wm, A + 1.05, T.dock, "wordmark");
  read(wm, T.dock + 0.55, T.hold, "corner wordmark");

  tl.fromTo("#cap-a", { yPercent: 190, rotation: 4 }, { yPercent: 0, rotation: 0, duration: 0.65, ease: "expo.out" }, T.capA);
  tl.fromTo("#cap-b", { yPercent: 190, rotation: 4 }, { yPercent: 0, rotation: 0, duration: 0.65, ease: "expo.out" }, T.capB);
  read("#cap-a", T.capA + 0.7, T.hold);
  read("#cap-b", T.capB + 0.7, T.hold);
  cue(T.capA + 0.04, "thump", { i: 0 });
  cue(T.capB + 0.04, "thump", { i: 1 });

  const cmdT = $("#cmd-t"), caret = $("#cmd-c");
  proc((t) => {
    const n = Math.round(CMD_TEXT.length * clamp((t - T.typeA) / (T.typeB - T.typeA)));
    let left = n, html = "";
    for (const [txt, cls] of CMD) {
      if (left <= 0) break;
      const part = txt.slice(0, left);
      left -= part.length;
      html += `<span class="${cls}">${part.replace(/ /g, "&nbsp;")}</span>`;
    }
    cmdT.innerHTML = html;
    const typing = t >= T.typeA && t < T.typeB;
    const blink = Math.floor(t * 2.4) % 2 === 0;
    caret.style.visibility = t >= T.enter ? "hidden" : typing || blink ? "visible" : "hidden";
  });
  typeCues(CMD_TEXT, T.typeA, T.typeB);
  cue(T.enter, "enter");
  tl.fromTo("#cmd", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.25, ease: "power2.out" }, T.typeA - 0.1);
  tl.fromTo("#cmd", { scale: 1 }, { scale: 1.035, duration: 0.07, ease: "power2.out", yoyo: true, repeat: 1, transformOrigin: "0% 50%" }, T.enter);
  read("#cmd", T.enter + 0.2, T.hold, "command");

  const proj = $("#proj");
  tl.fromTo(proj, { opacity: 0, y: 70, scale: 0.97 }, { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: "expo.out" }, T.proj);
  proj.insertAdjacentHTML("afterbegin", `<svg width="1696" height="262" viewBox="0 0 1696 262" style="position:absolute;left:0;top:0"><rect id="proj-r" x="1.5" y="1.5" width="1693" height="259" rx="34" fill="none" stroke="#a88df2" stroke-opacity=".65" stroke-width="2.5" stroke-dasharray="16 12"/></svg>`);
  const pr = $("#proj-r");
  proc((t) => pr.setAttribute("stroke-dashoffset", String(-t * 34)));
  read("#p-label", T.proj + 0.65, T.hold);

  PROJ_ICONS.forEach((id, i) => {
    const el = document.createElement("div");
    el.className = "pi";
    el.style.cssText = "left:0;top:0;margin:-75px 0 0 -75px;";
    el.innerHTML = `<img src="${icon(id)}">`;
    root.appendChild(el);
    const [sx, sy] = ROW[i];
    const at = T.enter + 0.05 + i * 0.05;
    tl.fromTo(el, { x: 1300, y: 650, scale: 0.1, rotation: -220, opacity: 0 }, { x: sx, y: sy, scale: 1, rotation: 0, opacity: 1, duration: 0.7, ease: "back.out(1.25)" }, at);
    cue(at + 0.3, "pop", { i });
  });
}
