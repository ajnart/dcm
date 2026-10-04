#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const directory = await mkdtemp(join(tmpdir(), "selfhost-port-probe-"));
try {
  const bin = join(directory, "bin");
  await mkdir(bin);
  const ss = join(bin, "ss");
  await writeFile(ss, `#!/bin/sh
port=10000
while [ "$port" -lt 10060 ]; do
  printf 'tcp LISTEN 0 128 127.0.0.1:%s 0.0.0.0:*\\n' "$port"
  port=$((port + 1))
done
`);
  await chmod(ss, 0o755);
  const uname = join(bin, "uname");
  await writeFile(uname, `#!/bin/sh
case "$1" in
  -s) printf 'Darwin\\n' ;;
  -m) printf 'x86_64\\n' ;;
  -r) printf 'fixture\\n' ;;
  *) printf 'Darwin\\n' ;;
esac
`);
  await chmod(uname, 0o755);
  const netstat = join(bin, "netstat");
  await writeFile(netstat, `#!/bin/sh
port=10000
while [ "$port" -lt 10060 ]; do
  printf 'tcp4 0 0 127.0.0.1.%s *.* LISTEN\\n' "$port"
  port=$((port + 1))
done
`);
  await chmod(netstat, 0o755);
  const probe = resolve(".agents/skills/self-host/workflows/selfhost-host/scripts/inspect-host.sh");
  const result = spawnSync("bash", [probe, "--skip-docker", "--limit", "50", "--check-tcp-port", "2283", "--check-tcp-port", "10055"], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  check(result.status === 0, `host probe failed: ${result.stderr}`);
  const report = JSON.parse(result.stdout);
  check(report.network.listeningPorts.truncated === true, "fixture did not exceed the general listener bound");
  check(report.network.selectedTcpPorts.state === "observed" && report.network.selectedTcpPorts.complete === true,
    "selected TCP checks were not complete");
  check(JSON.stringify(report.network.selectedTcpPorts.items) === JSON.stringify([
    { port: 2283, inUse: false }, { port: 10055, inUse: true },
  ]), "selected TCP checks did not independently prove free and occupied ports");
  const malformedTcp = join(directory, "tcp");
  const malformedTcp6 = join(directory, "tcp6");
  await writeFile(malformedTcp, "not a proc tcp table\n");
  await writeFile(malformedTcp6, "not a proc tcp6 table\n");
  const patchedProbe = join(directory, "inspect-host-malformed.sh");
  const source = await readFile(probe, "utf8");
  await writeFile(patchedProbe, source.replaceAll("/proc/net/tcp6", malformedTcp6).replaceAll("/proc/net/tcp", malformedTcp));
  await chmod(patchedProbe, 0o755);
  const failedRead = spawnSync("bash", [patchedProbe, "--skip-docker", "--check-tcp-port", "2283"], {
    encoding: "utf8",
    env: process.env,
  });
  check(failedRead.status === 0, `host probe did not return its not-observable report: ${failedRead.stderr}`);
  const failedReport = JSON.parse(failedRead.stdout);
  check(failedReport.network.selectedTcpPorts.state === "not_observable"
    && failedReport.network.selectedTcpPorts.complete === false,
  "malformed Linux listener sources were falsely reported as observed and free");
  console.log("PASS selected TCP checks stay complete beyond the general listener limit");
} finally {
  await rm(directory, { recursive: true });
}
