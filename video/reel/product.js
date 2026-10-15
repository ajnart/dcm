import { $, $$, proc, clamp, scene, appIcon, chars, diamond, read, cue, typeCues, on, cut } from "./lib.js";
import { SC, b } from "./timeline.js";

// No Recipe covers these Apps exactly, so the command names their Catalog ids (self-host apps list --json); Homarr goes last so its Links find them ready
export const PROJ_ICONS = ["qbittorrent", "sonarr", "jellyfin", "immich", "nextcloud", "vaultwarden", "homarr"];
export const CMD_LINES = ["self-host install qbittorrent sonarr jellyfin\n", "  immich nextcloud vaultwarden homarr"];
export const CMD_TEXT = CMD_LINES.join("");
export const WIN = { x: 220, y: 270, w: 1480, h: 720 };
const PROJ = { x: 112, y: 660 };
const [A, B] = SC.product;
// beats: 0 the drop, a violet diamond out of the collapsed wall, the wordmark · 1 the violet folds into the
// mark · 2 the lockup docks · 2.5-3.5 the command types · 4 enter, what it resolved · 5 the Compose Project
// and its seven Apps · 7 the box opens into the TUI window of the next scene
const T = { drop: b(12), mark: b(13), dock: b(14), type: [b(14.5), b(15.5)], enter: b(16), proj: b(17), morph: b(19) };

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
  const sc = 0.28, x1 = 112, y1 = 96;

  const dia = $("#dia");
  tl.fromTo(dia, { clipPath: diamond(960, 540, 40) }, { clipPath: diamond(960, 540, 1560), duration: 0.45, ease: "expo.out" }, T.drop);
  tl.fromTo(dia, { clipPath: diamond(960, 540, 1560) }, { clipPath: diamond(x0 + mx, y0 + my, mw / 2), duration: 0.42, ease: "expo.inOut" }, T.mark);
  proc((t) => {
    const docked = t >= T.mark + 0.42;
    dia.style.visibility = docked ? "hidden" : "visible";
    mark.style.opacity = docked ? 1 : 0;
  });
  cut(T.drop, "the drop: violet flood, wordmark");
  on(T.mark, "the flood folds into the mark");
  cue(T.drop, "impact", { size: 0.9 });
  cue(T.mark, "whoosh", { dur: 0.4, soft: true });

  letters.forEach((c, i) => tl.fromTo(c, { yPercent: 115 }, { yPercent: 0, duration: 0.35, ease: "expo.out" }, T.drop + 0.04 + i * 0.015));
  tl.fromTo(lockup, { x: x0, y: y0, scale: 1 }, { x: x1, y: y1, scale: sc, duration: 0.5, ease: "expo.inOut" }, T.dock);
  cue(T.dock, "whoosh", { dur: 0.45, pan: -0.6 });
  read(wm, T.drop + 0.04 + letters.length * 0.015 + 0.35, T.dock - 0.01, "wordmark");
  read(wm, T.dock + 0.5, T.morph - 0.01, "docked wordmark");
  on(T.dock, "the lockup docks");

  // the command types with a key sound per character; enter prints what it resolved
  const cmdL1 = $("#cmd-l1"), cmdL2 = $("#cmd-l2"), caret = $("#cmd-c");
  proc((t) => {
    const n = Math.round(CMD_TEXT.length * clamp((t - T.type[0]) / (T.type[1] - T.type[0])));
    const typed = CMD_TEXT.slice(0, n);
    cmdL1.textContent = typed.slice(0, CMD_LINES[0].length).replace(/ /g, "\u00a0");
    cmdL2.textContent = typed.slice(CMD_LINES[0].length).replace(/ /g, "\u00a0");
    const typing = t >= T.type[0] && t < T.type[1];
    caret.style.visibility = t < T.dock + 0.2 || t >= T.enter ? "hidden" : typing || Math.floor((t - T.dock) * 4) % 2 === 0 ? "visible" : "hidden";
  });
  tl.fromTo("#cmd", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.35, ease: "expo.out" }, T.dock + 0.2);
  typeCues(CMD_TEXT, T.type[0], T.type[1]);
  on(T.type[0], "the command types");
  read(cmdL1, T.type[0] + ((T.type[1] - T.type[0]) * CMD_LINES[0].length) / CMD_TEXT.length + 0.02, T.morph - 0.01, "command line 1");
  read(cmdL2, T.type[1] + 0.02, T.morph - 0.01, "command line 2");

  $$("#out .o").forEach((o, i) => tl.fromTo(o, { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.35, ease: "expo.out" }, T.enter + i * 0.06));
  on(T.enter, "enter: 6 Apps, homarr the Dashboard");
  cue(T.enter, "enter");
  read("#o1", T.enter + 0.36, T.morph - 0.01);
  read("#o2", T.enter + 0.42, T.morph - 0.01);
  tl.fromTo(["#cmd", "#out"], { opacity: 1, y: 0 }, { opacity: 0, y: -40, duration: 0.25, ease: "power3.in" }, T.morph);
  tl.fromTo(lockup, { opacity: 1 }, { opacity: 0, duration: 0.2 }, T.morph);

  // the Compose Project draws on beat 5 with its seven Apps; on beat 7 it opens into the TUI window
  const box = $("#proj-box");
  tl.fromTo(box, { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 0.45, ease: "expo.out" }, T.proj);
  tl.fromTo(box, { left: 0, top: 0, width: 1696, height: 300, borderRadius: 4, borderColor: "rgba(168,141,242,0.55)" },
    { left: WIN.x - PROJ.x, top: WIN.y - PROJ.y, width: WIN.w, height: WIN.h, borderRadius: 6, borderColor: "rgba(255,255,255,0.12)", duration: 0.5, ease: "expo.inOut" }, T.morph);
  tl.fromTo("#p-label", { yPercent: 100, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.35, ease: "expo.out" }, T.proj + 0.05);
  tl.fromTo("#p-label", { opacity: 1 }, { opacity: 0, duration: 0.12 }, T.morph);
  read("#p-label", T.proj + 0.41, T.morph - 0.01);
  on(T.proj, "the Compose Project and its seven Apps");
  cue(T.proj, "zip");
  cue(T.morph, "whoosh", { dur: 0.5 });

  const row = $("#proj-row");
  PROJ_ICONS.forEach((id, i) => {
    const el = document.createElement("div");
    el.className = "pi";
    el.innerHTML = `<img src="${appIcon(id)}">`;
    row.appendChild(el);
    const at = T.proj + 0.08 + i * 0.035;
    tl.fromTo(el, { y: -60, opacity: 0, scale: 0.8 }, { y: 0, opacity: 1, scale: 1, duration: 0.45, ease: "expo.out" }, at);
    tl.fromTo(el, { opacity: 1, scale: 1 }, { opacity: 0, scale: 0.9, duration: 0.15 }, T.morph + i * 0.01);
    cue(at + 0.1, "pop", { i });
  });
  on(T.morph, "the box opens into the TUI");
}
