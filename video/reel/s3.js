import { gsap, $, $$, proc, prog, clamp, scene, icon, chars, diamond } from "./lib.js";

export const PROJ_ICONS = ["qbittorrent", "sonarr", "radarr", "prowlarr", "jellyfin", "seerr", "homarr"];
export const ROW = PROJ_ICONS.map((_, i) => [257 + i * 234.33, 865]);
const LIGHT = new Set([]);

const CMD = [["self-host", "bright"], [" install", "dim"], [" media", "app"], [" homarr", "app"]];
export const CMD_TEXT = "self-host install media homarr";

export function build(tl) {
  const root = scene("s3", 4.1, 7.55);
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
  tl.fromTo(dia, { clipPath: diamond(960, 560, 0) }, { clipPath: diamond(960, 560, 96), duration: 0.2, ease: "power2.out" }, 4.1);
  tl.fromTo(dia, { clipPath: diamond(960, 560, 96) }, { clipPath: diamond(960, 560, 1800), duration: 0.55, ease: "expo.out" }, 4.3);
  tl.fromTo(dia, { clipPath: diamond(960, 560, 1800) }, { clipPath: diamond(144, 124, 32), duration: 0.5, ease: "power4.inOut" }, 5.0);
  tl.fromTo("#flash", { opacity: 0 }, { opacity: 0.85, duration: 0.05, ease: "none" }, 4.3);
  tl.fromTo("#flash", { opacity: 0.85 }, { opacity: 0, duration: 0.32, ease: "power2.out" }, 4.35);

  letters.forEach((c, i) => {
    tl.fromTo(c, { y: -220, scale: 1.6, opacity: 0, rotation: i % 2 ? 14 : -14 }, { y: 0, scale: 1, opacity: 1, rotation: 0, duration: 0.5, ease: "back.out(1.6)" }, 4.44 + i * 0.035);
  });
  tl.fromTo(wm, { x: 0, y: 0, scale: 1 }, { x: finalX, y: finalY, scale: sc, duration: 0.5, ease: "power4.inOut" }, 5.0);
  proc((t) => {
    $("#mark").style.opacity = t >= 5.48 ? 1 : 0;
    dia.style.visibility = t >= 5.5 ? "hidden" : "visible";
  });

  tl.fromTo("#cap-a", { yPercent: 190, rotation: 4 }, { yPercent: 0, rotation: 0, duration: 0.65, ease: "expo.out" }, 5.14);
  tl.fromTo("#cap-b", { yPercent: 190, rotation: 4 }, { yPercent: 0, rotation: 0, duration: 0.65, ease: "expo.out" }, 5.74);

  const cmdT = $("#cmd-t"), caret = $("#cmd-c");
  const typeA = 5.36, typeB = 6.02, enter = 6.14;
  proc((t) => {
    const n = Math.round(CMD_TEXT.length * clamp((t - typeA) / (typeB - typeA)));
    let left = n, html = "";
    for (const [txt, cls] of CMD) {
      if (left <= 0) break;
      const part = txt.slice(0, left);
      left -= part.length;
      html += `<span class="${cls === "dim" ? "" : cls === "app" ? "app" : ""}"${cls === "dim" ? ' style="color:#a88df2"' : ""}>${part.replace(/ /g, "&nbsp;")}</span>`;
    }
    cmdT.innerHTML = html;
    const typing = t >= typeA && t < typeB;
    const blink = Math.floor(t * 2.4) % 2 === 0;
    caret.style.visibility = t >= enter ? "hidden" : typing || blink ? "visible" : "hidden";
  });
  tl.fromTo("#cmd", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.25, ease: "power2.out" }, typeA - 0.05);
  tl.fromTo("#cmd", { scale: 1 }, { scale: 1.035, duration: 0.07, ease: "power2.out", yoyo: true, repeat: 1, transformOrigin: "0% 50%" }, enter);

  const proj = $("#proj");
  tl.fromTo(proj, { opacity: 0, y: 70, scale: 0.97 }, { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: "expo.out" }, 5.8);
  proj.insertAdjacentHTML("afterbegin", `<svg id="proj-svg" width="1696" height="240" viewBox="0 0 1696 240" style="position:absolute;left:0;top:0"><rect id="proj-r" x="1" y="1" width="1694" height="238" rx="34" fill="none" stroke="#a88df2" stroke-opacity=".65" stroke-width="2.5" stroke-dasharray="16 12"/></svg>`);
  proj.style.border = "none";
  const pr = $("#proj-r");
  proc((t) => pr.setAttribute("stroke-dashoffset", String(-t * 34)));

  const burst = [1300, 650];
  const slots = ROW;
  PROJ_ICONS.forEach((id, i) => {
    const el = document.createElement("div");
    el.className = "pi" + (LIGHT.has(id) ? " light" : "");
    el.style.cssText = "left:0;top:0;margin:-75px 0 0 -75px;";
    el.innerHTML = `<img src="${icon(id)}">`;
    root.appendChild(el);
    const [sx, sy] = slots[i];
    tl.fromTo(el, { x: burst[0], y: burst[1], scale: 0.1, rotation: -220, opacity: 0 }, { x: sx, y: sy, scale: 1, rotation: 0, opacity: 1, duration: 0.7, ease: "back.out(1.25)" }, enter + 0.02 + i * 0.05);
  });
  tl.fromTo("#proj .p-label", { opacity: 0.4 }, { opacity: 1, duration: 0.2 }, enter);
}
