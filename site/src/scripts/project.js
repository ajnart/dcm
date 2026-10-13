import { appById, expand, linksAmong } from "../lib/catalog";
import { sleep } from "./util.js";

export const LAN = "192.168.1.20";
export const VERSION = document.documentElement.dataset.version;
const apps = new Map();
const listeners = new Set();
let password = "";

const changed = () => listeners.forEach((fn) => fn());

export const urlOf = (app) => (app.port ? `http://${LAN}:${app.port}` : "no web page");

function freePort(port, taken) {
  if (!port) return 0;
  while (taken.has(port)) port++;
  taken.add(port);
  return port;
}

function stepsFor(app, installed) {
  const steps = [
    ["render", `wrote apps/${app.id}/compose.yml (${app.image}${app.port ? ` on port ${app.port}` : ""})`],
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
        const a = appById.get(id);
        return { id, name: a.name, category: a.category, description: a.description, url: urlOf({ port: freePort(a.port, taken) }) };
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
      const a = appById.get(id);
      apps.set(id, { id, name: a.name, image: a.image, port: freePort(a.port, taken), state: "starting", steps: [] });
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
        if (step === "pull") emit({ type: "pull", app: id, image: app.image });
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
