import { apps as APPS, recipes as RECIPES, appById, linksAmong, recipeById } from "../lib/catalog";
import { LAN, VERSION, project, urlOf } from "./project.js";
import { $, pad, sleep } from "./util.js";
import { tui } from "./tui.js";

const out = $("#out");
const cmd = $("#cmd");
const box = $("#shell");
const prompt = $("#prompt");
const screen = $("#screen");
const PS = '<span class="green">you@home</span> <span class="cyan">~</span> $';

const state = { busy: false, history: [], hist: 0, ask: null, queue: [] };

const HELP = `Install and run self-hosted apps with Docker Compose

Usage:
  self-host [flags]
  self-host [command]

Available Commands:
  apps        Browse the catalog of Apps and Recipes
  backup      Write one compressed archive of App configuration, databases and secrets
  credentials Print the Admin login and per-App API keys
  debug       Print the Debug report of an App
  doctor      Check Docker, Compose, App bindings, firewalls and LAN reachability
  install     Install Apps or Recipes and run their Setup
  logs        Print an App's container logs
  remove      Remove Apps; data in apps/<id>/ is kept unless --purge
  restart     Restart Apps (all when none named)
  setup       Rerun Setup; finished steps are skipped
  skill       Print the agent guide that matches this binary
  start       Start Apps (all when none named)
  status      Show Access, Host settings and every App's URL, state and Setup
  stop        Stop Apps (all when none named)
  update      Pull newer images, recreate Apps and rerun Check

Flags:
      --json      print one JSON event per line
  -y, --yes       install without asking for confirmation
      --version   version for self-host

Run self-host with no command to open the Dashboard.
Playground extras: clear, reset, history`;

const COMMANDS = ["apps", "backup", "credentials", "debug", "doctor", "install", "logs", "remove", "restart", "setup", "skill", "start", "status", "stop", "update"];

export function print(...parts) {
  const div = document.createElement("div");
  for (const p of parts) {
    if (typeof p === "string") {
      div.append(p);
      continue;
    }
    const span = document.createElement("span");
    span.className = p[0];
    span.textContent = p[1];
    div.append(span);
  }
  out.append(div);
  box.scrollTop = box.scrollHeight;
}

const ok = (...rest) => print("  ", ["green", "✓"], ...rest);

function render(event) {
  if (event.type === "run") print(`▶ ${event.msg}`);
  if (event.type === "pull") print(["green", "✓"], ` pulled ${event.image}`);
  if (event.type === "step" && event.step.startsWith("link-")) print(["accent", "⇄"], ` ${event.app} → ${event.step.slice(5)} `, ["muted", event.msg]);
  else if (event.type === "step") ok(` ${event.app} › ${event.step} `, ["muted", event.msg]);
  if (event.type === "end") print(`■ ${event.msg}`);
}

function askYes(question) {
  print(["bold", question], ["muted", " [y/N] "]);
  return new Promise((resolve) => {
    state.ask = resolve;
    prompt.classList.remove("busy");
    prompt.querySelector(".ps").textContent = ">";
    cmd.focus();
  });
}

async function install(targets, yes) {
  const { fresh, unknown } = project.plan(targets);
  if (unknown.length) return print(["red", `✗ unknown app "${unknown[0]}" (see: self-host apps list)`]);
  if (!fresh.length) return print(["muted", "Everything you asked for is already installed. See: self-host status"]);
  if (!yes) {
    print(["bold", "Plan"]);
    for (const a of fresh) {
      print("  ", ["green", "+"], ` ${pad(a.id, 18)} ${pad(a.category, 16)} ${a.url}`);
      print("      ", ["muted", a.description]);
    }
    const ids = fresh.map((a) => a.id);
    const links = linksAmong([...project.list().map((a) => a.id), ...ids]).filter((l) => ids.includes(l.from) || ids.includes(l.to));
    if (links.length) {
      print("");
      print(["bold", "Links"], ["muted", " wired after install, using each App's own API and keys"]);
      for (const l of links) print("  ", ["accent", "⇄"], ` ${pad(`${l.from} → ${l.to}`, 26)} `, ["muted", l.title]);
    }
    print("");
    print(["muted", "Project   "], "~/.self-host");
    print(["muted", "Access    "], `Home network (LAN) at ${LAN}`);
    print(["muted", "Secrets   "], "generated into secrets.env (mode 0600), never printed");
    print("");
    const approved = await askYes(`Install ${fresh.length} App${fresh.length > 1 ? "s" : ""}?`);
    if (!approved) return print(["muted", "Nothing changed."]);
  }
  await project.install(
    fresh.map((a) => a.id),
    render,
  );
  print("");
  status();
}

function dot(app) {
  if (app.state === "running") return ["green", "●"];
  if (app.state === "stopped") return ["dim", "○"];
  return ["gold", "◐"];
}

