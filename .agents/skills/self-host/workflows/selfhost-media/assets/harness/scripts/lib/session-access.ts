const SERVICES = Object.freeze({
  prowlarr: { containerPort: 9696, portKey: "PROWLARR_PORT" },
  radarr: { containerPort: 7878, portKey: "RADARR_PORT" },
  sonarr: { containerPort: 8989, portKey: "SONARR_PORT" },
  qbittorrent: { containerPort: null, portKey: "QBITTORRENT_PORT" },
  jellyfin: { containerPort: 8096, portKey: "JELLYFIN_PORT" },
  seerr: { containerPort: 5055, portKey: "SEERR_PORT" },
  homarr: { containerPort: 7575, portKey: "HOMARR_PORT" },
});

const SERVICE_NAMES = Object.freeze(Object.keys(SERVICES));
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "localhost"]);

function fail(message) {
  throw new Error(message);
}

function validatePort(rawPort, label) {
  let port = rawPort;
  if (typeof rawPort === "string") {
    port = Number(rawPort);
  }
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    fail(`${label} is invalid`);
  }
  return port;
}

function validateHost(rawHost, label) {
  if (typeof rawHost !== "string" || rawHost.length === 0 || rawHost.length > 253) {
    fail(`${label} is invalid`);
  }
  if (rawHost === "0.0.0.0" || rawHost === "::" || LOOPBACK_ADDRESSES.has(rawHost)) {
    fail(`${label} must identify a non-loopback client-reachable host`);
  }
  if (rawHost.includes(":") && !/^\[[0-9a-f:]+\]$/i.test(rawHost)) {
    fail(`${label} must wrap an IPv6 address in brackets`);
  }
  if (!/^\[[0-9a-f:]+\]$/i.test(rawHost) && !/^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(rawHost)) {
    fail(`${label} is invalid`);
  }
  return rawHost;
}

function validateBindAddress(rawAddress) {
  if (rawAddress === undefined) {
    return "127.0.0.1";
  }
  if (typeof rawAddress !== "string") {
    fail("bind address is invalid");
  }
  if (rawAddress === "127.0.0.1" || rawAddress === "0.0.0.0") {
    return rawAddress;
  }
  if (/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)\d{1,3}\.\d{1,3}$/.test(rawAddress)) {
    const octets = rawAddress.split(".").map(Number);
    if (octets.every((octet) => octet >= 0 && octet <= 255)) {
      return rawAddress;
    }
  }
  fail("bind address must be loopback, 0.0.0.0, or one private IPv4 address");
}

function validateProxyUrl(rawUrl, service) {
  if (typeof rawUrl !== "string" || rawUrl.length > 2_048) {
    fail(`${service} reverse-proxy URL is invalid`);
  }
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    fail(`${service} reverse-proxy URL is invalid`);
  }
  if (
    !["http:", "https:"].includes(url.protocol)
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
    || url.pathname !== "/"
    || ["0.0.0.0", "::", "localhost", "127.0.0.1", "::1"].includes(url.hostname)
  ) {
    fail(`${service} reverse-proxy URL must be an origin on a non-loopback host`);
  }
  return url.origin;
}

export function isPrivateNetworkHost(hostname) {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) {
    const octets = hostname.split(".").map(Number);
    if (octets.some((octet) => octet < 0 || octet > 255)) {
      return false;
    }
    if (octets[0] === 10 || (octets[0] === 192 && octets[1] === 168)) {
      return true;
    }
    return octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31;
  }
  return /^\[(?:fd|fc)[0-9a-f:]*\]$/i.test(hostname);
}

export function validatePrivateProxyOrigin(rawUrl, service, privateDnsConfirmed = false) {
  const origin = validateProxyUrl(rawUrl, service);
  const hostname = new URL(origin).hostname;
  if (!isPrivateNetworkHost(hostname) && privateDnsConfirmed !== true) {
    fail(`${service} proxy hostname requires a confirmed private DNS fact`);
  }
  return origin;
}

function normalizedProxyUrls(rawUrls = {}) {
  if (!rawUrls || typeof rawUrls !== "object" || Array.isArray(rawUrls)) {
    fail("reverse-proxy URLs are invalid");
  }
  const result = {};
  for (const [service, rawUrl] of Object.entries(rawUrls)) {
    if (!Object.hasOwn(SERVICES, service)) {
      fail(`unknown reverse-proxy service: ${service}`);
    }
    result[service] = validateProxyUrl(rawUrl, service);
  }
  return result;
}

