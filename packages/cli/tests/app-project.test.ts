import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appCommand } from "../src/app.ts";

const temporaryRoots: string[] = [];

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "selfhost-app-project-test-"));
  temporaryRoots.push(root);
  return root;
}

async function seedApplied(root: string): Promise<void> {
  const directory = join(root, ".selfhost", "app-state");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const projectId = "selfhost-uptime-kuma";
  const image = `louislam/uptime-kuma:2@sha256:${"0".repeat(64)}`;
  const dataDirectory = join(root, ".selfhost", "app-data", "uptime-kuma");
  const state = { schemaVersion: 1, appId: "uptime-kuma", recipeSha256: "0".repeat(64),
    approval: `APP-APPLY:uptime-kuma:${"0".repeat(64)}`, image, port: 3001,
    projectRoot: root, dockerContext: "rootless", projectId,
    composeTarget: join(root, ".selfhost", "apps", projectId, "compose.0123456789abcdef.yaml"),
    dataDirectory, stage: "applied", manifest: {
      project: { id: projectId, dockerContext: "rootless" },
      services: [{ image, ports: [{ published: 3001 }], mounts: [{ source: dataDirectory }] }],
      networks: [{ name: `${projectId}-private` }],
    } };
  await writeFile(join(directory, "uptime-kuma.json"), JSON.stringify(state), { mode: 0o600, flag: "wx" });
}

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true });
});

test("status distinguishes absent project state from a deployed app", async () => {
  const root = await project();
  const output: string[] = [];
  const original = console.log;
  console.log = (value: string) => output.push(value);
  try {
    await appCommand(["status", "--id", "uptime-kuma", "--project-root", root, "--json"]);
  } finally {
    console.log = original;
  }
  const result = JSON.parse(output.join("\n"));
  expect(result.status).toBe("not-initialized");
  expect(result.mutation).toBe(false);
  expect(result.containerHealth).toBe("not-checked");
  expect(result.acceptanceVerified).toBe(false);
});

test("multi-service status exposes exact resume approval without claiming acceptance", async () => {
  const root = await project();
  const directory = join(root, ".selfhost", "app-state");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const suffix = createHash("sha256").update("paperless-ngx").update("\0").update(root)
    .digest("hex").slice(0, 16);
  const projectId = `selfhost-paperless-ngx-${suffix}`;
  const images = Object.fromEntries(["paperless-ngx", "broker", "db"].map((id) => [id,
    `example.invalid/${id}:1@sha256:${"0".repeat(64)}`]));
  const state = { schemaVersion: 2, appId: "paperless-ngx", recipeSha256: "0".repeat(64),
    approval: `APP-APPLY:paperless-ngx:${"0".repeat(64)}`, images, port: 18000,
    uid: process.getuid(), gid: process.getgid(), projectRoot: root,
    dockerContext: "default", projectId,
    composeTarget: join(root, ".selfhost", "apps", projectId, "compose.0123456789abcdef.yaml"),
    dataDirectory: join(root, ".selfhost", "app-data", "paperless-ngx"), stage: "rendered",
    onboarding: { kind: "initial-admin-from-file", officialUrl: "https://docs.paperless-ngx.com/configuration/",
      username: "admin", usernameEnvironment: "PAPERLESS_ADMIN_USER",
      fileEnvironment: "PAPERLESS_ADMIN_PASSWORD_FILE", fileId: "admin-password" },
    manifest: { project: { id: projectId, dockerContext: "default",
      directory: join(root, ".selfhost", "apps", projectId) },
    services: Object.entries(images).map(([id, image]) => ({ id, image,
      environment: id === "paperless-ngx" ? [
        { name: "PAPERLESS_ADMIN_USER", value: "admin" },
        { name: "PAPERLESS_ADMIN_PASSWORD_FILE", value: "/run/secrets/admin-password" },
      ] : [],
      secretRefs: id === "paperless-ngx" ? [{ name: "admin-password",
        filePath: join(root, ".selfhost", "apps", projectId, "secrets", "admin-password") }] : [] })),
    networks: [{ name: `${projectId}-private` }] } };
  await writeFile(join(directory, "paperless-ngx.json"), JSON.stringify(state), { mode: 0o600, flag: "wx" });
  const output: string[] = [];
  const original = console.log;
  console.log = (value: string) => output.push(value);
  try {
    await appCommand(["status", "--id", "paperless-ngx", "--project-root", root, "--json"]);
  } finally {
    console.log = original;
  }
  const result = JSON.parse(output.join("\n"));
  expect(result.status).toBe("rendered");
  expect(result.approvals.resume).toBe(state.approval);
  expect(result.acceptanceVerified).toBe(false);
  await expect(appCommand(["account-plan", "--id", "paperless-ngx", "--project-root", root]))
    .rejects.toThrow("multi-service initial-admin credentials are generated");
  const passwordPath = join(root, ".selfhost", "apps", projectId, "secrets", "admin-password");
  await mkdir(join(root, ".selfhost", "apps", projectId, "secrets"), { recursive: true, mode: 0o700 });
  await writeFile(passwordPath, "a".repeat(64), { mode: 0o600, flag: "wx" });
  await writeFile(join(directory, "paperless-ngx.json"), JSON.stringify({ ...state, stage: "applied" }));
  const handoff: string[] = [];
  console.log = (value: string) => handoff.push(value);
  try {
    await appCommand(["handoff", "--id", "paperless-ngx", "--project-root", root, "--json"]);
    await appCommand(["handoff", "--id", "paperless-ngx", "--project-root", root, "--show", "--json"]);
  } finally {
    console.log = original;
  }
  expect(JSON.parse(handoff[0]).secretful).toBe(false);
  expect(JSON.parse(handoff[0]).passwordFile).toBe(passwordPath);
  expect(JSON.parse(handoff[1]).env).toContain("PAPERLESS_NGX_USERNAME=admin\n");
  expect(JSON.parse(handoff[1]).env).toContain(`PAPERLESS_NGX_PASSWORD=${"a".repeat(64)}\n`);
});

