#!/usr/bin/env bun

import fs from "node:fs";
import { pathToFileURL } from "node:url";

const MAX_PLAN_BYTES = 256 * 1024;
const MAX_PLANS = 100;

function fail(message) {
  process.stderr.write(`render-caddyfile.ts: ${message}\n`);
  process.exit(2);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactObject(value, keys, context) {
  if (!isObject(value)) {
    throw new Error(`${context} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${context} must contain exactly the documented fields`);
  }
}

function exactStringArray(value, context) {
  if (!Array.isArray(value) || value.length > 100 || value.some((item) => typeof item !== "string" || item.length > 2048)) {
    throw new Error(`${context} must be a bounded string array`);
  }
}

function validHostname(value) {
  return typeof value === "string"
    && value.length <= 253
    && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(value);
}

function validDockerName(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_.-]{0,62}$/i.test(value);
}

function validPrivateBind(value) {
  if (value === "127.0.0.1" || value === "::1") return true;
  if (typeof value !== "string") return false;
  const ipv4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((octet) => octet > 255)) return false;
    return octets[0] === 10
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168);
  }
  return /^(?:fc|fd)[0-9a-f:]+$/i.test(value);
}

function parseArguments(argv) {
  if (argv.length === 2 && argv[0] === "--input") return [argv[1]];
  if (argv[0] === "--inputs" && argv.length >= 2 && argv.length <= MAX_PLANS + 1) return argv.slice(1);
  fail("usage: render-caddyfile.ts (--input PLAN.json | --inputs PLAN.json [PLAN.json ...])");
}

function readPlan(planPath) {
  let stat;
  try {
    stat = fs.lstatSync(planPath);
  } catch {
    fail("plan is unavailable");
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PLAN_BYTES) {
    fail("plan must be a regular non-symlink file no larger than 256 KiB");
  }
  try {
    return JSON.parse(fs.readFileSync(planPath, "utf8"));
  } catch {
    fail("plan is not valid JSON");
  }
}

function normalizePlan(plan) {
  exactObject(plan, ["schemaVersion", "planner", "status", "authority", "service", "route", "gates", "conflicts", "decisionsNeeded", "requiredEvidence", "verification", "claims"], "plan");
  exactObject(plan.service, ["id", "class"], "plan.service");
  exactObject(plan.route, ["mode", "exposure", "owner", "backendPolicy", "hostname", "steps", "caddy", "applicationRequirements"], "plan.route");
  exactObject(plan.claims, ["applied", "externallyVerified"], "plan.claims");
  if (!Array.isArray(plan.gates) || plan.gates.length > 100) throw new Error("plan.gates must be bounded");
  for (const gate of plan.gates) exactObject(gate, ["id", "status", "detail"], "plan gate");
  if (!Array.isArray(plan.conflicts) || plan.conflicts.length > 100) throw new Error("plan.conflicts must be bounded");
  for (const conflict of plan.conflicts) exactObject(conflict, ["id", "detail"], "plan conflict");
  exactStringArray(plan.decisionsNeeded, "plan.decisionsNeeded");
  exactStringArray(plan.verification, "plan.verification");
  exactStringArray(plan.route.steps, "plan.route.steps");
  exactStringArray(plan.route.applicationRequirements, "plan.route.applicationRequirements");
  if (!Array.isArray(plan.requiredEvidence) || plan.requiredEvidence.length !== 0) throw new Error("private Caddy render requires no unresolved evidence records");
  if (plan.planner !== "selfhost-ingress" || plan.schemaVersion !== 1) throw new Error("input must be a selfhost-ingress schemaVersion 1 plan");
  if (plan.status !== "pass" || plan.authority !== "read-only-plan" || plan.conflicts.length !== 0 || plan.decisionsNeeded.length !== 0) throw new Error("only a passing read-only plan can be rendered");
  if (plan.claims.applied !== false || plan.claims.externallyVerified !== false) throw new Error("renderer accepts only unapplied, unverified plans");
  if (plan.route.mode !== "caddy-private" || plan.route.exposure !== "private" || plan.route.backendPolicy !== "private-only") throw new Error("renderer accepts only the private Caddy route; public routes require separate approvals and policy");
  const caddy = plan.route.caddy;
  exactObject(caddy, ["hostname", "httpsPort", "privateUrl", "tls", "runtime", "upstreamHost", "upstreamPort", "configPath", "dataPath", "hostBindAddress", "clientScope", "composePublishAddress", "resourceOwnership", "dockerSocket"], "plan.route.caddy");
  exactObject(caddy.resourceOwnership, ["httpsPort", "owner", "hostBindAddress"], "Caddy resource ownership");
  if (!validHostname(caddy.hostname) || plan.route.hostname !== caddy.hostname) throw new Error("Caddy hostname is invalid or inconsistent");
  if (!Number.isInteger(caddy.httpsPort) || caddy.httpsPort < 1 || caddy.httpsPort > 65535) throw new Error("Caddy HTTPS port is invalid");
  const expectedUrl = caddy.httpsPort === 443 ? `https://${caddy.hostname}` : `https://${caddy.hostname}:${caddy.httpsPort}`;
  if (caddy.privateUrl !== expectedUrl) throw new Error("Caddy private URL is inconsistent");
  if (!Number.isInteger(caddy.upstreamPort) || caddy.upstreamPort < 1 || caddy.upstreamPort > 65535) throw new Error("Caddy upstream port is invalid");
  if (!validPrivateBind(caddy.hostBindAddress)) throw new Error("Caddy host bind must be loopback or one explicit RFC1918/ULA address");
  if (caddy.tls !== "internal" || caddy.dockerSocket !== "forbidden") throw new Error("plan does not contain the required private Caddy policy");
  if (caddy.resourceOwnership.httpsPort !== caddy.httpsPort || caddy.resourceOwnership.owner !== plan.route.owner || caddy.resourceOwnership.hostBindAddress !== caddy.hostBindAddress) throw new Error("Caddy HTTPS port ownership is inconsistent");
  if (caddy.runtime === "container") {
    if (!validDockerName(caddy.upstreamHost) || caddy.upstreamHost === "localhost") throw new Error("container Caddy requires a Docker DNS upstream name");
    if (caddy.composePublishAddress !== caddy.hostBindAddress) throw new Error("container Caddy requires its validated private address as the Compose publish address");
  } else if (caddy.runtime === "host") {
    if (caddy.upstreamHost !== "127.0.0.1" || caddy.composePublishAddress !== null) throw new Error("host Caddy requires a loopback upstream and no Compose publish address");
  } else {
    throw new Error("Caddy runtime is invalid");
  }
  return plan;
}