function normalizedDirectServices(rawServices) {
  if (rawServices === undefined) {
    return new Set(SERVICE_NAMES);
  }
  if (!Array.isArray(rawServices)) {
    fail("direct services are invalid");
  }
  const services = new Set();
  for (const service of rawServices) {
    if (!Object.hasOwn(SERVICES, service)) {
      fail(`unknown direct service: ${service}`);
    }
    services.add(service);
  }
  return services;
}

function sshTunnel(hostPort, service) {
  return {
    command: `ssh -N -L <local-port>:127.0.0.1:${hostPort} <ssh-user>@<server>`,
    localUrl: "http://localhost:<local-port>",
    service,
  };
}

export function sessionSshTunnel(access, selectedServices = SERVICE_NAMES) {
  if (!access || typeof access !== "object" || !access.services) {
    fail("session access is invalid");
  }
  if (!Array.isArray(selectedServices) || selectedServices.length === 0) {
    fail("SSH tunnel services are required");
  }
  const forwards = [];
  const localUrls = {};
  for (const service of selectedServices) {
    if (!Object.hasOwn(SERVICES, service) || !access.services[service]) {
      fail(`unknown SSH tunnel service: ${service}`);
    }
    const browserUrl = new URL(access.services[service].browserUrl);
    forwards.push(`-L <${service}-local-port>:127.0.0.1:${browserUrl.port}`);
    localUrls[service] = `http://localhost:<${service}-local-port>`;
  }
  return {
    command: `ssh -N ${forwards.join(" ")} <ssh-user>@<server>`,
    localUrls,
  };
}

/**
 * Resolve secret-free access metadata without inspecting the host or network.
 * `advertisedHost` is required before a non-loopback listener is represented as
 * reachable. It is an operator assertion, not connectivity evidence.
 */
export function resolveSessionAccess({
  advertisedHost,
  bindAddress,
  directServices,
  ports,
  reverseProxyUrls,
} = {}) {
  if (!ports || typeof ports !== "object" || Array.isArray(ports)) {
    fail("session ports are required");
  }
  const selectedBindAddress = validateBindAddress(bindAddress);
  const selectedDirectServices = normalizedDirectServices(directServices);
  const proxyUrls = normalizedProxyUrls(reverseProxyUrls);
  let selectedAdvertisedHost;
  if (advertisedHost !== undefined) {
    selectedAdvertisedHost = validateHost(advertisedHost, "advertised host");
  }
  if (selectedBindAddress !== "127.0.0.1" && selectedAdvertisedHost === undefined) {
    fail("a non-loopback bind requires an advertised host");
  }

  const bindings = selectedBindAddress === "127.0.0.1"
    ? ["127.0.0.1"]
    : [selectedBindAddress];
  if (selectedBindAddress !== "127.0.0.1" && selectedBindAddress !== "0.0.0.0") {
    bindings.unshift("127.0.0.1");
  }

  const services = {};
  for (const service of SERVICE_NAMES) {
    const definition = SERVICES[service];
    const hostPort = validatePort(ports[definition.portKey], definition.portKey);
    let containerPort = definition.containerPort;
    if (containerPort === null) {
      containerPort = hostPort;
    }
    let directUrl = null;
    if (
      selectedBindAddress !== "127.0.0.1"
      && selectedAdvertisedHost !== undefined
      && selectedDirectServices.has(service)
    ) {
      directUrl = `http://${selectedAdvertisedHost}:${hostPort}`;
    }
    const proxyUrl = proxyUrls[service] ?? null;
    let reachableUrl = directUrl;
    if (proxyUrl !== null) {
      reachableUrl = proxyUrl;
    }
    services[service] = {
      browserUrl: `http://127.0.0.1:${hostPort}`,
      dockerUrl: `http://${service}:${containerPort}`,
      reachableUrl,
      reverseProxyUrl: proxyUrl,
      sshTunnel: sshTunnel(hostPort, service),
    };
  }

  let exposure = "private-network";
  if (selectedBindAddress === "127.0.0.1") {
    exposure = "local";
  }
  return {
    bindAddress: selectedBindAddress,
    composeBindings: bindings,
    exposure,
    services,
  };
}

export const SESSION_ACCESS_SERVICES = SERVICE_NAMES;
