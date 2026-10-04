import { isAbsolute } from "node:path";
import { appliedStatus, type SetupAdapter, type SetupContext, type SetupRecord } from "../../types/setup";

const APP_ID = "speedtest-tracker";
const EMAIL = "admin@example.test";
const ATTEMPT = "speedtest-tracker-create-token";

// The pinned LinuxServer image installs this Laravel app at /app/www. The password is
// supplied through private stdin, never PHP argv or a container environment variable.
const BOOT = "require '/app/www/vendor/autoload.php'; $app=require '/app/www/bootstrap/app.php'; $app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap();";
const ADMIN = "$p=stream_get_contents(STDIN); $u=App\\Models\\User::where('email','admin@example.test')->first(); if (!$u || !$u->is_admin || !Illuminate\\Support\\Facades\\Hash::check($p,$u->password)) exit(21);";
const READ = BOOT + ADMIN
  + "$n=$u->tokens()->where('name','selfhost-managed')->count(); echo json_encode(['id'=>$u->id,'tokens'=>$n]);";
const CREATE = BOOT + ADMIN
  + "if ($u->tokens()->where('name','selfhost-managed')->exists()) exit(22); "
  + "$t=$u->createToken('selfhost-managed',['results:read']); echo $t->plainTextToken;";
const VERIFY = BOOT
  + "$x=json_decode(stream_get_contents(STDIN),true); if (!is_array($x)) exit(20); "
  + "$u=App\\Models\\User::where('email','admin@example.test')->first(); "
  + "if (!$u || !$u->is_admin || !Illuminate\\Support\\Facades\\Hash::check($x['password']??'', $u->password)) exit(21); "
  + "$t=Laravel\\Sanctum\\PersonalAccessToken::findToken($x['token']??''); "
  + "if (!$t || $t->tokenable_type!==App\\Models\\User::class || $t->tokenable_id!==$u->id || $t->name!=='selfhost-managed' || $t->abilities!==['results:read'] || ($t->expires_at && $t->expires_at->isPast())) exit(23); echo $u->id;";

function exactStatus(context: SetupContext, value: unknown): SetupRecord {
  const status = appliedStatus(context, value);
  if (status.ownerKind !== "shared" || status.username !== EMAIL
    || typeof status.passwordFile !== "string" || !isAbsolute(status.passwordFile)
    || typeof status.url !== "string" || !/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(status.url)) {
    throw new Error("Speedtest Tracker has no exact running, private seeded administrator");
  }
  return status;
}