export function renderCaddyfile(input) {
  const plans = Array.isArray(input) ? input : [input];
  if (plans.length === 0 || plans.length > MAX_PLANS) throw new Error("renderer requires 1 to 100 plans");
  const normalized = plans.map(normalizePlan);
  const first = normalized[0].route.caddy;
  const owner = normalized[0].route.owner;
  const hostnames = new Set();
  for (const plan of normalized) {
    const caddy = plan.route.caddy;
    if (plan.route.owner !== owner || caddy.runtime !== first.runtime || caddy.hostBindAddress !== first.hostBindAddress || caddy.composePublishAddress !== first.composePublishAddress || caddy.configPath !== first.configPath || caddy.dataPath !== first.dataPath || caddy.httpsPort !== first.httpsPort) {
      throw new Error("aggregated Caddy plans must share owner, runtime, bind, persistence, and HTTPS port");
    }
    if (hostnames.has(caddy.hostname)) throw new Error("aggregated Caddy hostnames must be unique");
    hostnames.add(caddy.hostname);
  }
  normalized.sort((left, right) => left.route.caddy.hostname.localeCompare(right.route.caddy.hostname));
  const blocks = normalized.map((plan) => {
    const caddy = plan.route.caddy;
    const address = caddy.httpsPort === 443 ? caddy.hostname : `${caddy.hostname}:${caddy.httpsPort}`;
    let bindDirective = "";
    if (caddy.runtime === "host") bindDirective = `\tbind ${caddy.hostBindAddress}\n`;
    return `${address} {\n${bindDirective}\ttls internal\n\treverse_proxy ${caddy.upstreamHost}:${caddy.upstreamPort}\n}`;
  });
  return `{\n\tauto_https disable_redirects\n}\n\n${blocks.join("\n\n")}\n`;
}

if (typeof Bun !== "undefined" && Bun.argv[1] && pathToFileURL(Bun.argv[1]).href === import.meta.url) {
  const paths = parseArguments(Bun.argv.slice(2));
  const plans = paths.map(readPlan);
  try {
    process.stdout.write(renderCaddyfile(plans));
  } catch (error) {
    fail(error instanceof Error ? error.message : "unable to render Caddyfile");
  }
}