function noProject() {
  print(["red", "✗ no Project yet"], ["muted", " · install something first: self-host install <app|recipe>"]);
}

function status(json) {
  const apps = project.list();
  if (!apps.length) return json ? print('{"error":"no Project yet"}') : noProject();
  if (json) {
    const doc = { home: "~/.self-host", access: "lan", lan_ip: LAN, apps: apps.map((a) => ({ id: a.id, url: urlOf(a), state: a.state, setup: project.setupOf(a), description: appById.get(a.id).d })) };
    return print(JSON.stringify(doc, null, 2));
  }
  print(`You have ${apps.length} App${apps.length > 1 ? "s" : ""}.`);
  for (const a of apps) print("  ", ["bold", pad(a.name, 18)], ["cyan", pad(urlOf(a), 28)], ["muted", appById.get(a.id).d]);
  if (project.has("homarr")) print("Dashboard: Homarr at ", ["cyan", urlOf(project.get("homarr"))]);
  print("Everything lives in ~/.self-host.");
  print("");
  print(["muted", "Access    "], `Home network, other devices reach the Apps at ${LAN}`);
  print(["muted", "Settings  "], "TZ=Europe/Paris PUID=1000 PGID=1000 UMASK=002");
  print("");
  print(["muted", `${pad("APP", 22)}${pad("URL", 28)}${pad("STATE", 10)}${pad("HEALTH", 9)}SETUP`]);
  for (const a of apps) {
    const setup = project.setupOf(a);
    print(dot(a), ` ${pad(a.id, 20)}${pad(urlOf(a), 28)}${pad(a.state, 10)}${pad(a.state === "running" ? "healthy" : "-", 9)}`, [setup === "done" ? "green" : "gold", setup]);
  }
}

function appsList(json) {
  if (json) return print(JSON.stringify({ apps: APPS.map(({ id, name, d, c, p }) => ({ id, name, description: d, category: c, port: p })), recipes: RECIPES }, null, 2));
  print(["bold", "Recipes"]);
  for (const r of RECIPES) print("  ", ["accent", pad(r.id, 20)], ` ${r.description} `, ["muted", `(${r.apps.join(", ")})`]);
  print("");
  print(["bold", "Apps"]);
  for (const a of APPS) print("  ", ["cyan", pad(a.id, 20)], ` ${a.description}`);
}

function appsInfo(id) {
  const a = appById.get(id);
  const r = recipeById.get(id);
  if (r) {
    print(["bold", r.name], ` — ${r.description}`);
    return print(["muted", "apps   "], r.apps.join(", "));
  }
  if (!a) return print(["red", `✗ unknown app "${id ?? ""}" (see: self-host apps list)`]);
  print(["bold", a.name], ` — ${a.description}`);
  print(["muted", "image  "], a.image);
  print(["muted", "port   "], a.port ? String(a.port) : "none, it has no web page");
  print(["muted", "group  "], a.category);
  a.links.forEach((l, i) => print(["muted", i ? "       " : "links  "], ["accent", "⇄ "], pad(l.to, 16), ["muted", l.title]));
  print("");
  print(["muted", "try: "], ["cyan", `self-host install ${a.id}`]);
}

async function doctor() {
  const checks = [
    ["docker", "Docker: docker command found"],
    ["docker-socket", "Docker daemon: engine 29.8.2"],
    ["compose", "Docker Compose: v2.40.1"],
    ["lan", `LAN address: ${LAN} reachable from this machine`],
    ["ports", "Ports: catalog defaults are free"],
    ["disk", "Disk: 412 GB free in ~/.self-host"],
  ];
  print("▶ doctor");
  for (const [id, msg] of checks) {
    await sleep(160);
    ok(` ${id} `, ["muted", msg]);
  }
  print("■ doctor: ok");
}

function lifecycle(verb, ids) {
  if (!project.size) return noProject();
  for (const id of ids.length ? ids : project.list().map((a) => a.id)) {
    if (!project.has(id)) {
      print(["red", `✗ ${id} is not installed`]);
      continue;
    }
    if (verb === "remove") {
      project.remove(id);
      ok(` ${id} removed `, ["muted", `data in apps/${id}/ is kept unless --purge`]);
      continue;
    }
    project.setState(id, verb === "stop" ? "stopped" : "running");
    ok(` ${id} ${{ stop: "stopped", start: "started", restart: "restarted" }[verb]}`);
  }
}

