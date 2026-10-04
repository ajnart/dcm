#!/usr/bin/env bun

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveSessionAccess,
  SESSION_ACCESS_SERVICES,
  sessionSshTunnel,
} from "./lib/session-access.ts";
import {
  configureSessionProxyAccess,
  loadSessionAccessConfig,
  sessionAccess,
} from "./lib/session-context.ts";

const ports = {
  PROWLARR_PORT: "21000",
  RADARR_PORT: "21001",
  SONARR_PORT: "21002",
  QBITTORRENT_PORT: "21003",
  JELLYFIN_PORT: "21004",
  SEERR_PORT: "21005",
  HOMARR_PORT: "21006",
};

const local = resolveSessionAccess({ ports });
assert.equal(local.exposure, "all-host-interfaces");
assert.deepEqual(local.composeBindings, ["0.0.0.0"]);
assert.equal(local.services.homarr.browserUrl, "http://127.0.0.1:21006");
assert.equal(local.services.homarr.dockerUrl, "http://homarr:7575");
assert.equal(local.services.homarr.reachableUrl, null);
assert.equal(
  local.services.homarr.sshTunnel.command,
  "ssh -N -L <local-port>:127.0.0.1:21006 <ssh-user>@<server>",
);
assert.equal(local.services.homarr.sshTunnel.localUrl, "http://localhost:<local-port>");
const fullTunnel = sessionSshTunnel(local);
assert.match(fullTunnel.command, /<prowlarr-local-port>:127\.0\.0\.1:21000/);
assert.match(fullTunnel.command, /<homarr-local-port>:127\.0\.0\.1:21006/);
assert.equal(Object.keys(fullTunnel.localUrls).length, 7);

const wildcard = resolveSessionAccess({
  advertisedHost: "media.home.arpa",
  bindAddress: "0.0.0.0",
  directServices: ["homarr"],
  ports,
});
assert.deepEqual(wildcard.composeBindings, ["0.0.0.0"]);
assert.equal(wildcard.services.homarr.browserUrl, "http://127.0.0.1:21006");
assert.equal(wildcard.services.homarr.reachableUrl, "http://media.home.arpa:21006");
assert.equal(wildcard.services.sonarr.reachableUrl, null);
assert.equal(JSON.stringify(wildcard.services).includes("http://0.0.0.0"), false);

const lan = resolveSessionAccess({
  advertisedHost: "192.168.20.5",
  bindAddress: "192.168.20.5",
  ports,
});
assert.deepEqual(lan.composeBindings, ["127.0.0.1", "192.168.20.5"]);
assert.equal(lan.services.sonarr.browserUrl, "http://127.0.0.1:21002");
assert.equal(lan.services.sonarr.reachableUrl, "http://192.168.20.5:21002");

const proxied = resolveSessionAccess({
  ports,
  reverseProxyUrls: {
    homarr: "https://homarr.home.arpa/",
    jellyfin: "https://watch.home.arpa",
  },
});
assert.equal(proxied.services.homarr.reachableUrl, "https://homarr.home.arpa");
assert.equal(proxied.services.homarr.reverseProxyUrl, "https://homarr.home.arpa");
assert.equal(proxied.services.sonarr.reachableUrl, null);
assert.equal(proxied.bindAddress, "0.0.0.0");

const unboundAdvertisement = resolveSessionAccess({
  advertisedHost: "media.home.arpa",
  ports,
});
assert.equal(unboundAdvertisement.services.homarr.reachableUrl, "http://media.home.arpa:21006");

const sessionView = sessionAccess({
  sessionDir: "/tmp/session-access-no-config-fixture",
  manifest: {
    ...ports,
    HOMARR_BIND_ADDRESS: "0.0.0.0",
    HOMARR_ADVERTISED_HOST: "media.home.arpa",
  },
});
assert.equal(sessionView.services.homarr.reachableUrl, "http://media.home.arpa:21006");
assert.equal(sessionView.services.jellyfin.reachableUrl, null);
assert.equal(sessionAccess({
  sessionDir: "/tmp/session-access-no-config-fixture",
  manifest: {
    ...ports,
    HOMARR_ADVERTISED_HOST: "media.home.arpa",
  },
}).services.homarr.reachableUrl, "http://media.home.arpa:21006");

