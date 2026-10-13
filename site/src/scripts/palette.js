import { apps as APPS } from "../lib/catalog";
import { selection } from "./selection.js";
import { $, iconEl } from "./util.js";

const dialog = $("#palette");
const input = $("#pq");
const list = $("#plist");
const count = $("#pcount");
const hint = $("#phint");
const mod = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl";

let cursor = 0;
let items = [];
let actions = [];

function matches(needle, ...fields) {
  return !needle || fields.join(" ").toLowerCase().includes(needle);
}

function collect() {
  const needle = input.value.toLowerCase().trim();
  const n = selection.size;
  const available = actions.filter((a) => (!a.needsSelection || n > 0) && matches(needle, a.name(n), a.hint));
  const hits = APPS.filter((a) => matches(needle, a.id, a.name, a.description, a.category));
  const picked = hits.filter((a) => selection.has(a.id));
  const apps = [...picked, ...hits.filter((a) => !selection.has(a.id))].slice(0, Math.max(picked.length, needle ? 50 : 30));
  return [...available.map((a) => ({ kind: "action", ...a })), ...apps.map((a) => ({ kind: "app", app: a }))];
}

function heading(text) {
  const h = document.createElement("div");
  h.className = "pgroup";
  h.textContent = text;
  return h;
}

function row(item, index) {
  const el = document.createElement("div");
  el.className = "pitem";
  el.setAttribute("role", "option");
  el.dataset.index = index;
  if (item.kind === "action") {
    const glyph = document.createElement("span");
    glyph.className = "pglyph";
    glyph.textContent = item.glyph;
    const name = document.createElement("span");
    name.className = "pname";
    name.textContent = item.name(selection.size);
    const sub = document.createElement("span");
    sub.className = "pdesc";
    sub.textContent = item.hint;
    el.append(glyph, name, sub);
    return el;
  }
  const on = selection.has(item.app.id);
  el.classList.toggle("picked", on);
  el.setAttribute("aria-selected", String(on));
  const box = document.createElement("span");
  box.className = "pcheck";
  box.textContent = on ? "■" : "□";
  const name = document.createElement("span");
  name.className = "pname";
  name.textContent = item.app.name;
  const sub = document.createElement("span");
  sub.className = "pdesc";
  sub.textContent = item.app.description;
  const cat = document.createElement("span");
  cat.className = "pcat";
  cat.textContent = item.app.category;
  el.append(box, iconEl(item.app), name, sub, cat);
  return el;
}

function draw() {
  items = collect();
  cursor = Math.min(cursor, Math.max(0, items.length - 1));
  list.replaceChildren();
  let group = "";
  items.forEach((item, i) => {
    if (item.kind !== group) {
      group = item.kind;
      list.append(heading(group === "action" ? "actions" : "apps"));
    }
    const el = row(item, i);
    el.classList.toggle("on", i === cursor);
    list.append(el);
  });
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "pempty";
    empty.textContent = `No App matches "${input.value}".`;
    list.append(empty);
  }
  const n = selection.size;
  count.textContent = n ? `${n} selected` : "";
  hint.innerHTML = `<kbd>↑↓</kbd> move <kbd>↵</kbd> pick${n ? ` <kbd>${mod}↵</kbd> install ${n}` : ""} <kbd>esc</kbd> close`;
  list.querySelector(".on")?.scrollIntoView({ block: "nearest" });
}

function move(to) {
  cursor = Math.max(0, Math.min(items.length - 1, to));
  for (const el of list.querySelectorAll(".pitem")) el.classList.toggle("on", Number(el.dataset.index) === cursor);
  list.querySelector(".on")?.scrollIntoView({ block: "nearest" });
}

function pick(item) {
  if (!item) return;
  if (item.kind === "action") {
    dialog.close();
    item.run();
    return;
  }
  selection.toggle(item.app.id);
  draw();
}

input.addEventListener("input", () => {
  cursor = 0;
  draw();
});

input.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") move(cursor + 1);
  else if (e.key === "ArrowUp") move(cursor - 1);
  else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    const install = actions.find((a) => a.id === "install");
    if (selection.size && install) {
      dialog.close();
      install.run();
    }
  } else if (e.key === "Enter") pick(items[cursor]);
  else return;
  e.preventDefault();
});

list.addEventListener("mousemove", (e) => {
  const el = e.target.closest(".pitem");
  if (el && Number(el.dataset.index) !== cursor) move(Number(el.dataset.index));
});

list.addEventListener("click", (e) => {
  const el = e.target.closest(".pitem");
  if (el) pick(items[Number(el.dataset.index)]);
  input.focus();
});

dialog.addEventListener("click", (e) => {
  if (e.target === dialog) dialog.close();
});

export const palette = {
  mod,
  setActions(list) {
    actions = list;
  },
  open() {
    input.value = "";
    cursor = 0;
    draw();
    dialog.showModal();
    input.focus();
  },
  toggle() {
    if (dialog.open) dialog.close();
    else palette.open();
  },
  get isOpen() {
    return dialog.open;
  },
};
