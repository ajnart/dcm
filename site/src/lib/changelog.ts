import { githubToken, REPO } from "./version";

const [owner, repo] = REPO.split("/");
const token = githubToken();
const version = /^self-host (\d+)\.(\d+)\.(\d+)$/;

export const changelog = {
  provider: "github" as const,
  base: "docs/changelog",
  title: "Changelog",
  owner,
  repo,
  token,
  enabled: Boolean(token),
  process: ({ title }: { title: string }) => version.exec(title)?.slice(1).join("."),
};

export function rank(title: string): number {
  const [major, minor, patch] = title.split(".").map(Number);
  return -(major * 1e6 + minor * 1e3 + patch);
}
