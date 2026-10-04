#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const directory = await mkdtemp(join(tmpdir(), "selfhost-route-probe-"));
try {
  const bin = join(directory, "bin");
  await mkdir(bin);
  const ip = join(bin, "ip");
  await writeFile(ip, `#!/bin/sh
printf '2: eth0    inet 192.168.50.12/24 brd 192.168.50.255 scope global eth0\\n'
printf '3: wg0    inet 100.101.102.103/32 scope global wg0\\n'
printf '4: eth1    inet 10.2.3.4/16 scope global eth1\\n'
printf '5: eth2    inet 203.0.113.7/24 scope global eth2\\n'
printf '6: docker0    inet 172.17.0.1/16 scope global docker0\\n'
printf '7: br-123abc    inet 192.168.48.1/20 scope global br-123abc\\n'
`);
  await chmod(ip, 0o755);
  const probe = resolve(".agents/skills/self-host/workflows/selfhost-host/scripts/inspect-host.sh");
  const result = spawnSync("bash", [probe, "--skip-docker"], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  check(result.status === 0, `host probe failed: ${result.stderr}`);
  const report = JSON.parse(result.stdout);
  check(report.network.lanIpv4Candidates.state === "observed", "LAN address probe did not run");
  check(JSON.stringify(report.network.lanIpv4Candidates.items) === JSON.stringify([
    { interface: "eth0", address: "192.168.50.12", prefixLength: 24 },
    { interface: "eth1", address: "10.2.3.4", prefixLength: 16 },
  ]), "probe did not filter public and tailnet addresses");
  check(["observed", "not_observable"].includes(report.network.dnsResolverCandidates.state),
    "resolver candidate state is invalid");
  check(Array.isArray(report.network.dnsResolverCandidates.items)
    && report.network.dnsResolverCandidates.items.length <= 4,
  "resolver candidates are not bounded");
  console.log("PASS private route discovery emits bounded host candidates only");
} finally {
  await rm(directory, { recursive: true });
}
