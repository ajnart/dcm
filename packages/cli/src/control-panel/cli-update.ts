import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath, stat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

const repo = "ajnart/selfhost-skills";
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const maxAssetBytes = 100 * 1024 * 1024;

type UpdatePlan = {
  status: "available" | "unavailable" | "current";
  currentVersion: string;
  targetVersion: string | null;
  tag: string | null;
  tarball: string | null;
  expectedBytes: number | null;
  checksumAsset: "CLI-SHA256SUMS" | "SHA256SUMS" | null;
  message: string;
};

async function output(binary: string, args: string[], timeout = 30000): Promise<string> {
  return new Promise((resolveOutput, rejectOutput) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"], timeout, windowsHide: true });
    let text = "";
    let oversized = false;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (Buffer.byteLength(text) + Buffer.byteLength(chunk) > 1024 * 1024) {
        oversized = true;
        child.kill();
        return;
      }
      text += chunk;
    });
    child.stderr.resume();
    child.once("error", () => rejectOutput(new Error(`${binary} could not start`)));
    child.once("close", (code) => {
      if (oversized || code !== 0) {
        rejectOutput(new Error(`${binary} stopped; no update was confirmed`));
        return;
      }
      resolveOutput(text.trim());
    });
  });
}

function versionParts(value: string): number[] | null {
  const match = versionPattern.exec(value);
  if (!match) return null;
  const numbers = match.slice(1).map(Number);
  if (numbers.some((number) => !Number.isSafeInteger(number))) return null;
  return numbers;
}

function newer(candidate: string, installed: string): boolean {
  const left = versionParts(candidate);
  const right = versionParts(installed);
  if (!left || !right) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] > right[index]) return true;
    if (left[index] < right[index]) return false;
  }
  return false;
}

async function installedPackage(): Promise<{ root: string; version: string } | null> {
  if (process.platform === "win32" || typeof process.argv[1] !== "string") return null;
  let bin: string;
  try { bin = await realpath(process.argv[1]); }
  catch { return null; }
  if (basename(bin) !== "selfhost.mjs" || basename(dirname(bin)) !== "bin") return null;
  const root = dirname(dirname(bin));
  let metadata: { name?: unknown; version?: unknown };
  try { metadata = JSON.parse(await readFile(join(root, "package.json"), "utf8")); }
  catch { return null; }
  if (metadata.name !== "@ajnart/selfhost" || typeof metadata.version !== "string"
    || !versionParts(metadata.version)) return null;
  let globalRoot: string;
  try { globalRoot = await realpath(await output("npm", ["root", "--global"], 5000)); }
  catch { return null; }
  let globalPackage: string;
  try { globalPackage = await realpath(join(globalRoot, "@ajnart", "selfhost")); }
  catch { return null; }
  if (globalPackage !== root) return null;
  return { root, version: metadata.version };
}

