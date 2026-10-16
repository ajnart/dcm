import { appById, appsByName, expand, recipesByName } from "../lib/catalog";
import { LAN, VERSION, project, urlOf } from "./project.js";
import { $, esc } from "./util.js";

const root = $("#tui");
const keys = $("#keys");
const screen = $("#screen");
const VIEWS = ["dashboard", "stack", "workflow", "install", "settings"];

const ui = { open: false, onClose: null, view: "dashboard", sel: 0, pane: 1, query: "", cursor: 0, picks: new Set(), review: "", activity: [], wsel: 0, expanded: new Set(["homarr"]), busy: false };
let clock = 0;

const sp = (cls, text) => `<span class="${cls}">${esc(text)}</span>`;
const title = (v) => v[0].toUpperCase() + v.slice(1);
const keyline = (pairs) => `<div class="keyline">${pairs.map(([k, v]) => `<b>${esc(k)}</b> ${esc(v)}`).join(" • ")}</div>`;

function glyph(status) {
  if (status === "ok") return sp("green", "✓");
  if (status === "run") return sp("cyan", "↷");
  return sp("dim", "○");
}

function stepRows(app) {
  const rows = app.steps.map(([id, msg, status]) => `<div class="row">${glyph(status)} ${esc(id)}  ${sp("muted", msg)}</div>`);
  for (const t of appById.get(app.id).links.map((l) => l.to)) {
    if (!project.has(t)) rows.push(`<div class="row">${sp("dim", "○")} link-${esc(t)}  ${sp("dim", `waiting for ${t} (install it, or finish its Setup)`)}</div>`);
  }
  return rows.join("");
}

function stateGlyph(app) {
  if (app.state === "running") return sp("green", "●");
  if (app.state === "stopped") return sp("dim", "○");
  return sp("gold", "◐");
}

function topbar() {
  const nav = VIEWS.map((v) => (v === ui.view ? sp("nav-on", ` ${title(v)} `) : sp("muted", title(v)))).join(sp("dim", " · "));
  return `<div class="top"><span class="tag">◆ self-host</span> ${nav}<span class="clock">${new Date().toTimeString().slice(0, 8)} · v${VERSION}</span></div>`;
}

function dashboard() {
  const apps = project.list();
  ui.sel = Math.min(ui.sel, Math.max(0, apps.length - 1));
  const list = apps
    .map((a, i) => {
      const done = project.setupOf(a) === "done" ? sp("green", "✓") : sp("cyan", "↷");
      return `<div class="row${i === ui.sel ? " sel" : ""}">${stateGlyph(a)} ${esc(a.name.padEnd(14).slice(0, 14))} ${sp("muted", urlOf(a).padEnd(26))} ${esc(a.state.padEnd(9))} ${done}</div>`;
    })
    .join("");
  const cur = apps[ui.sel];
  let right = "";
  if (cur) {
    const meta = appById.get(cur.id);
    const tabs = `<div class="tabs">${["logs", "setup", "info"].map((t, i) => sp(i === ui.pane ? "on" : "", t)).join("")}</div><div class="dim">${"─".repeat(60)}</div>`;
    const bodies = [
      () => [`starting ${cur.name}`, meta.port ? `listening on 0.0.0.0:${meta.port}` : "ready", "GET /api/health 200 3ms", "GET / 200 11ms"].map((l, i) => `<div class="row">${sp("muted", `12:0${i * 2}:1${i}`)} ${esc(l)}</div>`).join(""),
      () => stepRows(cur),
      () => `<div class="row wrap">${esc(meta.description)}</div><div class="row"> </div><div class="row">${sp("muted", "image  ")}${esc(meta.image)}</div><div class="row">${sp("muted", "url    ")}${esc(urlOf(cur))}</div><div class="row">${sp("muted", "group  ")}${esc(meta.category)}</div>`,
    ];
    right = `<div class="box grow"><span class="legend">${esc(cur.name)}</span><div class="scroll">${tabs}${bodies[ui.pane]()}</div></div>`;
  }
  const activity = ui.activity.slice(-14).join("");
  const side = activity
    ? `<div class="box grow"><span class="legend">Activity</span><div class="scroll tail">${activity}</div></div>`
    : `<div class="box grow"><span class="legend">Needs action <span class="muted">0</span></span><div class="scroll"><div class="row muted">Nothing needs you. Apps are reachable at ${LAN} on your home network.</div></div></div>`;
  const empty = `<div class="row muted">You have no Apps yet. Press i to install.</div>`;
  return `<div class="body"><div class="col"><div class="box"><span class="legend">Apps <span class="muted">${apps.length}</span></span>${list || empty}</div>${side}</div><div class="col">${right}</div></div>${keyline([
    ["enter", "start/stop"],
    ["o", "open"],
    ["←/→", "tabs"],
    ["i", "install"],
    ["tab", "next view"],
    ["q", "quit"],
  ])}`;
}