function logs(id) {
  if (!project.has(id)) return print(["red", `✗ ${id ?? "an App"} is not installed`], ["muted", " · usage: self-host logs <app>"]);
  const app = appById.get(id);
  const now = Date.now();
  const ts = (s) => new Date(now - s * 1000).toISOString().slice(11, 19);
  print(["muted", `${ts(42)} `], `[${id}] starting ${app.name}`);
  print(["muted", `${ts(41)} `], `[${id}] ${app.port ? `listening on 0.0.0.0:${app.port}` : "ready"}`);
  print(["muted", `${ts(30)} `], `[${id}] GET /api/health 200 3ms`);
  print(["muted", `${ts(2)} `], `[${id}] GET / 200 11ms`);
}

function credentials() {
  if (!project.size) return noProject();
  print("Shared Admin login");
  print("  user      admin");
  print("  password  ", ["gold", project.password], ["muted", "   (demo value)"]);
  print("");
  print(["muted", "Passwords and API keys stored in secrets.env (mode 0600)."]);
}

async function backup() {
  if (!project.size) return noProject();
  print("▶ backup");
  for (const a of project.list()) {
    await sleep(120);
    ok(` ${a.id} `, ["muted", "configuration, database and secrets"]);
  }
  print(`■ wrote backups/self-host-${new Date().toISOString().slice(0, 10)}.tar.zst`);
}

function skill() {
  print(["bold", `# self-host agent guide (binary version ${VERSION})`]);
  print("");
  print("`self-host` installs, configures, backs up and repairs self-hosted Apps with one");
  print("Docker Compose Project in the Home folder, `~/.self-host`. Add `--json` whenever");
  print("you read the output yourself.");
  print("");
  print(["bold", "## Every conversation"]);
  print("1. In a new conversation, run `self-host status --json` before anything else.");
  print("2. If the Profile's `experience` is empty, ask once: \"Have you run your own");
  print("   server or used Docker before, or is this all new to you?\"");
  print("3. Before installing software, changing Access or deleting data, say one plain");
  print("   sentence about what will happen and wait for a yes.");
  print(["muted", "… (the full guide ships in the binary)"]);
}

const EXTRAS = {
  sudo: () => print(["muted", "self-host runs as you. No sudo needed, that's the point."]),
  clear: () => out.replaceChildren(),
  reset: () => shell.reset(),
  history: () => state.history.forEach((h, i) => print(["muted", pad(i + 1, 4)], h)),
  help: () => print(HELP),
  "?": () => print(HELP),
  ls: () => print(project.size ? "apps  backups  compose.yml  secrets.env  state.json" : ""),
  whoami: () => print("you, running your own stuff"),
  exit: () => print(["muted", "There is no escape. Try q inside the Dashboard."]),
  curl: () => print(["muted", "The real installer is below in Install. Here, self-host is already on your PATH."]),
  docker: () => print(["muted", "self-host drives docker compose for you. Try: self-host status"]),
};

async function run(line) {
  const [head, ...rest] = line.trim().split(/\s+/).filter(Boolean);
  if (!head) return;
  if (EXTRAS[head]) return EXTRAS[head]();
  if (head !== "self-host" && head !== "sh") return print(["red", `${head}: command not found`], ["muted", " · try help"]);
  const json = rest.includes("--json");
  const yes = rest.includes("-y") || rest.includes("--yes");
  const [sub, ...params] = rest.filter((w) => !w.startsWith("-"));
  if (rest.includes("--version")) return print(`self-host version ${VERSION}`);
  if (rest.includes("-h") || rest.includes("--help") || sub === "help") return print(HELP);
  switch (sub) {
    case undefined:
      return openDashboard();
    case "apps":
      if (params[0] === "info") return appsInfo(params[1]);
      if (params[0] === "list" || !params[0]) return appsList(json);
      return print(["red", `✗ unknown command "${params[0]}" for "self-host apps"`]);
    case "install":
      if (!params.length) return print(["red", "✗ requires at least 1 arg(s)"], ["muted", " · self-host install <app|recipe>..."]);
      return install(params, yes || json);
    case "status":
      return status(json);
    case "doctor":
      return doctor();
    case "start":
    case "stop":
    case "restart":
    case "remove":
      return lifecycle(sub, params);
    case "logs":
      return logs(params[0]);
    case "credentials":
      return credentials();
    case "backup":
      return backup();
    case "skill":
      return skill();
    case "debug": {
      const app = project.get(params[0]);
      if (!app) return print(["red", `✗ ${params[0] ?? "an App"} is not installed`]);
      print(["bold", `${app.name} · ${app.state}`], ["muted", ` · ${urlOf(app)}`]);
      print(["muted", "failed steps  "], "none");
      print(["muted", "health check  "], ["green", "200 OK"]);
      return logs(app.id);
    }
    case "update":
      if (!project.size) return noProject();
      print("▶ update");
      for (const a of project.list()) ok(` ${a.id} `, ["muted", "image is current"]);
      return print("■ update: nothing newer");
    case "setup":
      return print(["muted", "Every finished step is skipped. Nothing left to run."]);
    default:
      print(["red", `✗ unknown command "${sub}" for "self-host"`], ["muted", " · self-host --help"]);
  }
}

