import { apps as APPS, appById, starLabel } from "../lib/catalog";
import { selection } from "./selection.js";
import { $, copy, esc, iconEl, toast } from "./util.js";

const PREVIEW = 24;

function starBadge(app) {
  const a = document.createElement("a");
  a.className = "stars";
  a.href = `https://github.com/${app.repo}`;
  a.target = "_blank";
  a.rel = "noopener";
  a.title = `${app.stars.toLocaleString("en")} stars on GitHub`;
  a.innerHTML = `<span class="star" aria-hidden="true">★</span>${starLabel(app.stars)}`;
  return a;
}

function card(app) {
  const box = document.createElement("div");
  box.className = "cardbox";
  const b = document.createElement("button");
  b.type = "button";
  b.className = "card";
  const port = app.port ? `:${app.port}` : "no ui";
  const wires = app.links.length ? `wires to ${app.links.length} App${app.links.length === 1 ? "" : "s"}` : "&nbsp;";
  b.innerHTML = `<span class="t"><span class="who"></span><span class="muted">${port}</span></span><small>${esc(app.description)}</small><span class="meta">${wires}</span>`;
  const name = document.createElement("b");
  name.textContent = app.name;
  b.querySelector(".who").append(iconEl(app), name);
  b.addEventListener("click", () => selection.toggle(app.id));
  box.append(b);
  if (app.repo) box.append(starBadge(app));
  return { box, button: b };
}

function drawStack() {
  const stack = $("#stack");
  stack.replaceChildren();
  for (const id of selection.ids()) {
    const b = document.createElement("button");
    b.type = "button";
    b.title = `remove ${appById.get(id).name}`;
    b.append(iconEl(appById.get(id)));
    b.addEventListener("click", () => selection.remove(id));
    stack.append(b);
  }
}

function drawWires() {
  const box = $("#wires");
  const links = selection.links();
  const tiles = selection.dashboardCandidates();
  box.replaceChildren();
  if (links.length) {
    const head = document.createElement("b");
    head.textContent = `⇄ ${links.length} Link${links.length === 1 ? "" : "s"} wired for you`;
    box.append(head);
    const bySource = Map.groupBy(links, (l) => l.from);
    for (const [from, out] of bySource) {
      const group = document.createElement("span");
      group.className = "pair";
      group.title = out.map((l) => l.title).join("\n");
      const name = document.createElement("strong");
      name.textContent = appById.get(from).name;
      group.append(name, ` → ${out.map((l) => appById.get(l.to).name).join(", ")}`);
      box.append(group);
    }
  }
  if (tiles.length) {
    const hint = document.createElement("button");
    hint.type = "button";
    hint.className = "hint";
    hint.textContent = `+ add Homarr and these ${tiles.length} get tiles and widgets on one dashboard`;
    hint.addEventListener("click", () => selection.add(["homarr"]));
    box.append(hint);
  }
  box.hidden = !box.childElementCount;
}

export function mountCatalog({ onInstall, onSearch }) {
  const grid = $("#catalog");
  const filter = $("#q");
  const more = $("#more");
  const unselect = $("#unselect");
  let expanded = false;
  const pinned = [...APPS].sort((a, b) => Number(b.id === "homarr") - Number(a.id === "homarr"));
  const cards = pinned.map((app) => {
    const el = card(app);
    grid.append(el.box);
    return [app, el];
  });

  const redraw = () => {
    const needle = filter.value.toLowerCase().replace(/^\//, "").trim();
    const capped = !expanded && !needle;
    let shown = 0;
    for (const [app, el] of cards) {
      const match = !needle || `${app.id} ${app.name} ${app.description} ${app.category}`.toLowerCase().includes(needle);
      el.box.hidden = !match || (capped && shown >= PREVIEW);
      if (!el.box.hidden) shown++;
      el.button.setAttribute("aria-pressed", String(selection.has(app.id)));
    }
    more.hidden = !capped;
  };

  const sync = () => {
    const n = selection.size;
    $("#selcount").textContent = `${n} App${n === 1 ? "" : "s"} selected`;
    for (const id of ["share", "unselect", "install-sel"]) $(`#${id}`).disabled = n === 0;
    $("#selcmd").textContent = n ? selection.installLine() : "self-host install …  (pick some Apps)";
    drawStack();
    drawWires();
    redraw();
  };

  const disarm = () => {
    unselect.classList.remove("danger");
    unselect.textContent = "unselect";
  };

  filter.addEventListener("input", redraw);
  more.addEventListener("click", () => {
    expanded = true;
    redraw();
  });
  $("#share").addEventListener("click", async () => {
    const copied = await copy(selection.shareUrl());
    toast(copied ? "Share link copied. Whoever opens it gets these Apps picked." : selection.shareUrl());
  });
  unselect.addEventListener("click", () => {
    if (!unselect.classList.contains("danger")) {
      unselect.classList.add("danger");
      unselect.textContent = "u sure?";
      return;
    }
    disarm();
    selection.clear();
  });
  unselect.addEventListener("mouseleave", disarm);
  $("#install-sel").addEventListener("click", onInstall);
  $("#open-palette").addEventListener("click", onSearch);
  selection.onChange(sync);
  sync();
}
