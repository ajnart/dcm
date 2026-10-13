import { mountCatalog } from "./catalog-view.js";
import { intro } from "./intro.js";
import { mountLinks } from "./links-view.js";
import { palette } from "./palette.js";
import { byId, recipeById } from "./project.js";
import { selection } from "./selection.js";
import { shell } from "./shell.js";
import { tui } from "./tui.js";
import { $, copy, sleep, toast, waitFor } from "./util.js";

const run = async (line) => {
  await intro.skip();
  await shell.run(line);
};
const installSelection = () => selection.size && run(selection.installLine());

palette.setActions([
  { id: "install", glyph: "▶", name: (n) => `Install ${n} selected App${n === 1 ? "" : "s"}`, hint: "in the playground", needsSelection: true, run: installSelection },
  { id: "share", glyph: "⧉", name: () => "Copy share link", hint: "opens with the same Apps picked", needsSelection: true, run: () => $("#share").click() },
  { id: "clear", glyph: "✕", name: () => "Clear selection", hint: "unselect every App", needsSelection: true, run: () => selection.clear() },
  { id: "dashboard", glyph: "◆", name: () => "Open the Dashboard", hint: "self-host, in the playground", run: () => run("self-host") },
  { id: "status", glyph: "$", name: () => "Show status", hint: "self-host status", run: () => run("self-host status") },
  { id: "intro", glyph: "✦", name: () => "Replay the intro", hint: "the onboarding animation, recorded from the CLI", run: () => replay() },
  { id: "autoplay", glyph: "▷", name: () => "Watch the autoplay demo", hint: "install, approve, Dashboard", run: () => autoplay() },
]);

mountCatalog({ onInstall: installSelection, onSearch: () => palette.open() });
mountLinks({ onTry: (ids) => run(`self-host install ${ids.join(" ")}`) });

$("#mod").textContent = `${palette.mod}K`;
const replay = () => {
  if (shell.busy) return;
  shell.reset();
  $("#play").scrollIntoView({ block: "start", behavior: "instant" });
  intro.play();
};
$("#reset").addEventListener("click", replay);
for (const b of document.querySelectorAll("[data-cmd]")) b.addEventListener("click", () => run(b.dataset.cmd));
$("#copy").addEventListener("click", async () => {
  const b = $("#copy");
  b.textContent = (await copy($("#oneliner").textContent)) ? "copied" : "select it";
  setTimeout(() => (b.textContent = "copy"), 1500);
});

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    palette.toggle();
    return;
  }
  const typing = e.target instanceof HTMLInputElement || e.target === $("#screen");
  if (e.key === "/" && !typing && !palette.isOpen) {
    e.preventDefault();
    $("#apps").scrollIntoView({ block: "start" });
    $("#q").focus({ preventScroll: true });
  }
});

async function autoplay() {
  const btn = $("#demo");
  if (btn.disabled || shell.busy) return;
  btn.disabled = true;
  await intro.skip();
  shell.reset();
  try {
    const line = "self-host install media homarr";
    if (!(await shell.type(line, 30))) return;
    const done = shell.submit(line);
    await waitFor(() => shell.asking);
    await sleep(900);
    await shell.answer("y");
    await done;
    await sleep(1200);
    await run("self-host");
    await sleep(2200);
    for (const key of ["ArrowDown", "ArrowDown", "ArrowRight", "ArrowLeft", "Tab"]) {
      tui.key(key);
      await sleep(700);
    }
    tui.key("Tab");
  } finally {
    btn.disabled = false;
  }
}
$("#demo").addEventListener("click", autoplay);

function scrollSpy() {
  const links = [...document.querySelectorAll("#nav a")];
  const sections = links.map((a) => document.getElementById(a.hash.slice(1)));
  let pinned = -1;
  const mark = (current) => links.forEach((a, i) => a.classList.toggle("on", i === current));
  const update = () => {
    if (pinned >= 0) return mark(pinned);
    let current = -1;
    sections.forEach((el, i) => {
      if (el.getBoundingClientRect().top <= 120) current = i;
    });
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2) current = sections.length - 1;
    mark(current);
  };
  links.forEach((a, i) =>
    a.addEventListener("click", () => {
      pinned = i;
      update();
    }),
  );
  for (const type of ["wheel", "touchmove", "keydown"]) addEventListener(type, () => (pinned = -1), { passive: true });
  addEventListener("scroll", update, { passive: true });
  update();
}

function handoff() {
  const params = new URLSearchParams(location.search);
  const wanted = (params.get("apps") ?? "").split(",").filter((id) => byId.has(id) || recipeById.has(id));
  if (params.get("ref") === "dcm") {
    shell.print(["pink", "◆"], " Came from DCM? Same Apps, but installed, signed in and wired to each other for you.");
    shell.print("");
  }
  if (!wanted.length) return intro.whenSeen();
  selection.add(wanted);
  shell.prefill(selection.installLine());
  toast(`${selection.size} Apps picked from your link`);
}

shell.welcome();
scrollSpy();
handoff();