function openDashboard() {
  box.hidden = true;
  $("#term-title").textContent = "self-host — Dashboard";
  tui.open(closeDashboard);
}

function closeDashboard() {
  box.hidden = false;
  $("#term-title").textContent = "you@home: ~";
  prompt.classList.remove("busy");
  box.scrollTop = box.scrollHeight;
  cmd.focus({ preventScroll: true });
}

function complete() {
  const words = cmd.value.split(" ");
  const last = words[words.length - 1];
  let pool = [...project.list().map((a) => a.id)];
  if (words.length === 1) pool = ["self-host", "help", "clear"];
  else if (words.length === 2 && words[0] === "self-host") pool = COMMANDS;
  else if (words[1] === "install") pool = [...RECIPES.map((r) => r.id), ...APPS.map((a) => a.id)];
  else if (words[1] === "apps" && words.length === 3) pool = ["list", "info"];
  else if (words[1] === "apps" && words[2] === "info") pool = APPS.map((a) => a.id);
  const hits = pool.filter((p) => p.startsWith(last));
  if (hits.length === 1) {
    words[words.length - 1] = hits[0];
    cmd.value = `${words.join(" ")} `;
  } else if (hits.length > 1) {
    print(["green", "you@home"], " ", ["cyan", "~"], " $ ", cmd.value);
    print(["muted", hits.slice(0, 40).join("  ")]);
  }
}

async function submit(line) {
  if (state.ask) {
    const resolve = state.ask;
    state.ask = null;
    print(["muted", "> "], line);
    prompt.classList.add("busy");
    prompt.querySelector(".ps").innerHTML = PS;
    resolve(/^y(es)?$/i.test(line.trim()));
    return;
  }
  print(["green", "you@home"], " ", ["cyan", "~"], " $ ", line);
  if (line.trim()) {
    state.history.push(line);
    state.hist = state.history.length;
  }
  state.busy = true;
  prompt.classList.add("busy");
  try {
    await run(line);
  } finally {
    state.busy = false;
    if (!tui.isOpen) {
      prompt.classList.remove("busy");
      cmd.focus({ preventScroll: true });
    }
    box.scrollTop = box.scrollHeight;
  }
  if (state.queue.length && !tui.isOpen) submit(state.queue.shift());
}

cmd.addEventListener("keydown", (e) => {
  if (state.busy && !state.ask) {
    if (e.key === "Enter") {
      e.preventDefault();
      state.queue.push(cmd.value);
      cmd.value = "";
    }
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    const line = cmd.value;
    cmd.value = "";
    submit(line);
  } else if (e.key === "Tab") {
    e.preventDefault();
    complete();
  } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    e.preventDefault();
    state.hist = Math.max(0, Math.min(state.history.length, state.hist + (e.key === "ArrowUp" ? -1 : 1)));
    cmd.value = state.history[state.hist] ?? "";
  } else if (e.key === "l" && e.ctrlKey) {
    e.preventDefault();
    out.replaceChildren();
  }
});

screen.addEventListener("click", () => {
  if (getSelection().toString()) return;
  if (tui.isOpen) screen.focus({ preventScroll: true });
  else cmd.focus({ preventScroll: true });
});

function welcome() {
  print(["accent bold", "◆ self-host"], ["muted", ` playground · v${VERSION} · simulated in your browser`]);
  print(["muted", "Nothing here touches a real machine. The catalog is the real one."]);
  print("");
  print("Try ", ["cyan", "self-host install media"], ", then ", ["cyan", "self-host"], " to open the Dashboard. ", ["muted", "help lists everything."]);
  print("");
}

export const shell = {
  print,
  get busy() {
    return state.busy;
  },
  get asking() {
    return state.ask !== null;
  },
  submit,
  async type(line, delay = 22) {
    $("#play").scrollIntoView({ block: "start", behavior: "instant" });
    if (tui.isOpen) tui.close();
    if (state.busy) return false;
    cmd.value = "";
    for (const ch of line) {
      cmd.value += ch;
      await sleep(delay);
    }
    return true;
  },
  async run(line) {
    if (!(await shell.type(line))) return;
    cmd.value = "";
    await submit(line);
  },
  async prefill(line) {
    if (await shell.type(line, 12)) cmd.focus({ preventScroll: true });
  },
  async answer(text) {
    cmd.value = text;
    await sleep(300);
    cmd.value = "";
    await submit(text);
  },
  reset() {
    project.reset();
    out.replaceChildren();
    if (tui.isOpen) tui.close();
    welcome();
  },
  welcome,
};