async function admin(context: SetupContext, password: string): Promise<number> {
  const result = await context.container.exec({ effect: "read", argv: ["s6-setuidgid", "abc", "php", "-r", READ], stdin: password,
    approval: { action: "speedtest-tracker-verify-admin", progress: "Verify the seeded Speedtest Tracker administrator in the exact owned container" } });
  if (result.exitCode !== 0) throw new Error("Speedtest Tracker saved administrator password or role did not verify");
  let value: unknown;
  try { value = JSON.parse(result.stdout); } catch { throw new Error("Speedtest Tracker administrator readback is invalid"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Speedtest Tracker administrator readback is invalid");
  const row = value as Record<string, unknown>;
  if (!Number.isSafeInteger(row.id) || Number(row.id) < 1 || !Number.isSafeInteger(row.tokens)
    || Number(row.tokens) < 0) throw new Error("Speedtest Tracker administrator readback is invalid");
  if (row.tokens !== 0) throw new Error("Speedtest Tracker managed token already exists without a recoverable plaintext value");
  return row.id as number;
}

async function verifyToken(context: SetupContext, token: string): Promise<void> {
  if (!/^\d+\|[A-Za-z0-9]{40,128}$/.test(token)) throw new Error("Speedtest Tracker saved token format is invalid");
  const response = await context.http.request({ method: "GET", path: "/api/v1/stats",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    // Pinned Sanctum 4.3.3 records last_used_at when bearer authentication
    // succeeds. This is not a side-effect-free inspection despite using GET.
    approval: { action: "speedtest-tracker-verify-api-token",
      progress: "Verify scoped Speedtest Tracker statistics access and record the token's usage timestamp" } });
  if (response.status !== 200 || !response.ok) throw new Error("Speedtest Tracker token could not read statistics");
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new Error("Speedtest Tracker statistics readback is invalid"); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
    || !("data" in payload) || !("message" in payload)) {
    throw new Error("Speedtest Tracker statistics readback is invalid");
  }
}

async function verifyOwnership(context: SetupContext, password: string, token: string): Promise<number> {
  const result = await context.container.exec({ effect: "read",
    argv: ["s6-setuidgid", "abc", "php", "-r", VERIFY],
    stdin: JSON.stringify({ password, token }),
    approval: { action: "speedtest-tracker-verify-token-owner",
      progress: "Verify the saved scoped token belongs to the seeded Speedtest Tracker administrator" } });
  const ownerId = Number(result.stdout.trim());
  if (result.exitCode !== 0 || !/^\d+$/.test(result.stdout.trim()) || !Number.isSafeInteger(ownerId) || ownerId < 1) {
    throw new Error("Speedtest Tracker saved token did not belong to the seeded administrator");
  }
  return ownerId;
}

const adapter: SetupAdapter = {
  appId: APP_ID, sharedOwner: true, credentialCommand: "app handoff",
  apiKey: "saved-by-onboarding", healthSource: null, homarrIntegration: "speedtestTracker",
  ready(record) {
    return record.appId === APP_ID && record.stage === "admin-and-api-token-verified"
      && record.adminEmail === EMAIL && typeof record.credentialRef === "string"
      && isAbsolute(record.credentialRef) && typeof record.apiKeyFile === "string"
      && isAbsolute(record.apiKeyFile);
  },
  async firstRun(context) {
    if (context.appId !== APP_ID) throw new Error("Speedtest Tracker setup received a different app ID");
    const status = exactStatus(context, await context.status());
    const prior = await context.checkpoint.read();
    if (prior && (prior.appId !== APP_ID || prior.projectRoot !== context.projectRoot
      || !["token-create-attempted", "token-verified"].includes(prior.stage)
      || !prior.attemptedActions.includes(ATTEMPT)
      || prior.data.passwordFile !== status.passwordFile
      || !Number.isSafeInteger(prior.data.userId) || Number(prior.data.userId) < 1)) {
      throw new Error("Speedtest Tracker token checkpoint differs from the exact seeded administrator");
    }
    const saved = await context.secrets.readApiKey();
    if (saved !== null) {
      if (!prior) throw new Error("Speedtest Tracker saved token has no matching creation checkpoint; refuse adoption");
      if (!/^\d+\|[A-Za-z0-9]{40,128}$/.test(saved)) throw new Error("Speedtest Tracker saved token format is invalid");
      const path = await context.secrets.apiKeyPath();
      if (path === null || !isAbsolute(path)) throw new Error("Speedtest Tracker has no saved token file");
      const password = await context.secrets.readAdminPassword();
      const ownerId = await verifyOwnership(context, password, saved);
      if (ownerId !== prior.data.userId || (prior.stage === "token-verified" && prior.data.apiKeyRef !== path)) {
        throw new Error("Speedtest Tracker saved token differs from its checkpoint owner or file");
      }
      await verifyToken(context, saved);
      if (prior.stage !== "token-verified") {
        await context.checkpoint.compareAndSet({ expectedRevision: prior.revision, stage: "token-verified",
          data: { ...prior.data, apiKeyRef: path } });
      }
      return { appId: APP_ID, projectRoot: context.projectRoot, stage: "admin-and-api-token-verified",
        adminEmail: EMAIL, credentialRef: status.passwordFile, apiKeyFile: path };
    }
    if (prior !== null) throw new Error("Speedtest Tracker token attempt is unresolved; inspect privately before any retry");
    const password = await context.secrets.readAdminPassword();
    if (!/^[A-Za-z0-9]{32,128}$/.test(password)) throw new Error("Speedtest Tracker saved password is invalid");
    const userId = await admin(context, password);
    const result = await context.container.exec({ effect: "write", argv: ["s6-setuidgid", "abc", "php", "-r", CREATE], stdin: password,
      approval: { action: ATTEMPT, progress: "Create one scoped Speedtest Tracker token for the verified seeded administrator", once: true },
      beforeSendCheckpoint: { expectedRevision: null, stage: "token-create-attempted", data: { userId, passwordFile: status.passwordFile as string } } });
    if (result.exitCode !== 0 || !/^\d+\|[A-Za-z0-9]{40,128}$/.test(result.stdout.trim())) {
      throw new Error("Speedtest Tracker token creation outcome is unresolved; do not retry automatically");
    }
    const token = result.stdout.trim();
    const path = await context.secrets.writeApiKey(token);
    const ownerId = await verifyOwnership(context, password, token);
    const attempted = await context.checkpoint.read();
    if (!attempted || attempted.stage !== "token-create-attempted"
      || !attempted.attemptedActions.includes(ATTEMPT) || attempted.data.userId !== ownerId
      || attempted.data.passwordFile !== status.passwordFile) {
      throw new Error("Speedtest Tracker created token differs from its durable attempt checkpoint");
    }
    await verifyToken(context, token);
    await context.checkpoint.compareAndSet({ expectedRevision: attempted.revision, stage: "token-verified",
      data: { ...attempted.data, apiKeyRef: path } });
    return { appId: APP_ID, projectRoot: context.projectRoot, stage: "admin-and-api-token-verified",
      adminEmail: EMAIL, credentialRef: status.passwordFile, apiKeyFile: path };
  },
};

export default adapter;
