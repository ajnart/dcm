import { execFileSync } from "node:child_process";
import catalog from "./catalog.json";

function latestVersion(): string {
  if (process.env.SELF_HOST_SITE_VERSION) return process.env.SELF_HOST_SITE_VERSION;
  try {
    const legacy = ["v1.0.0", "v1.1.1", "v1.1.2"].flatMap((tag) => ["--exclude", tag]);
    const tag = execFileSync("git", ["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*.[0-9]*.[0-9]*", ...legacy], { encoding: "utf8" });
    return tag.trim().replace(/^v/, "");
  } catch {
    return "dev";
  }
}

export const VERSION = latestVersion();
export const APPS = catalog.apps;
export const RECIPES = catalog.recipes;
export const LINK_COUNT = APPS.reduce((n, a) => n + a.l.length, 0);
export const INSTALL = "curl -fsSL https://self-host.fyi/install | bash";
export const REPO = "https://github.com/ajnart/selfhost-skills";
export const AGENT_PROMPT = "Install the self-host skill from github.com/ajnart/selfhost-skills and help me run my own movie server.";