test("resume refuses an absent checkpoint before invoking Docker", async () => {
  const root = await project();
  await expect(appCommand(["resume", "--id", "uptime-kuma", "--project-root", root,
    "--approve", `APP-APPLY:uptime-kuma:${"0".repeat(64)}`])).rejects.toThrow("no saved app apply");
});

test("apply needs an exact approval before observing or changing the host", async () => {
  const root = await project();
  await expect(appCommand(["apply", "--id", "uptime-kuma", "--project-root", root,
    "--image", `louislam/uptime-kuma:2@sha256:${"0".repeat(64)}`, "--port", "3001"]))
    .rejects.toThrow("requires --approve");
});

test("image resolution is plan-only and cannot be mixed with pinned images", async () => {
  const root = await project();
  await expect(appCommand(["plan", "--id", "uptime-kuma", "--project-root", root,
    "--resolve-images", "--image", `louislam/uptime-kuma:2@sha256:${"0".repeat(64)}`,
    "--port", "3001"])).rejects.toThrow("only for app plan without explicit --image");
  await expect(appCommand(["apply", "--id", "uptime-kuma", "--project-root", root,
    "--resolve-images", "--port", "3001", "--approve", "invalid"]))
    .rejects.toThrow("only for app plan without explicit --image");
});

test("status refuses a symlinked project root", async () => {
  const root = await project();
  const linked = `${root}-link`;
  temporaryRoots.push(linked);
  await symlink(root, linked);
  await expect(appCommand(["status", "--id", "uptime-kuma", "--project-root", linked]))
    .rejects.toThrow("project root must be a real");
});

test("up and down approvals are distinct and reject cross-action replay before Docker", async () => {
  const root = await project();
  await seedApplied(root);
  const output: string[] = [];
  const original = console.log;
  console.log = (value: string) => output.push(value);
  try {
    await appCommand(["status", "--id", "uptime-kuma", "--project-root", root, "--json"]);
  } finally {
    console.log = original;
  }
  const status = JSON.parse(output.join("\n"));
  expect(status.status).toBe("applied");
  expect(status.approvals.up).toStartWith("APP-UP:uptime-kuma:");
  expect(status.approvals.down).toStartWith("APP-DOWN:uptime-kuma:");
  expect(status.approvals.up).not.toBe(status.approvals.down);
  await expect(appCommand(["up", "--id", "uptime-kuma", "--project-root", root,
    "--approve", status.approvals.down])).rejects.toThrow("exact separately reviewed status approval");
  await expect(appCommand(["down", "--id", "uptime-kuma", "--project-root", root,
    "--approve", status.approvals.up])).rejects.toThrow("exact separately reviewed status approval");
});

test("account preparation writes one owner-only reference and is idempotent", async () => {
  const root = await project();
  await seedApplied(root);
  const output: string[] = [];
  const original = console.log;
  console.log = (value: string) => output.push(value);
  try {
    await appCommand(["account-plan", "--id", "uptime-kuma", "--project-root", root,
      "--username", "admin", "--json"]);
  } finally {
    console.log = original;
  }
  const plan = JSON.parse(output.join("\n"));
  expect(plan.status).toBe("ready-for-review");
  expect(plan.mutation).toBe(false);
  const prepare: string[] = [];
  console.log = (value: string) => prepare.push(value);
  try {
    await appCommand(["account-prepare", "--id", "uptime-kuma", "--project-root", root,
      "--username", "admin", "--approve", plan.approval, "--json"]);
  } finally {
    console.log = original;
  }
  const first = JSON.parse(prepare.join("\n"));
  expect(first.status).toBe("prepared-not-account-verified");
  expect(first.accountVerified).toBe(false);
  const metadata = await lstat(first.credentialFile);
  expect(metadata.isFile()).toBe(true);
  expect(metadata.mode & 0o077).toBe(0);
  const repeated: string[] = [];
  console.log = (value: string) => repeated.push(value);
  try {
    await appCommand(["account-prepare", "--id", "uptime-kuma", "--project-root", root,
      "--username", "admin", "--approve", plan.approval, "--json"]);
  } finally {
    console.log = original;
  }
  expect(JSON.parse(repeated.join("\n")).status).toBe("already-prepared");
  expect((await lstat(first.credentialFile)).ino).toBe(metadata.ino);
  const handoff: string[] = [];
  console.log = (value: string) => handoff.push(value);
  try {
    await appCommand(["handoff", "--id", "uptime-kuma", "--project-root", root, "--json"]);
  } finally {
    console.log = original;
  }
  const result = JSON.parse(handoff.join("\n"));
  expect(result.credentialFile).toBe(first.credentialFile);
  expect(result.secretful).toBe(false);
  expect(result.env).toBeUndefined();
  const revealed: string[] = [];
  console.log = (value: string) => revealed.push(value);
  try {
    await appCommand(["handoff", "--id", "uptime-kuma", "--project-root", root,
      "--show", "--json"]);
  } finally {
    console.log = original;
  }
  const secretful = JSON.parse(revealed.join("\n"));
  expect(secretful.secretful).toBe(true);
  expect(secretful.env).toContain("UPTIME_KUMA_USERNAME=admin");
  expect(secretful.env).toContain("UPTIME_KUMA_PASSWORD=");
});