const accessSessionRoot = mkdtempSync(join(tmpdir(), "session-access-config-"));
mkdirSync(join(accessSessionRoot, "artifacts"), { mode: 0o700 });
const accessSession = {
  sessionDir: accessSessionRoot,
  manifest: {
    ...ports,
    SESSION_PASSWORD_SCHEME: "hmac-v1",
  },
};
assert.throws(() => configureSessionProxyAccess(
  accessSession,
  "set",
  "homarr",
  "https://homarr.home.arpa",
), /private DNS fact/);
configureSessionProxyAccess(
  accessSession,
  "set",
  "homarr",
  "https://homarr.home.arpa",
  true,
);
configureSessionProxyAccess(
  accessSession,
  "set",
  "jellyfin",
  "http://192.168.20.5:8096",
);
assert.equal(statSync(join(accessSessionRoot, "artifacts", "access.json")).mode & 0o777, 0o600);
assert.deepEqual(loadSessionAccessConfig(accessSession).reverseProxyUrls, {
  homarr: "https://homarr.home.arpa",
  jellyfin: "http://192.168.20.5:8096",
});
assert.equal(sessionAccess(accessSession).services.homarr.reachableUrl, "https://homarr.home.arpa");
assert.equal(sessionAccess(accessSession).services.jellyfin.reachableUrl, "http://192.168.20.5:8096");
configureSessionProxyAccess(accessSession, "clear", "jellyfin");
assert.equal(loadSessionAccessConfig(accessSession).reverseProxyUrls.jellyfin, undefined);

assert.deepEqual(SESSION_ACCESS_SERVICES, [
  "prowlarr", "radarr", "sonarr", "qbittorrent", "jellyfin", "seerr", "homarr",
]);
assert.equal(resolveSessionAccess({ bindAddress: "0.0.0.0", ports }).services.homarr.reachableUrl, null);
assert.throws(() => resolveSessionAccess({ advertisedHost: "0.0.0.0", bindAddress: "0.0.0.0", ports }));
assert.throws(() => resolveSessionAccess({ advertisedHost: "localhost", bindAddress: "0.0.0.0", ports }));
assert.throws(() => resolveSessionAccess({ advertisedHost: "media.example", bindAddress: "8.8.8.8", ports }));
assert.throws(() => resolveSessionAccess({ ports: { ...ports, HOMARR_PORT: "70000" } }));
assert.throws(() => resolveSessionAccess({ ports, reverseProxyUrls: { unknown: "https://media.home.arpa" } }));
assert.throws(() => resolveSessionAccess({ ports, directServices: ["unknown"] }));
assert.throws(() => resolveSessionAccess({ ports, reverseProxyUrls: { homarr: "http://localhost:7575" } }));
const credentialUrl = new URL("https://media.home.arpa");
credentialUrl.username = "user";
credentialUrl.password = ["pa", "ss"].join("");
assert.throws(() => resolveSessionAccess({ ports, reverseProxyUrls: { homarr: credentialUrl.href } }));
assert.throws(() => resolveSessionAccess({ ports, reverseProxyUrls: { homarr: "https://media.home.arpa/path" } }));

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const compose = readFileSync(`${repositoryRoot}/docker-compose.yml`, "utf8");
assert.match(
  compose,
  /"\$\{MEDIA_PORT_BIND_PREFIX:-}\$\{HOMARR_PORT:-7575}:7575"/,
);
assert.equal((compose.match(/HOMARR_BIND_ADDRESS/g) ?? []).length, 0);
const sessionScript = readFileSync(`${repositoryRoot}/scripts/session.sh`, "utf8");
assert.match(sessionScript, /--homarr-host HOST/);
assert.match(sessionScript, /HOMARR_REACHABILITY=configured-not-verified/);
assert.match(sessionScript, /bootstrap-jellyfin\)/);

process.stdout.write("PASS session access resolver\n");