/** A private release must ship a packed CLI plus its matching checksum entry. */
export async function checkCliUpdate(): Promise<UpdatePlan> {
  const installed = await installedPackage();
  if (!installed) return { status: "unavailable", currentVersion: "unknown", targetVersion: null,
    tag: null, tarball: null, expectedBytes: null, checksumAsset: null,
    message: "This CLI is not the active global npm installation. Update its owner (source checkout or native binary) instead." };
  try {
    const release = JSON.parse(await output("gh", ["release", "view", "--repo", repo,
      "--json", "tagName,assets"], 5000)) as { tagName?: unknown; assets?: Array<{ name?: unknown; size?: unknown }> };
    const tag = release.tagName;
    if (typeof tag !== "string" || !/^v\d+\.\d+\.\d+$/.test(tag)
      || !Array.isArray(release.assets)) throw new Error("Private release metadata is invalid");
    const targetVersion = tag.slice(1);
    if (!newer(targetVersion, installed.version)) {
      return { status: "current", currentVersion: installed.version, targetVersion, tag,
        tarball: null, expectedBytes: null, checksumAsset: null,
        message: "The installed CLI is at or ahead of the latest private release." };
    }
    const tarball = `ajnart-selfhost-${targetVersion}.tgz`;
    const asset = release.assets.find((entry) => entry.name === tarball);
    let checksumAsset: "CLI-SHA256SUMS" | "SHA256SUMS" = "CLI-SHA256SUMS";
    let sums = release.assets.find((entry) => entry.name === checksumAsset);
    if (!sums) {
      checksumAsset = "SHA256SUMS";
      sums = release.assets.find((entry) => entry.name === checksumAsset);
    }
    if (!asset || !sums || typeof asset.size !== "number" || asset.size < 1
      || asset.size > maxAssetBytes || typeof sums.size !== "number"
      || sums.size < 1 || sums.size > 65536) {
      return { status: "unavailable", currentVersion: installed.version, targetVersion, tag,
        tarball: null, expectedBytes: null, checksumAsset: null,
        message: "A newer release exists, but it has no bounded CLI tarball and checksum pair." };
    }
    return { status: "available", currentVersion: installed.version, targetVersion, tag,
      tarball, expectedBytes: asset.size, checksumAsset,
      message: "A newer private CLI package is ready for a reviewed global update." };
  } catch {
    return { status: "unavailable", currentVersion: installed.version, targetVersion: null,
      tag: null, tarball: null, expectedBytes: null, checksumAsset: null,
      message: "The private release could not be checked. Confirm GitHub CLI access with gh auth status." };
  }
}

export async function applyCliUpdate(plan: UpdatePlan): Promise<string> {
  if (plan.status !== "available" || !plan.tag || !plan.tarball || !plan.targetVersion
    || !plan.expectedBytes || !plan.checksumAsset) {
    throw new Error("No reviewed CLI update is available");
  }
  const current = await checkCliUpdate();
  if (current.status !== "available" || current.tag !== plan.tag
    || current.tarball !== plan.tarball || current.currentVersion !== plan.currentVersion
    || current.expectedBytes !== plan.expectedBytes || current.checksumAsset !== plan.checksumAsset) {
    throw new Error("The private release changed; review the CLI update again");
  }
  const temporary = await mkdtemp(join(tmpdir(), "selfhost-cli-update-"));
  try {
    await output("gh", ["release", "download", plan.tag, "--repo", repo,
      "--pattern", plan.tarball, "--pattern", plan.checksumAsset, "--dir", temporary], 120000);
    const tarballPath = join(temporary, plan.tarball);
    const asset = await stat(tarballPath);
    if (!asset.isFile() || asset.size !== plan.expectedBytes) {
      throw new Error("The downloaded CLI package has an invalid size");
    }
    const checksumPath = join(temporary, plan.checksumAsset);
    const checksumFile = await stat(checksumPath);
    if (!checksumFile.isFile() || checksumFile.size < 1 || checksumFile.size > 65536) {
      throw new Error("The downloaded CLI checksum file has an invalid size");
    }
    const sums = await readFile(checksumPath, "utf8");
    const expected = sums.split(/\r?\n/).map((line) => /^([0-9a-f]{64})  ([^\s]+)$/.exec(line))
      .filter((match) => match?.[2] === plan.tarball);
    if (expected.length !== 1 || !expected[0]) throw new Error("The private release has no unique CLI checksum");
    const actual = createHash("sha256").update(await readFile(tarballPath)).digest("hex");
    if (actual !== expected[0][1]) throw new Error("The downloaded CLI checksum does not match the release");
    const metadata = JSON.parse(await output("tar", ["-xOzf", tarballPath, "package/package.json"])) as {
      name?: unknown; version?: unknown;
    };
    if (metadata.name !== "@ajnart/selfhost" || metadata.version !== plan.targetVersion) {
      throw new Error("The CLI package identity does not match the reviewed release");
    }
    await output("npm", ["install", "--global", "--ignore-scripts", "--no-audit", "--no-fund",
      tarballPath], 180000);
    const observed = await output(process.execPath, [process.argv[1], "--version"]);
    if (observed !== plan.targetVersion) {
      throw new Error("npm finished, but the active CLI version did not match; inspect the global npm install");
    }
    return `Updated self-host ${plan.currentVersion} → ${plan.targetVersion}. Restart this command to use the new control panel.`;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
