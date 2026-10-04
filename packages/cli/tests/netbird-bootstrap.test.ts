import assert from "node:assert/strict";
import adapter from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/netbird/setup.ts";
import { compileNetbirdConfiguration } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/netbird/configuration.ts";
import { netbirdFirstOwnerRequest, netbirdFirstOwnerResponse, netbirdOwnerLoginRequest,
  netbirdOwnerPasswordRequest, netbirdOwnerTokenRequest, netbirdOwnerTokenResponse,
  netbirdOwnerReadbackRequests, netbirdOwnerReadback, netbirdSetupPatReadback } from "../../../.agents/skills/self-host/workflows/selfhost/references/catalog/apps/netbird/bootstrap.ts";

const input = { instance: { setup_required: true }, attempted: false, email: "owner@example.test", password: "fixture-password-not-live", setupPatEnabled: true };
const request = netbirdFirstOwnerRequest(input);
const body = JSON.parse(request.body as string);
assert.deepEqual(request, netbirdFirstOwnerRequest(input));
assert.equal(request.path, "/api/setup");
assert.equal(body.create_pat, true);
assert.equal(body.pat_expire_in, 1);
assert.equal(body.password, input.password);
assert.equal(body.name, input.email);
assert.equal(JSON.parse(netbirdFirstOwnerRequest({ ...input, setupPatEnabled: false }).body as string).create_pat, undefined);
assert.throws(() => netbirdFirstOwnerRequest({ ...input, attempted: true }), /without replaying/);
assert.throws(() => netbirdFirstOwnerRequest({ ...input, instance: { setup_required: false } }), /already has an owner/);
for (const instance of [null, {}, [], { setup_required: "true" }]) assert.throws(() => netbirdFirstOwnerRequest({ ...input, instance }));
assert.throws(() => netbirdFirstOwnerRequest({ ...input, password: "short" }));
assert.throws(() => netbirdFirstOwnerRequest({ ...input, password: "a".repeat(73) }));
assert.throws(() => netbirdFirstOwnerRequest({ ...input, password: "é".repeat(37) }));
assert.throws(() => netbirdFirstOwnerRequest({ ...input, password: "é".repeat(3) }));
for (const password of ["a".repeat(8), "a".repeat(72), "é".repeat(4), "é".repeat(36)]) {
  assert.equal(JSON.parse(netbirdFirstOwnerRequest({ ...input, password }).body as string).password, password);
}
assert.throws(() => netbirdFirstOwnerRequest({ ...input, password: null } as any));
assert.throws(() => netbirdFirstOwnerRequest({ ...input, email: "not-an-email" }));
const response = { user_id: "fixture-owner-id", email: input.email, personal_access_token: "fixture-token-not-live" };
assert.deepEqual(netbirdFirstOwnerResponse(response, input.email, true), { userId: response.user_id, email: input.email, personalAccessToken: response.personal_access_token });
assert.throws(() => netbirdFirstOwnerResponse({ ...response, email: "other@example.test" }, input.email, true));
assert.throws(() => netbirdFirstOwnerResponse({ ...response, personal_access_token: undefined }, input.email, true), /do not replay/);
assert.throws(() => netbirdFirstOwnerResponse(response, input.email, false), /unexpected setup PAT/);
assert.deepEqual(netbirdFirstOwnerResponse({ user_id: response.user_id, email: input.email }, input.email, false), { userId: response.user_id, email: input.email, personalAccessToken: null });
assert.throws(() => netbirdFirstOwnerResponse({ ...response, personal_access_token: "fixture\nvalue" }, input.email, true));
assert.throws(() => netbirdFirstOwnerResponse({ ...response, user_id: "" }, input.email, true));
const flow = { canonicalOrigin: "https://netbird.example.test", state: "s".repeat(43), nonce: "n".repeat(43), verifier: "v".repeat(43) };
const start = netbirdOwnerLoginRequest(flow);
assert.deepEqual(start, netbirdOwnerLoginRequest(flow));
const authorization = new URL(start.path, flow.canonicalOrigin);
assert.equal(authorization.pathname, "/oauth2/auth/local");
assert.equal(authorization.searchParams.get("prompt"), "login");
assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
assert.equal(authorization.searchParams.get("scope"), "openid profile email");
assert.equal(authorization.searchParams.get("code_challenge"), "7w_YNF9DSfIdPf_pRjSq646_kPr-2-o9NAl16JGghdM");
assert.equal(authorization.searchParams.has("password"), false);
const passwordInput = { ...flow, status: 302, location: "/oauth2/auth/local/login?state=fixture-request&back=ignored", email: input.email, password: input.password };
const password = netbirdOwnerPasswordRequest(passwordInput);
assert.equal(password.path, "/oauth2/auth/local/login?state=fixture-request");
assert.equal(new URLSearchParams(password.body as string).get("login"), input.email);
assert.equal(new URLSearchParams(password.body as string).get("password"), input.password);
assert.throws(() => netbirdOwnerPasswordRequest({ ...passwordInput, location: "https://other.example.test/oauth2/auth/local/login?state=fixture" }));
assert.throws(() => netbirdOwnerPasswordRequest({ ...passwordInput, location: "/oauth2/auth/local/login?state=a&state=b" }));
assert.throws(() => netbirdOwnerPasswordRequest({ ...passwordInput, status: 200 }));
assert.throws(() => netbirdOwnerPasswordRequest({ ...passwordInput, location: "/oauth2/auth/external/login?state=fixture" }));
const callback = { ...flow, status: 303, location: `${flow.canonicalOrigin}/nb-auth?code=fixture-code&state=${flow.state}` };
const exchange = netbirdOwnerTokenRequest(callback);
assert.equal(exchange.path, "/oauth2/token");
assert.equal(new URLSearchParams(exchange.body as string).get("grant_type"), "authorization_code");
assert.equal(new URLSearchParams(exchange.body as string).get("code_verifier"), flow.verifier);
for (const location of ["/nb-auth?state=wrong&code=fixture", "/nb-auth?state=" + flow.state + "&error=login_required", "/oauth2/auth/local/mfa?state=fixture", callback.location + "&code=other", callback.location + "#fragment"]) {
  assert.throws(() => netbirdOwnerTokenRequest({ ...callback, location }));
}
for (const invalid of [{ state: "short" }, { verifier: "short" }, { canonicalOrigin: "http://netbird.example.test" }, { canonicalOrigin: "https://netbird.example.test/path" }, { canonicalOrigin: "https://netbird.example.test:0" }]) {
  assert.throws(() => netbirdOwnerLoginRequest({ ...flow, ...invalid }));
}
for (const canonicalOrigin of ["https://netbird.localhost:4443", "https://netbird.example.test:8443"]) {
  const privateFlow = { ...flow, canonicalOrigin };
  const privateAuthorization = netbirdOwnerLoginRequest(privateFlow);
  assert.equal(new URL(privateAuthorization.path, canonicalOrigin).searchParams.get("redirect_uri"), `${canonicalOrigin}/nb-auth`);
  const privateCallback = { ...privateFlow, status: 303, location: `${canonicalOrigin}/nb-auth?code=fixture-code&state=${flow.state}` };
  assert.equal(new URLSearchParams(netbirdOwnerTokenRequest(privateCallback).body as string).get("redirect_uri"), `${canonicalOrigin}/nb-auth`);
  assert.throws(() => netbirdOwnerTokenRequest({ ...privateCallback,
    location: `https://netbird.example.test/nb-auth?code=fixture-code&state=${flow.state}` }),
    "callback origin must retain the configured hostname and HTTPS port");
}
assert.deepEqual(netbirdOwnerTokenResponse({ token_type: "bearer", access_token: "fixture.payload.signature", expires_in: 3600 }), { accessToken: "fixture.payload.signature", expiresIn: 3600 });
for (const invalid of [{ token_type: "Token" }, { expires_in: 0 }, { access_token: "opaque" }, { access_token: "fixture.payload.signature\n" }]) {
  assert.throws(() => netbirdOwnerTokenResponse({ token_type: "bearer", access_token: "fixture.payload.signature", expires_in: 3600, ...invalid }));
}
const owner = { id: "fixture+owner/id", email: input.email, role: "owner", status: "active", is_current: true, is_blocked: false, is_service_user: false, pending_approval: false, idp_id: "local" };
assert.equal(netbirdOwnerReadback(owner, { email: input.email }).userId, owner.id);
for (const invalid of [{ role: "admin" }, { is_blocked: true }, { is_current: false }, { idp_id: "external" }, { pending_approval: true }, { email: "other@example.test" }]) {
  assert.throws(() => netbirdOwnerReadback({ ...owner, ...invalid }, { email: input.email }));
}
assert.throws(() => netbirdOwnerReadback(owner, { email: input.email, userId: "other" }));
for (const authorization of ["Bearer", "Token"] as const) {
  const reads = netbirdOwnerReadbackRequests({ authorization, token: "fixture-token-not-live", userId: owner.id });
  assert.equal(reads[0].path, "/api/users/current");
  assert.equal(reads[1].path, "/api/users/fixture%2Bowner%2Fid/tokens");
  assert.equal(reads[0].headers.Authorization, authorization + " fixture-token-not-live");
}
assert.throws(() => netbirdOwnerReadbackRequests({ authorization: "Token", token: "fixture\n", userId: owner.id }));
const createdAt = "2026-10-03T12:00:00Z";
const pat = { id: "fixture-pat-id", name: "setup-token", created_by: owner.id, created_at: createdAt, expiration_date: "2026-10-04T12:00:00Z" };
const window = { userId: owner.id, attemptedAt: Date.parse(createdAt) - 1000, completedAt: Date.parse(createdAt) + 1000, now: Date.parse(createdAt) + 2000 };
assert.equal(netbirdSetupPatReadback([pat], window).secretRecoverable, false);
assert.equal(netbirdSetupPatReadback([pat], window).scope, "inherits-owner-permissions");
for (const value of [[], [pat, pat], [{ ...pat, created_by: "other" }], [{ ...pat, expiration_date: createdAt }], [{ ...pat, expiration_date: "2026-11-03T12:00:00Z" }], [{ ...pat, created_at: "2026-10-02T12:00:00Z" }], [{ ...pat, expiration_date: "nonsense" }]]) {
  assert.throws(() => netbirdSetupPatReadback(value, window));
}
assert.throws(() => netbirdSetupPatReadback([pat], { ...window, tokenId: "other" }));
assert.throws(() => netbirdSetupPatReadback([pat], { ...window, now: Date.parse(pat.expiration_date) }));
assert.throws(() => netbirdSetupPatReadback([pat], { ...window, completedAt: window.attemptedAt - 1 }));
// Inspection can prove the retained PAT/owner, never a password from historical state.
const compiled = compileNetbirdConfiguration({ canonicalOrigin: flow.canonicalOrigin,
  trustedProxyAddress: "127.0.0.1", ownerEmail: input.email });
