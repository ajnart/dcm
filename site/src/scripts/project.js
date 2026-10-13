import { APPS, RECIPES } from "./catalog.js";
import { sleep } from "./util.js";

export const LAN = "192.168.1.20";
export const VERSION = document.documentElement.dataset.version;
export const byId = new Map(APPS.map((a) => [a.id, a]));
export const recipeById = new Map(RECIPES.map((r) => [r.id, r]));

const apps = new Map();
const listeners = new Set();
let password = "";

const changed = () => listeners.forEach((fn) => fn());

export const urlOf = (app) => (app.port ? `http://${LAN}:${app.port}` : "no web page");

export function linksAmong(ids) {
  const set = new Set(ids);
  const links = [];
  for (const id of set) {
    const app = byId.get(id);
    app.l.forEach((to, i) => {
      if (set.has(to)) links.push({ from: id, to, title: app.lt[i] });
    });
  }
  return links;
}

export function expand(targets) {
  const ids = [];
  const unknown = [];
  for (const t of targets) {
    const recipe = recipeById.get(t);
    if (recipe) ids.push(...recipe.apps);
    else if (byId.has(t)) ids.push(t);
    else unknown.push(t);
  }
  return { ids: [...new Set(ids)], unknown };
}

function freePort(port, taken) {
  if (!port) return 0;
  while (taken.has(port)) port++;
  taken.add(port);
  return port;
}

function stepsFor(app, installed) {
  const steps = [
    ["render", `wrote apps/${app.id}/compose.yml (${app.img}${app.port ? ` on port ${app.port}` : ""})`],
    ["pull", `pulled ${app.id}`],
    ["start", `started ${app.id}`],
    ["ready", app.port ? `${app.name} answers on port ${app.port}` : `${app.name} is running`],
  ];
  if (app.id === "homarr") {
    steps.push(
      ["admin", "signed in as the administrator admin"],
      ["onboarding", "finished the Homarr board setup"],
      ["api-key", "created and stored a Homarr API key"],
      ["app-tiles", "reconciled installed App tiles"],
    );
  }
  for (const link of linksAmong(installed).filter((l) => l.from === app.id)) steps.push([`link-${link.to}`, link.title]);
  steps.push(["check", `verified ${app.name} works`]);
  return steps;
}

export const project = {
  onChange(fn) {
    listeners.add(fn);
  },
  list: () => [...apps.values()],
  get: (id) => apps.get(id),
  has: (id) => apps.has(id),
  get size() {
    return apps.size;
  },
  get password() {
    return password;
  },
  setupOf: (app) => (app.steps.some((s) => s[2] === "run") ? "running" : "done"),
  plan(targets) {
    const { ids, unknown } = expand(targets);
    const taken = new Set(project.list().map((a) => a.port));
    const fresh = ids
      .filter((id) => !apps.has(id))
      .map((id) => {
        const a = byId.get(id);
        return { id, name: a.name, category: a.c, description: a.d, url: urlOf({ port: freePort(a.p, taken) }) };
      });
    return { fresh, unknown };
  },
  async install(ids, emit) {
    const fresh = ids.filter((id) => !apps.has(id));
    if (!fresh.length) return;
    if (!password) password = makePassword();
    const installed = new Set([...apps.keys(), ...fresh]);
    const taken = new Set(project.list().map((a) => a.port));
    emit({ type: "run", msg: `install ${fresh.join(" ")}` });
    for (const id of fresh) {
      const a = byId.get(id);
      apps.set(id, { id, name: a.name, img: a.img, l: a.l, port: freePort(a.p, taken), state: "starting", steps: [] });
    }
    changed();
    for (const id of fresh) {
      const app = apps.get(id);
      for (const [step, msg] of stepsFor(app, installed)) {
        const row = [step, msg, "run"];
        app.steps.push(row);
        changed();
        await sleep(step === "pull" ? 260 : 60 + Math.random() * 90);
        row[2] = "ok";
        if (step === "start") app.state = "running";
        if (step === "pull") emit({ type: "pull", app: id, image: app.img });
        else emit({ type: "step", app: id, step, msg });
        changed();
      }
    }
    for (const link of linksAmong(installed)) {
      if (fresh.includes(link.from) || !fresh.includes(link.to)) continue;
      const app = apps.get(link.from);
      app.steps.splice(app.steps.length - 1, 0, [`link-${link.to}`, link.title, "ok"]);
      await sleep(120);
      emit({ type: "step", app: app.id, step: `link-${link.to}`, msg: link.title });
      changed();
    }
    emit({ type: "end", msg: "install: done" });
  },
  setState(id, state) {
    apps.get(id).state = state;
    changed();
  },
  remove(id) {
    apps.delete(id);
    changed();
  },
  reset() {
    apps.clear();
    password = "";
    changed();
  },
};

function makePassword() {
  const words = ["amber", "basil", "cobalt", "delta", "ember", "fjord", "garnet", "harbor", "indigo", "juniper"];
  const pick = () => words[Math.floor(Math.random() * words.length)];
  return `${pick()}-${pick()}-${Math.floor(Math.random() * 90 + 10)}`;
}