function workflow() {
  const apps = project.list();
  const done = apps.filter((a) => project.setupOf(a) === "done").length;
  const running = apps.reduce((n, a) => n + a.steps.filter((s) => s[2] === "run").length, 0);
  ui.wsel = Math.min(ui.wsel, Math.max(0, apps.length - 1));
  const rows = apps
    .map((a, i) => {
      const open = ui.expanded.has(a.id);
      const head = `<div class="row">${i === ui.wsel ? sp("accent", ">") : " "} ${open ? "▾" : "▸"} ${sp("accent bold", a.name)}</div>`;
      return open ? `${head}<div class="indent">${stepRows(a)}</div>` : head;
    })
    .join("");
  return `<div class="body one"><div class="col"><div class="row">${sp("accent bold", "Workflow")} · ${done} Apps fully set up · 0 steps failed · ${running} steps running</div><div class="scroll fill">${rows || '<div class="row muted">No Apps yet. Press i to install.</div>'}</div></div></div>${keyline([
    ["↑/↓", "select"],
    ["space", "collapse"],
    ["tab", "next view"],
    ["q", "quit"],
  ])}`;
}

function installItems() {
  const q = ui.query.toLowerCase();
  const match = (s) => s.toLowerCase().includes(q);
  const recipes = recipesByName.filter((r) => match(r.id) || match(r.name) || match(r.description) || r.apps.some((a) => a.includes(q))).map((r) => ({ kind: "recipe", ...r }));
  const apps = appsByName.filter((a) => match(a.id) || match(a.name) || match(a.description) || match(a.category)).map((a) => ({ kind: "app", ...a }));
  return [...recipes, ...apps];
}

const isPicked = (id) => ui.picks.has(id) || project.has(id);

function recipeMark(r) {
  const n = r.apps.filter(isPicked).length;
  if (n === r.apps.length) return sp("green", " ✓ ");
  if (n) return sp("gold", " ◐ ");
  return sp("dim", " ○ ");
}

function toggleRecipe(r) {
  const all = r.apps.every(isPicked);
  for (const id of r.apps) {
    if (project.has(id)) continue;
    if (all) ui.picks.delete(id);
    else ui.picks.add(id);
  }
}

function toggleApp(id) {
  if (ui.picks.has(id)) ui.picks.delete(id);
  else ui.picks.add(id);
}

