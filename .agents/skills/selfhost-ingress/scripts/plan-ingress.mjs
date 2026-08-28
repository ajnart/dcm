#!/usr/bin/env node

import fs from "node:fs";
import { isIP } from "node:net";

const MAX_INPUT_BYTES = 256 * 1024;
const MAX_COLLECTION_ITEMS = 100;
const PUBLIC_ROUTES = new Set(["reverse-proxy", "cloudflare-tunnel", "pangolin-newt", "ngrok"]);
const PROTECTED_CLASSES = new Set([
  "admin",
  "database",
  "queue",
  "arr",
  "downloader",
  "qbittorrent",
  "docker-api",
  "docker-socket",
  "identity-admin",
]);
const PROXY_KINDS = new Set(["caddy", "traefik", "npm", "nginx-proxy-manager"]);

function usage() {
  process.stdout.write(`Usage: plan-ingress.mjs (--input FILE | --json JSON)\n\n`);
  process.stdout.write("Create a redacted, read-only ingress plan from explicit facts and preferences.\n");
}

function fail(message) {
  process.stderr.write(`plan-ingress.mjs: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const options = { inputPath: "", json: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      usage();
      process.exit(0);
    }
    if (argument === "--input" || argument === "--json") {
      if (index + 1 >= argv.length) {
        fail(`${argument} requires a value`);
      }
      const value = argv[index + 1];
      if (argument === "--input") {
        options.inputPath = value;
      } else {
        options.json = value;
      }
      index += 1;
      continue;
    }
    fail("unknown argument");
  }
  if (Boolean(options.inputPath) === Boolean(options.json)) {
    fail("provide exactly one of --input or --json");
  }
  return options;
}

function readDocument(options) {
  let content = options.json;
  if (options.inputPath) {
    const stat = fs.statSync(options.inputPath);
    if (!stat.isFile()) {
      fail("--input must name a regular file");
    }
    if (stat.size > MAX_INPUT_BYTES) {
      fail("input exceeds 256 KiB");
    }
    content = fs.readFileSync(options.inputPath, "utf8");
  }
  if (Buffer.byteLength(content, "utf8") > MAX_INPUT_BYTES) {
    fail("input exceeds 256 KiB");
  }
  try {
    return JSON.parse(content);
  } catch {
    fail("input is not valid JSON");
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertSecretFree(value, key = "input", depth = 0) {
  if (depth > 12) {
    fail("input nesting exceeds the supported limit");
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_COLLECTION_ITEMS) {
      fail("an input collection exceeds 100 items");
    }
    for (const item of value) {
      assertSecretFree(item, key, depth + 1);
    }
    return;
  }
  if (isObject(value)) {
    for (const [childKey, childValue] of Object.entries(value)) {
      const referenceKey = /^(?:required)?secretrefs?$/i.test(childKey);
      const sensitiveKey = /password|passwd|token|api[-_]?key|private[-_]?key|credential|secret/i.test(childKey);
      if (sensitiveKey && !referenceKey) {
        fail("plaintext secret-bearing fields are not accepted; use secretRefs");
      }
      if (referenceKey) {
        validateSecretReferences(childValue);
        continue;
      }
      assertSecretFree(childValue, childKey, depth + 1);
    }
    return;
  }
  if (typeof value === "string") {
    if (value.length > 2048) {
      fail("an input string exceeds the supported limit");
    }
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)) {
      fail("private key material is not accepted");
    }
    if (/[?&](?:token|password|api[_-]?key|secret)=/i.test(value)) {
      fail("secret-bearing URLs are not accepted");
    }
  }
}

function validateSecretReferences(value) {
  let references = [value];
  if (Array.isArray(value)) {
    references = value;
  }
  if (references.length > 20) {
    fail("secretRefs exceeds 20 items");
  }
  for (const reference of references) {
    if (typeof reference !== "string") {
      fail("secretRefs must contain opaque string identifiers");
    }
    if (!/^[a-z0-9][a-z0-9._:/-]{2,127}$/i.test(reference)) {
      fail("a secret reference is not an opaque identifier");
    }
  }
}

function objectOrEmpty(value) {
  if (isObject(value)) {
    return value;
  }
  return {};
}

function arrayOrEmpty(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return [];
}

function boundedLabel(value, fallback = "unknown") {
  if (typeof value !== "string" || value.length === 0) {
    return fallback;
  }
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 128);
  if (clean.length === 0) {
    return fallback;
  }
  return clean;
}

function validHostname(value) {
  if (typeof value !== "string" || value.length > 253) {
    return false;
  }
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(value);
}

function parseIpv4(value) {
  const parts = value.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const octets = [];
  for (const part of parts) {
    if (!/^(?:0|[1-9]\d{0,2})$/.test(part)) {
      return null;
    }
    const octet = Number(part);
    if (octet > 255) {
      return null;
    }
    octets.push(octet);
  }
  return octets;
}

function isPrivateCidr(value) {
  if (typeof value !== "string") {
    return false;
  }
  const pieces = value.split("/");
  if (pieces.length !== 2) {
    return false;
  }
  const address = pieces[0];
  const prefix = Number(pieces[1]);
  const octets = parseIpv4(address);
  if (octets && Number.isInteger(prefix)) {
    if (octets[0] === 10 && prefix >= 8 && prefix <= 32) {
      return true;
    }
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31 && prefix >= 12 && prefix <= 32) {
      return true;
    }
    if (octets[0] === 192 && octets[1] === 168 && prefix >= 16 && prefix <= 32) {
      return true;
    }
    return false;
  }
  if (!Number.isInteger(prefix) || prefix < 7 || prefix > 128) {
    return false;
  }
  if (isIP(address) !== 6) {
    return false;
  }
  return /^(?:fc|fd)/i.test(address);
}

function normalizeRoute(value) {
  const route = boundedLabel(value, "local").toLowerCase();
  const aliases = new Map([
    ["private", "local"],
    ["local-only", "local"],
    ["tailnet", "tailscale-serve"],
    ["tailscale", "tailscale-serve"],
    ["proxy", "reverse-proxy"],
    ["public", "reverse-proxy"],
    ["cloudflare", "cloudflare-tunnel"],
    ["pangolin", "pangolin-newt"],
    ["temporary", "ngrok"],
  ]);
  if (aliases.has(route)) {
    return aliases.get(route);
  }
  return route;
}

function ownersFor(records, predicate) {
  const owners = new Set();
  for (const record of arrayOrEmpty(records)) {
    if (!isObject(record) || !predicate(record)) {
      continue;
    }
    if (typeof record.owner === "string" && record.owner.length > 0) {
      owners.add(boundedLabel(record.owner));
    }
  }
  return [...owners].sort();
}

function zoneMatches(hostname, zone) {
  if (typeof zone !== "string") {
    return false;
  }
  return hostname === zone || hostname.endsWith(`.${zone}`);
}

function hasSecretReference(references, terms) {
  return references.some((reference) => {
    const lowered = reference.toLowerCase();
    return terms.every((term) => lowered.includes(term));
  });
}

function main() {
  const input = readDocument(parseArgs(process.argv.slice(2)));
  if (!isObject(input) || input.schemaVersion !== 1) {
    fail("schemaVersion must be 1");
  }
  assertSecretFree(input);

  const service = objectOrEmpty(input.service);
  const facts = objectOrEmpty(input.facts);
  const preferences = objectOrEmpty(input.preferences);
  const ownership = objectOrEmpty(facts.ownership);
  const serviceId = boundedLabel(service.id, "service");
  const serviceClass = boundedLabel(service.class, "application").toLowerCase();
  const route = normalizeRoute(preferences.route);
  const supportedRoutes = new Set([
    "local",
    "lan",
    "tailscale-serve",
    "headscale",
    "reverse-proxy",
    "cloudflare-tunnel",
    "pangolin-newt",
    "ngrok",
  ]);
  if (!supportedRoutes.has(route)) {
    fail("preferences.route is unsupported");
  }

  const gates = [];
  const conflicts = [];
  const decisionsNeeded = [];
  const steps = [];
  const secretRefs = arrayOrEmpty(preferences.secretRefs);
  validateSecretReferences(secretRefs);
  let selectedOwner = "service-owner";
  let exposure = "private";

  function gate(id, passed, detail) {
    let status = "blocked";
    if (passed) {
      status = "pass";
    }
    gates.push({ id, status, detail });
    if (!passed) {
      decisionsNeeded.push(detail);
    }
  }

  function conflict(id, detail) {
    conflicts.push({ id, detail });
  }

  for (const binding of arrayOrEmpty(service.directBindings)) {
    if (!isObject(binding)) {
      continue;
    }
    if (binding.internetReachable === true) {
      conflict("direct-public-port", "Remove direct internet reachability; use the selected edge as the only public route.");
    }
  }

  if (PUBLIC_ROUTES.has(route)) {
    exposure = "public";
    if (PROTECTED_CLASSES.has(serviceClass)) {
      conflict("protected-public-surface", `${serviceClass} surfaces require LAN or private-tailnet access.`);
    }
    gate("public-approval", preferences.publicApproved === true, "Record explicit approval for public reachability.");
    const authentication = objectOrEmpty(preferences.authentication);
    const authenticationReady = authentication.approved === true
      && typeof authentication.mode === "string"
      && authentication.mode.length > 0
      && authentication.mode.toLowerCase() !== "none"
      && typeof authentication.owner === "string"
      && authentication.owner.length > 0;
    gate("authentication-approval", authenticationReady, "Choose and approve an authentication policy with an accountable owner.");
  }

  if (route === "local") {
    selectedOwner = "service-owner";
    steps.push("Bind the service to loopback only.");
    steps.push("Keep public DNS and public proxy routes absent.");
  }

  if (route === "lan") {
    selectedOwner = "host-firewall-owner";
    const cidrs = arrayOrEmpty(preferences.lanCidrs);
    const cidrsValid = cidrs.length > 0 && cidrs.every(isPrivateCidr);
    gate("lan-scope", cidrsValid, "Choose explicit private LAN CIDRs; wildcard internet ranges are invalid.");
    gate("firewall-scope", facts.firewallScopeKnown === true, "Record observed effective firewall scope for the service port.");
    steps.push("Bind only on the intended LAN interface or enforce the selected private CIDRs at the effective firewall.");
  }

  if (route === "tailscale-serve") {
    const tailscale = objectOrEmpty(facts.tailscale);
    selectedOwner = boundedLabel(tailscale.aclOwner, "tailnet-owner-pending");
    gate("tailscale-running", tailscale.status === "running", "Observe the selected Tailscale node running before route apply.");
    gate("tailnet-acl-owner", typeof tailscale.aclOwner === "string" && tailscale.aclOwner.length > 0, "Identify the tailnet ACL owner.");
    steps.push("Keep the backend private and route only this service through Tailscale Serve.");
  }

  if (route === "headscale") {
    const headscale = objectOrEmpty(facts.headscale);
    selectedOwner = boundedLabel(headscale.lifecycleOwner, "headscale-owner-pending");
    gate("headscale-running", headscale.status === "running", "Observe the chosen Headscale control plane running.");
    gate("headscale-lifecycle", typeof headscale.lifecycleOwner === "string" && headscale.lifecycleOwner.length > 0, "Identify who operates and backs up Headscale.");
    gate("headscale-acl-owner", typeof headscale.aclOwner === "string" && headscale.aclOwner.length > 0, "Identify the Headscale policy owner.");
    steps.push("Enroll the intended client and advertise only the selected private route under the approved ACL.");
  }

  if (route === "reverse-proxy") {
    const desiredOwner = boundedLabel(preferences.desiredOwner, "");
    let candidates = arrayOrEmpty(facts.existingIngress).filter((candidate) => {
      return isObject(candidate) && PROXY_KINDS.has(String(candidate.kind).toLowerCase()) && candidate.acceptsRoutes === true;
    });
    if (desiredOwner) {
      candidates = candidates.filter((candidate) => candidate.owner === desiredOwner);
    }
    if (candidates.length > 1) {
      conflict("multiple-compatible-proxies", "Choose one existing reverse-proxy owner and route contract.");
    }
    const candidate = candidates[0];
    gate("existing-proxy", Boolean(candidate), "Identify one compatible existing Caddy, Traefik, or Nginx Proxy Manager owner.");
    if (candidate) {
      selectedOwner = boundedLabel(candidate.owner, "proxy-owner-pending");
      const completeContract = typeof candidate.owner === "string"
        && typeof candidate.lifecycleOwner === "string"
        && typeof candidate.routeContract === "string"
        && typeof candidate.network === "string"
        && arrayOrEmpty(candidate.ports).includes(80)
        && arrayOrEmpty(candidate.ports).includes(443);
      gate("proxy-reuse-contract", completeContract, "Complete proxy owner, lifecycle, route, network, and 80/443 ownership facts.");
      for (const port of [80, 443]) {
        const owners = ownersFor(ownership.ports, (record) => Number(record.port) === port);
        if (owners.length > 1 || (owners.length === 1 && owners[0] !== selectedOwner)) {
          conflict(`port-${port}-owner`, `Resolve competing ownership for host port ${port}; the planner will not replace it.`);
        }
        gate(`port-${port}-owner`, owners.length === 1 && owners[0] === selectedOwner, `Record ${selectedOwner} as the sole observed owner of host port ${port}.`);
      }
      steps.push(`Attach the backend to the approved ${boundedLabel(candidate.kind)} route contract without publishing a second public port.`);
    }
  }

  if (route === "cloudflare-tunnel") {
    const cloudflare = objectOrEmpty(facts.cloudflare);
    selectedOwner = boundedLabel(cloudflare.accountOwner, "cloudflare-owner-pending");
    gate("cloudflare-owner", typeof cloudflare.accountOwner === "string" && cloudflare.accountOwner.length > 0, "Identify the Cloudflare account and zone owner.");
    gate("cloudflare-access-owner", typeof cloudflare.accessPolicyOwner === "string" && cloudflare.accessPolicyOwner.length > 0, "Identify the Cloudflare Access or equivalent policy owner.");
    gate("cloudflare-secret-ref", hasSecretReference(secretRefs, ["cloudflare", "tunnel"]), "Provide an opaque Cloudflare tunnel-token secret reference.");
    steps.push("Route the public hostname through one outbound Cloudflare connector and an approved access policy.");
  }

  if (route === "pangolin-newt") {
    const pangolin = objectOrEmpty(facts.pangolin);
    selectedOwner = boundedLabel(pangolin.owner, "pangolin-owner-pending");
    const contractReady = pangolin.status === "running"
      && pangolin.publicEndpointReady === true
      && typeof pangolin.owner === "string"
      && typeof pangolin.lifecycleOwner === "string"
      && typeof pangolin.routeContract === "string";
    gate("pangolin-contract", contractReady, "Record a running public Pangolin edge with owner, lifecycle, and route contract.");
    gate("pangolin-secret-ref", hasSecretReference(secretRefs, ["pangolin", "newt"]), "Provide an opaque Pangolin/Newt secret reference.");
    steps.push("Connect the private backend to the existing Pangolin edge through Newt under its identity policy.");
  }

  if (route === "ngrok") {
    selectedOwner = "ngrok-session-owner";
    gate("temporary-approval", preferences.temporaryApproved === true, "Record explicit approval for a temporary endpoint.");
    gate("expiry", typeof preferences.expiresAt === "string" && !Number.isNaN(Date.parse(preferences.expiresAt)), "Choose a valid endpoint expiry time.");
    gate("non-production", preferences.productionData === false, "Confirm the endpoint carries no production data.");
    gate("ngrok-secret-ref", hasSecretReference(secretRefs, ["ngrok"]), "Provide an opaque ngrok agent-token secret reference.");
    steps.push("Create one expiring ngrok endpoint with the approved traffic policy, then remove it at expiry.");
  }

  const hostname = preferences.hostname;
  if (PUBLIC_ROUTES.has(route) && route !== "ngrok") {
    gate("hostname", validHostname(hostname), "Choose a valid public hostname.");
    if (validHostname(hostname)) {
      const dnsOwners = ownersFor(ownership.dns, (record) => zoneMatches(hostname, record.zone) || record.hostname === hostname);
      if (dnsOwners.length > 1) {
        conflict("dns-owner", "Resolve competing DNS ownership for the selected hostname.");
      }
      gate("dns-owner", dnsOwners.length === 1, "Record one DNS owner for the selected hostname or zone.");

      const tlsOwners = ownersFor(ownership.tls, (record) => record.hostname === hostname || record.hostname === "*");
      if (tlsOwners.length > 1) {
        conflict("tls-owner", "Resolve competing TLS ownership for the selected hostname.");
      }
      gate("tls-owner", tlsOwners.length === 1, "Record one TLS termination and certificate owner for the selected hostname.");
      if (route === "reverse-proxy" && tlsOwners.length === 1 && tlsOwners[0] !== selectedOwner) {
        conflict("proxy-tls-owner", "The selected reverse proxy and TLS ownership records disagree.");
      }
    }
  }

  let status = "pass";
  if (gates.some((item) => item.status === "blocked")) {
    status = "blocked";
  }
  if (conflicts.length > 0) {
    status = "conflict";
  }

  let plannedHostname = null;
  if (validHostname(hostname)) {
    plannedHostname = hostname.toLowerCase();
  }

  const plan = {
    schemaVersion: 1,
    planner: "selfhost-ingress",
    status,
    authority: "read-only-plan",
    service: { id: serviceId, class: serviceClass },
    route: {
      mode: route,
      exposure,
      owner: selectedOwner,
      backendPolicy: "private-only",
      hostname: plannedHostname,
      steps,
    },
    gates,
    conflicts,
    decisionsNeeded: [...new Set(decisionsNeeded)],
    verification: [
      "Resolve the hostname from an intended client network when a hostname applies.",
      "Verify TLS name and expiry when TLS applies.",
      "Prove the route reaches only the intended service and enforces its access policy.",
      "Prove direct service and protected management ports remain non-public.",
    ],
    claims: {
      applied: false,
      externallyVerified: false,
    },
  };
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

main();
