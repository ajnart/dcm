import { execFileSync } from "node:child_process";

export const REPO = "ajnart/self-host";

type Release = { tag_name: string; draft: boolean; prerelease: boolean; assets: { name: string }[] };

const semver = /^(?:new-cli-)?v(\d+)\.(\d+)\.(\d+)$/;

function token(): string | undefined {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function isCLIRelease(release: Release): boolean {
  const names = release.assets.map((a) => a.name);
  return !release.draft && !release.prerelease && semver.test(release.tag_name) && names.includes("checksums.txt") && names.some((n) => n.startsWith("self-host_"));
}

function parts(tag: string): number[] {
  return (semver.exec(tag) ?? []).slice(1).map(Number);
}

function newer(a: string, b: string): boolean {
  const [x, y] = [parts(a), parts(b)];
  const i = x.findIndex((n, k) => n !== y[k]);
  return i >= 0 && x[i] > y[i];
}

async function fromGitHub(): Promise<string | undefined> {
  const auth = token();
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`, {
    headers: { Accept: "application/vnd.github+json", ...(auth && { Authorization: `Bearer ${auth}` }) },
  });
  if (!res.ok) return undefined;
  const releases = ((await res.json()) as Release[]).filter(isCLIRelease);
  let latest: Release | undefined;
  for (const release of releases) {
    if (!latest || newer(release.tag_name, latest.tag_name)) latest = release;
  }
  return latest?.tag_name.replace(/^(new-cli-)?v/, "");
}

function fromTags(): string | undefined {
  try {
    execFileSync("git", ["fetch", "--tags", "--quiet"], { stdio: "ignore" });
  } catch {}
  try {
    const tags = execFileSync("git", ["tag", "--list", "new-cli-v*"], { encoding: "utf8" }).split("\n").filter((t) => semver.test(t));
    let latest: string | undefined;
    for (const tag of tags) {
      if (!latest || newer(tag, latest)) latest = tag;
    }
    return latest?.replace(/^new-cli-v/, "");
  } catch {
    return undefined;
  }
}

export async function latestVersion(): Promise<string> {
  if (process.env.SELF_HOST_SITE_VERSION) return process.env.SELF_HOST_SITE_VERSION;
  const version = (await fromGitHub().catch(() => undefined)) ?? fromTags();
  if (version) return version;
  throw new Error(`Could not look up the latest CLI release of ${REPO}. Log in with gh, set GITHUB_TOKEN, or set SELF_HOST_SITE_VERSION.`);
}

export const VERSION = await latestVersion();