function installView() {
  const items = installItems();
  ui.cursor = Math.min(ui.cursor, Math.max(0, items.length - 1));
  const start = Math.max(0, ui.cursor - 10);
  const list = items
    .slice(start, start + 22)
    .map((it, i) => {
      const at = start + i === ui.cursor;
      let mark = "[ ]";
      if (it.kind === "recipe") mark = recipeMark(it);
      else if (project.has(it.id)) mark = sp("green", " ✓ ");
      else if (ui.picks.has(it.id)) mark = sp("accent", "[x]");
      const name = it.kind === "recipe" ? `▣ ${it.name}` : it.name;
      return `<div class="row${at ? " sel" : ""}">${at ? sp("accent", ">") : " "} ${mark} ${esc(name.padEnd(22).slice(0, 22))} ${sp("muted", it.id)}</div>`;
    })
    .join("");
  const cur = items[ui.cursor];
  let detail = '<div class="row muted">No match.</div>';
  if (cur?.kind === "recipe") {
    detail = `<div class="row wrap">${esc(cur.description)}</div><div class="row"> </div><div class="row bold">Apps</div>${cur.apps.map((id) => `<div class="row">${esc(appById.get(id).name.padEnd(16))} ${sp("muted", appById.get(id).description)}</div>`).join("")}`;
  }
  if (cur?.kind === "app") {
    detail = `<div class="row wrap">${esc(cur.description)}</div><div class="row"> </div><div class="row">${sp("muted", "image  ")}${esc(cur.image)}</div><div class="row">${sp("muted", "port   ")}${cur.port || "none"}</div><div class="row">${sp("muted", "group  ")}${esc(cur.category)}</div>${cur.links.length ? `<div class="row wrap">${sp("muted", "links  ")}${esc(cur.links.map((l) => l.to).join(", "))}</div>` : ""}`;
  }
  const picked = ui.picks.size ? sp("accent", ` ${ui.picks.size} picked`) : "";
  const review = ui.review ? `<div class="modal">${ui.review}</div>` : "";
  return `<div class="body"><div class="col"><div class="box grow"><span class="legend">Install <span class="muted">recipes &amp; apps</span>${picked}</span><div class="row">/ ${esc(ui.query)}<span class="accent">▌</span></div><div class="row muted wrap">space picks a Recipe and every App in it · enter shows the plan; nothing installs until you approve</div><div class="row"> </div><div class="scroll">${list}</div></div></div><div class="col"><div class="box grow"><span class="legend">${esc(cur ? cur.name : "")}</span><div class="scroll">${detail}</div></div></div></div>${keyline([
    ["type", "search"],
    ["space", "pick"],
    ["enter", "plan"],
    ["esc", "back"],
  ])}${review}`;
}

function render() {
  if (!ui.open) return;
  const views = { dashboard, workflow, install: installView };
  const body = views[ui.view]?.() ?? `<div class="body one"><div class="col"><div class="box grow"><span class="legend">${esc(ui.view)}</span><div class="row muted">Not in the playground. The real Dashboard has it. Press tab.</div></div></div></div>${keyline([["tab", "next view"], ["q", "quit"]])}`;
  root.innerHTML = topbar() + body;
}

function logActivity(html) {
  ui.activity.push(`<div class="row">${html}</div>`);
}

function approve() {
  const { ids } = expand([...ui.picks]);
  ui.picks.clear();
  ui.review = "";
  ui.view = "dashboard";
  ui.activity = [];
  ui.busy = true;
  project
    .install(ids, (e) => {
      if (e.type === "run") logActivity(`▶ ${esc(e.msg)}`);
      if (e.type === "pull") logActivity(`${sp("green", "✓")} pulled ${esc(e.image)}`);
      if (e.type === "step") logActivity(`  ${sp("green", "✓")} ${esc(e.app)} › ${esc(e.step)} ${sp("muted", e.msg)}`);
      if (e.type === "end") logActivity(`■ ${esc(e.msg)}`);
    })
    .finally(() => {
      ui.busy = false;
      render();
    });
}

function review() {
  const items = installItems();
  if (!ui.picks.size && items[ui.cursor]) ui.picks.add(items[ui.cursor].id);
  const { fresh } = project.plan([...ui.picks]);
  if (!fresh.length || ui.busy) {
    ui.picks.clear();
    return;
  }
  const lines = fresh.map((a) => `${sp("green", "+ ")}${esc(`${a.id.padEnd(18)} ${a.category.padEnd(16)} ${a.url}`)}`);
  ui.review = `${sp("bold", "Review")}\n\n${lines.join("\n")}\n\n${sp("muted", "Project   ")}~/.self-host\n${sp("muted", "Access    ")}Home network at ${LAN}\n\n${sp("bold", `Install ${fresh.length} App${fresh.length > 1 ? "s" : ""}?`)}  ${sp("accent", "y")} approve · ${sp("accent", "n")} back`;
}

