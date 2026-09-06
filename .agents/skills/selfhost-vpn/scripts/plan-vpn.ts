#!/usr/bin/env bun

import fs from "node:fs";
import { isIP } from "node:net";

const MAX_INPUT_BYTES = 256 * 1024;
const MAX_COLLECTION_ITEMS = 100;

function usage() {
  process.stdout.write("Usage: plan-vpn.ts (--input FILE | --json JSON)\n\n");
  process.stdout.write("Create a provider-neutral, read-only downloader VPN and evidence plan.\n");
}

function fail(message) {
  process.stderr.write(`plan-vpn.ts: ${message}\n`);
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
  if (value === "::1/128") {
    return true;
  }
  const pieces = value.split("/");
  if (pieces.length !== 2) {
    return false;
  }
  const address = pieces[0];
  const prefix = Number(pieces[1]);
  const octets = parseIpv4(address);
  if (octets && Number.isInteger(prefix)) {
    if (octets[0] === 127 && prefix >= 8 && prefix <= 32) {
      return true;
    }
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

function validPrivateBind(value) {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  if (value === "0.0.0.0" || value === "::" || value === "*" || value === "[::]") {
    return false;
  }
  if (value === "localhost" || value === "127.0.0.1" || value === "::1") {
    return true;
  }
  const octets = parseIpv4(value);
  if (octets) {
    if (octets[0] === 10) {
      return true;
    }
    if (octets[0] === 192 && octets[1] === 168) {
      return true;
    }
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
      return true;
    }
  }
  return isIP(value) === 6 && /^(?:fc|fd)/i.test(value);
}

function allTrue(object, keys) {
  return keys.every((key) => object[key] === true);
}

function hasSecretReference(references, terms) {
  return references.some((reference) => {
    const lowered = reference.toLowerCase();
    return terms.some((term) => lowered.includes(term));
  });
}

function main() {
  const input = readDocument(parseArgs(Bun.argv.slice(2)));
  if (!isObject(input) || input.schemaVersion !== 1) {
    fail("schemaVersion must be 1");
  }
  assertSecretFree(input);

  const service = objectOrEmpty(input.service);
  const facts = objectOrEmpty(input.facts);
  const preferences = objectOrEmpty(input.preferences);
  const evidence = objectOrEmpty(input.evidence);
  const topology = objectOrEmpty(facts.observedTopology);
  const serviceId = boundedLabel(service.id, "downloader");
  const serviceClass = boundedLabel(service.class, "downloader").toLowerCase();
  const mode = boundedLabel(preferences.mode, "unselected").toLowerCase();
  const supportedModes = new Set(["gluetun", "wireguard"]);
  let gatewayService = boundedLabel(preferences.gatewayService, "");
  if (!gatewayService && mode === "gluetun") {
    gatewayService = "gluetun";
  }
  if (!gatewayService && mode === "wireguard") {
    gatewayService = "vpn-gateway";
  }

  const gates = [];
  const conflicts = [];
  const decisionsNeeded = [];

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

  gate("gateway-mode", supportedModes.has(mode), "Choose an existing or user-selected Gluetun or WireGuard gateway mode.");
  gate("downloader-class", serviceClass === "downloader" || serviceClass === "qbittorrent", "Limit this capability to a downloader service.");

  const scope = arrayOrEmpty(preferences.scope);
  const exactScope = scope.length === 1 && scope[0] === service.id;
  gate("downloader-only-scope", exactScope, "Set VPN scope to the named downloader only.");
  if (scope.some((item) => item !== service.id)) {
    conflict("control-plane-in-vpn", "Remove Arr, Seerr, media, proxy, dashboard, and management services from VPN scope.");
  }

  const lanControlCidrs = arrayOrEmpty(preferences.lanControlCidrs);
  const lanControlReady = lanControlCidrs.length > 0 && lanControlCidrs.every(isPrivateCidr);
  gate("lan-control-allowlist", lanControlReady, "Choose explicit loopback, RFC1918, or IPv6 ULA control CIDRs; default routes are invalid.");
  gate("private-webui-bind", validPrivateBind(preferences.webUiBind), "Bind the downloader WebUI to loopback or a specific private interface, never a wildcard.");

  const webUiPort = Number(service.webUiPort);
  gate("webui-port", Number.isInteger(webUiPort) && webUiPort >= 1 && webUiPort <= 65535, "Record the downloader WebUI port.");

  const secretRefs = arrayOrEmpty(preferences.secretRefs);
  validateSecretReferences(secretRefs);
  let secretReferenceReady = false;
  if (mode === "gluetun") {
    secretReferenceReady = hasSecretReference(secretRefs, ["vpn", "gluetun"]);
  }
  if (mode === "wireguard") {
    secretReferenceReady = hasSecretReference(secretRefs, ["wireguard", "vpn"]);
  }
  gate("vpn-secret-reference", secretReferenceReady, "Provide an opaque reference for the selected gateway credentials or WireGuard key material.");
  gate("legal-content-scope", preferences.legalContentOnly === true, "Confirm that any traffic or test fixture is authorized and legal.");

  const topologyKeys = [
    "downloaderSharesGatewayNamespace",
    "webUiPublishedByGateway",
    "gatewayHasTun",
    "gatewayHasNetAdmin",
    "killSwitchEnabled",
    "lanAllowlistApplied",
  ];
  const topologyReady = allTrue(topology, topologyKeys) && topology.downloaderPublishesPorts === false;
  gate("observed-topology", topologyReady, "Record the namespace, gateway-published WebUI, TUN/capability, firewall, allowlist, and no-direct-port facts.");
  if (topology.downloaderSharesGatewayNamespace === false) {
    conflict("namespace-bypass", "The downloader does not share the selected gateway namespace.");
  }
  if (topology.downloaderPublishesPorts === true) {
    conflict("direct-downloader-port", "Remove ports published directly by the downloader; publish the private WebUI on the gateway.");
  }
  if (topology.killSwitchEnabled === false) {
    conflict("kill-switch-disabled", "Enable and verify a fail-closed gateway firewall before downloader use.");
  }

  const healthy = objectOrEmpty(evidence.healthy);
  const healthyReady = allTrue(healthy, [
    "tunnelUp",
    "externalIpObserved",
    "expectedTunnelEgress",
    "dnsResolverObserved",
    "dnsUsesTunnel",
  ]);
  gate("healthy-baseline", healthyReady, "Record tunnel IP and DNS behavior from the downloader namespace while healthy.");

  const tunnelBreak = objectOrEmpty(evidence.tunnelBreak);
  const breakTimestampReady = typeof tunnelBreak.recordedAt === "string" && !Number.isNaN(Date.parse(tunnelBreak.recordedAt));
  const tunnelBreakReady = breakTimestampReady && allTrue(tunnelBreak, [
    "performed",
    "tunnelDownObserved",
    "downloaderStayedRunning",
    "externalRequestFailed",
    "dnsRequestFailed",
  ]);
  gate("tunnel-break", tunnelBreakReady, "Record a timestamped tunnel break where the downloader stays running and external IP plus DNS requests fail closed.");
  if (tunnelBreak.performed === true && tunnelBreak.externalRequestFailed === false) {
    conflict("egress-leak", "The external request succeeded during the tunnel break; isolation failed.");
  }
  if (tunnelBreak.performed === true && tunnelBreak.dnsRequestFailed === false) {
    conflict("dns-leak", "The DNS request succeeded during the tunnel break; isolation failed.");
  }

  const restored = objectOrEmpty(evidence.restored);
  const restoredReady = allTrue(restored, ["tunnelUp", "expectedTunnelEgress"]);
  gate("tunnel-restored", restoredReady, "Record expected tunnel egress after restoration.");

  const routeAudit = objectOrEmpty(evidence.routeAudit);
  const routeAuditReady = allTrue(routeAudit, ["noDirectDefaultRoute", "firewallRestrictsEgress"]);
  gate("route-firewall-audit", routeAuditReady, "Record that no direct default route exists and the gateway firewall restricts egress.");

  const peerValidationRequested = preferences.peerValidationRequested === true;
  if (peerValidationRequested) {
    const legalPeerTest = objectOrEmpty(evidence.legalPeerTest);
    const legalPeerReady = allTrue(legalPeerTest, ["authorized", "controlledFixture", "observedPeerUsesTunnel"]);
    gate("legal-peer-test", legalPeerReady, "Use only an explicitly authorized controlled fixture and record its peer egress result.");
  }

  const verified = supportedModes.has(mode)
    && exactScope
    && lanControlReady
    && validPrivateBind(preferences.webUiBind)
    && secretReferenceReady
    && preferences.legalContentOnly === true
    && topologyReady
    && healthyReady
    && tunnelBreakReady
    && restoredReady
    && routeAuditReady
    && conflicts.length === 0
    && gates.every((item) => item.status === "pass");

  let verificationState = "not-verified";
  if (conflicts.some((item) => item.id === "egress-leak" || item.id === "dns-leak")) {
    verificationState = "failed";
  } else if (verified) {
    verificationState = "network-verified";
  }

  let status = "blocked";
  if (verified) {
    status = "pass";
  }
  if (conflicts.length > 0) {
    status = "conflict";
  }

  let allowedClaim = "No safety or verification claim is allowed until every evidence gate passes.";
  if (verified) {
    allowedClaim = "Downloader tunnel egress and fail-closed kill-switch evidence passed at the recorded time.";
  }

  let plannedWebUiPort = null;
  if (Number.isInteger(webUiPort)) {
    plannedWebUiPort = webUiPort;
  }
  let plannedWebUiBind = null;
  if (validPrivateBind(preferences.webUiBind)) {
    plannedWebUiBind = preferences.webUiBind;
  }
  let plannedLanCidrs = [];
  if (lanControlReady) {
    plannedLanCidrs = [...lanControlCidrs].sort();
  }
  let recordedAt = null;
  if (tunnelBreakReady) {
    recordedAt = tunnelBreak.recordedAt;
  }
  let peerValidation = "not-requested";
  if (peerValidationRequested) {
    peerValidation = "requested";
  }

  const plan = {
    schemaVersion: 1,
    planner: "selfhost-vpn",
    status,
    authority: "read-only-plan",
    providerPolicy: "user-chosen-or-existing; no provider ranking",
    service: { id: serviceId, class: serviceClass },
    topology: {
      mode,
      gatewayService,
      vpnScope: [serviceId],
      downloaderNetworkMode: `service:${gatewayService || "gateway-pending"}`,
      downloaderPublishesPorts: false,
      webUiPublishedBy: gatewayService || "gateway-pending",
      webUiPort: plannedWebUiPort,
      webUiBind: plannedWebUiBind,
      lanControlCidrs: plannedLanCidrs,
      controlPlaneRoute: "normal-private-network",
      gatewayRequirements: ["TUN device", "network administration", "fail-closed firewall", "tunnel DNS"],
      secretReference: {
        provided: secretReferenceReady,
        payloadIncluded: false,
      },
    },
    gates,
    conflicts,
    decisionsNeeded: [...new Set(decisionsNeeded)],
    verification: {
      state: verificationState,
      safeClaimAllowed: verified,
      tunnelBreakRecorded: tunnelBreakReady,
      recordedAt,
      claim: allowedClaim,
      scope: "Recorded downloader egress and kill-switch behavior only; not anonymity, provider trust, legal advice, or future behavior.",
    },
    legalUse: {
      scope: "Authorized legal content and controlled test fixtures only.",
      peerValidation,
    },
    claims: {
      applied: false,
      dockerMutated: false,
      credentialsHandled: false,
    },
  };
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

main();