const bindingHash = "a".repeat(64);
const now = Date.now();
const currentPat = { ...pat, created_at: new Date(now - 1000).toISOString(),
  expiration_date: new Date(now - 1000 + 86400000).toISOString() };
let checkpoint: any = { appId: "netbird", projectRoot: "/fixture-netbird", revision: 1,
  stage: "owner-login-verified", attemptedActions: ["netbird-create-first-owner"],
  data: { selectionFingerprint: compiled.selectionFingerprint, bindingHash, userId: owner.id,
    attemptedAt: now - 2000, completedAt: now, passwordLoginVerified: true } };
let session: any = null;
let cookies: Record<string, string> = {};
let loginState = "";
let passwordAccepted = false;
let passwordRequests = 0;
const context: any = { appId: "netbird", projectRoot: "/fixture-netbird",
  async status() { return { command: "app status", appId: "netbird", projectRoot: context.projectRoot,
    status: "applied", mutation: false, runtime: { state: "running" }, ownerKind: "shared",
    setupUrl: flow.canonicalOrigin, selectionFingerprint: compiled.selectionFingerprint,
    derivedRecipe: { appId: "netbird", bindingHash, configurationFilesVerified: true,
      selectionFingerprint: compiled.selectionFingerprint,
      input: { appId: "netbird", inputs: { "canonical-origin": flow.canonicalOrigin,
        "trusted-proxy-address": "127.0.0.1", "owner-email": input.email } },
      configuration: { ...compiled.requirements, ownerEmail: input.email,
        selectionFingerprint: compiled.selectionFingerprint } } }; },
  checkpoint: { async read() { return structuredClone(checkpoint); }, async compareAndSet(value: any) {
    assert.equal(value.expectedRevision, checkpoint.revision);
    checkpoint = { ...checkpoint, revision: checkpoint.revision + 1, stage: value.stage, data: value.data };
    return structuredClone(checkpoint);
  } },
  secrets: { async readApiKey() { return response.personal_access_token; },
    async apiKeyPath() { return "/fixture-netbird/retained-pat"; },
    async readAdminPassword() { return input.password; },
    async readSetupSession() { return session; }, async writeSetupSession(value: any) { session = value; },
    async readSessionCookies() { return cookies; }, async writeSessionCookies(value: any) { cookies = value; } },
  http: { async request(value: any) {
    if (value.path === "/api/users/current") return Response.json(owner);
    if (value.path === `/api/users/${encodeURIComponent(owner.id)}/tokens`) return Response.json([currentPat]);
    if (value.path === "/api/instance") return Response.json({ setup_required: false });
    assert(value.approval && value.beforeSendCheckpoint);
    checkpoint.attemptedActions.push(value.approval.action);
    if (value.path === "/oauth2/auth/local") {
      loginState = value.query.state;
      return new Response(null, { status: 302, headers: { location: "/oauth2/auth/local/login?state=fixture-request" } });
    }
    if (value.path === "/oauth2/auth/local/login") {
      passwordRequests++;
      assert.equal(new URLSearchParams(value.body).get("password"), input.password);
      if (!passwordAccepted) return new Response("rejected password", { status: 200 });
      return new Response(null, { status: 303, headers: {
        location: `${flow.canonicalOrigin}/nb-auth?code=fixture-code&state=${loginState}` } });
    }
    assert.equal(value.path, "/oauth2/token");
    return Response.json({ token_type: "bearer", access_token: "fixture.payload.signature", expires_in: 3600 });
  } } };
const retainedCheckpoint = structuredClone(checkpoint);
const inspected = await adapter.inspect!(context);
assert.equal(inspected.passwordLoginVerified, false);
assert.equal(inspected.ownerIdentityVerified, true);
assert.equal(inspected.patVerified, true);
assert.equal(adapter.ready(inspected), false);
assert.deepEqual(checkpoint, retainedCheckpoint);
assert.equal(passwordRequests, 0, "Read-only inspection must not submit a password");
await assert.rejects(adapter.firstRun(context), /expected redirect/);
assert.equal(checkpoint.data.passwordLoginVerified, true, "Historical state is retained, not treated as current proof");
assert.equal((await adapter.inspect!(context)).passwordLoginVerified, false);
passwordAccepted = true;
const freshlyVerified = await adapter.firstRun(context);
assert.equal(freshlyVerified.passwordLoginVerified, true);
assert.equal(adapter.ready(freshlyVerified), true);
assert.equal(passwordRequests, 2);
assert.equal((await adapter.inspect!(context)).passwordLoginVerified, false);
assert.equal(await context.secrets.readApiKey(), response.personal_access_token);
console.log("NetBird bootstrap, private password-login wire contract and current-vs-historical verification fixture passed (no runtime acceptance)");