function installKey(key) {
  const items = installItems();
  if (key === "Escape") {
    if (ui.query) ui.query = "";
    else ui.view = "dashboard";
  } else if (key === "ArrowDown") ui.cursor = Math.min(items.length - 1, ui.cursor + 1);
  else if (key === "ArrowUp") ui.cursor = Math.max(0, ui.cursor - 1);
  else if (key === " ") {
    const it = items[ui.cursor];
    if (it?.kind === "recipe") toggleRecipe(it);
    else if (it && !project.has(it.id)) toggleApp(it.id);
  } else if (key === "Enter") review();
  else if (key === "Backspace") ui.query = ui.query.slice(0, -1);
  else if (key.length === 1 && /[\w\- ]/.test(key)) {
    ui.query += key;
    ui.cursor = 0;
  }
}

function key(k) {
  if (ui.review) {
    if (k === "y" || k === "Enter") approve();
    else if (k === "n" || k === "Escape") ui.review = "";
    return render();
  }
  if (k === "Tab") {
    ui.view = VIEWS[(VIEWS.indexOf(ui.view) + 1) % VIEWS.length];
    return render();
  }
  if (ui.view === "install") {
    installKey(k);
    return render();
  }
  if (k === "q" || k === "Escape") return tui.close();
  if (k === "i") {
    ui.view = "install";
    return render();
  }
  const apps = project.list();
  const down = k === "ArrowDown" || k === "j";
  const up = k === "ArrowUp" || k === "k";
  if (ui.view === "workflow") {
    if (down) ui.wsel = Math.min(apps.length - 1, ui.wsel + 1);
    if (up) ui.wsel = Math.max(0, ui.wsel - 1);
    const id = apps[ui.wsel]?.id;
    if ((k === " " || k === "Enter") && id) {
      if (ui.expanded.has(id)) ui.expanded.delete(id);
      else ui.expanded.add(id);
    }
  }
  if (ui.view === "dashboard") {
    if (down) ui.sel = Math.min(apps.length - 1, ui.sel + 1);
    if (up) ui.sel = Math.max(0, ui.sel - 1);
    if (k === "ArrowRight" || k === "l") ui.pane = (ui.pane + 1) % 3;
    if (k === "ArrowLeft" || k === "h") ui.pane = (ui.pane + 2) % 3;
    const cur = apps[ui.sel];
    if (k === "Enter" && cur && !ui.busy) {
      const next = cur.state === "running" ? "stopped" : "running";
      logActivity(`  ${sp("green", "✓")} ${esc(cur.id)} ${next === "running" ? "started" : "stopped"}`);
      project.setState(cur.id, next);
    }
    if (k === "o" && cur) logActivity(`${sp("muted", "→ would open ")}${sp("cyan", urlOf(cur))}`);
  }
  render();
}

project.onChange(render);

screen.addEventListener("keydown", (e) => {
  if (!ui.open || e.target !== screen || e.metaKey || e.ctrlKey || e.altKey) return;
  e.preventDefault();
  key(e.key);
});

for (const b of keys.querySelectorAll("button")) {
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    key(b.dataset.key);
    screen.focus({ preventScroll: true });
  });
}

export const tui = {
  get isOpen() {
    return ui.open;
  },
  key,
  open(onClose) {
    ui.open = true;
    ui.onClose = onClose;
    ui.view = project.size ? "dashboard" : "install";
    ui.review = "";
    root.hidden = false;
    keys.hidden = false;
    clock = setInterval(render, 1000);
    render();
    screen.focus({ preventScroll: true });
  },
  close() {
    ui.open = false;
    clearInterval(clock);
    root.hidden = true;
    keys.hidden = true;
    ui.onClose?.();
  },
};
