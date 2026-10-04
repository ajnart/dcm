export type MediaNetworkSubnets = {
  default: string;
  web: string;
};

type ParsedSubnet = {
  cidr: string;
  first: number;
  last: number;
};

const subnetError = "Media network subnets must be distinct non-overlapping canonical RFC1918 IPv4 CIDRs from /24 through /28";

function fail(): never {
  throw new Error(subnetError);
}

function parseSubnet(value: unknown): ParsedSubnet {
  if (typeof value !== "string") fail();
  const match = /^((?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2}))\/(2[4-8])$/.exec(value);
  if (!match) fail();
  const octets = match[1].split(".").map(Number);
  if (octets.some((octet) => octet > 255)) fail();
  const privateAddress = octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
  if (!privateAddress) fail();
  const prefix = Number(match[2]);
  const first = (((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3]);
  const size = 2 ** (32 - prefix);
  if (first % size !== 0) fail();
  return { cidr: value, first, last: first + size - 1 };
}

export function parseMediaNetworkSubnets(value: unknown): MediaNetworkSubnets {
  let defaultValue: unknown;
  let webValue: unknown;
  if (typeof value === "string") {
    const parts = value.split(",");
    if (parts.length !== 2) fail();
    [defaultValue, webValue] = parts;
  } else if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(["default", "web"])) fail();
    defaultValue = record.default;
    webValue = record.web;
  } else {
    fail();
  }
  const defaultSubnet = parseSubnet(defaultValue);
  const webSubnet = parseSubnet(webValue);
  if (defaultSubnet.first <= webSubnet.last && webSubnet.first <= defaultSubnet.last) fail();
  return { default: defaultSubnet.cidr, web: webSubnet.cidr };
}
