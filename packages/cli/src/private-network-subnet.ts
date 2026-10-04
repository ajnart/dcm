const message = "Network subnet must be one canonical RFC1918 IPv4 CIDR from /24 through /28";

export function parsePrivateNetworkSubnet(value: unknown): string {
  if (typeof value !== "string") throw new Error(message);
  const match = /^((?:0|[1-9][0-9]{0,2}))\.((?:0|[1-9][0-9]{0,2}))\.((?:0|[1-9][0-9]{0,2}))\.((?:0|[1-9][0-9]{0,2}))\/(2[4-8])$/.exec(value);
  if (!match) throw new Error(message);
  const octets = match.slice(1, 5).map(Number);
  if (octets.some((octet) => octet > 255)) throw new Error(message);
  const privateAddress = octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
  if (!privateAddress) throw new Error(message);
  const size = 2 ** (32 - Number(match[5]));
  if (octets[3] % size !== 0) throw new Error(message);
  return value;
}

export function assertNonOverlappingPrivateSubnets(values: string[]): void {
  const ranges = values.map((value) => {
    parsePrivateNetworkSubnet(value);
    const [address, prefixText] = value.split("/");
    const octets = address.split(".").map(Number);
    const first = (((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3]);
    return { first, last: first + 2 ** (32 - Number(prefixText)) - 1 };
  });
  for (let left = 0; left < ranges.length; left += 1) {
    for (let right = left + 1; right < ranges.length; right += 1) {
      if (ranges[left].first <= ranges[right].last && ranges[right].first <= ranges[left].last) {
        throw new Error("Selected private network subnets overlap");
      }
    }
  }
}
