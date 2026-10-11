import json
import os
import shlex
import shutil
import sys


def isolated_command(command, sandbox, stubs, harness):
    if sys.platform != "darwin" or not shutil.which("sandbox-exec"):
        raise ValueError(
            "OS shell isolation requires macOS sandbox-exec; "
            "unsupported hosts are refused"
        )
    original_paths = (sandbox, stubs, harness)
    sandbox, stubs, harness = map(os.path.realpath, original_paths)
    readable = [
        "/System/Library",
        "/System/Volumes/Preboot/Cryptexes/OS",
        "/usr/bin",
        "/usr/sbin",
        "/usr/lib",
        "/usr/share",
        "/bin",
        "/sbin",
        "/Library/Developer/CommandLineTools",
        sandbox,
        stubs,
        os.path.join(harness, "scenario"),
        os.path.join(harness, "state"),
    ]
    paths = " ".join(
        "(subpath %s)" % json.dumps(os.path.realpath(path)) for path in readable
    )
    parents = set()
    for path in (*readable, *original_paths):
        parent = os.path.dirname(path)
        while parent != "/":
            parents.add(parent)
            parent = os.path.dirname(parent)
    host_commands = (
        "/usr/bin/sudo",
        "/usr/bin/curl",
        "/usr/bin/osascript",
        "/usr/bin/open",
        "/usr/bin/ssh",
        "/usr/bin/scp",
        "/usr/bin/sftp",
        "/usr/bin/nc",
        "/usr/bin/security",
        "/usr/bin/defaults",
        "/bin/launchctl",
        "/usr/sbin/installer",
        "/sbin/shutdown",
        "/sbin/reboot",
        "/usr/bin/killall",
        "/usr/bin/uname",
        "/bin/hostname",
        "/usr/bin/sw_vers",
        "/usr/bin/arch",
        "/bin/ls",
        "/usr/bin/stat",
        "/usr/bin/file",
        "/usr/bin/du",
        "/bin/df",
        "/sbin/mount",
        "/usr/sbin/diskutil",
        "/usr/sbin/sysctl",
        "/usr/sbin/system_profiler",
        "/usr/sbin/ioreg",
        "/sbin/ifconfig",
        "/usr/sbin/scutil",
        "/bin/ps",
        "/usr/bin/top",
        "/usr/bin/id",
        "/usr/bin/whoami",
        "/usr/bin/groups",
        "/usr/bin/getconf",
        "/usr/sbin/networksetup",
        "/usr/bin/vm_stat",
    )
    profile = "\n".join(
        [
            "(version 1)",
            "(deny default)",
            "(allow process-exec process-fork)",
            "(deny process-exec %s)"
            % " ".join("(literal %s)" % json.dumps(path) for path in host_commands),
            "(allow file-map-executable)",
            "(allow file-read-metadata %s)"
            % " ".join("(literal %s)" % json.dumps(path) for path in sorted(parents)),
            '(allow file-read* %s (literal %s) (literal %s) (literal "/") '
            '(literal "/dev/null") (literal "/dev/urandom"))'
            % (
                paths,
                json.dumps(os.path.join(harness, "guide.md")),
                json.dumps(os.path.join(harness, "config.json")),
            ),
            '(allow file-write* (subpath %s) (subpath %s) (literal "/dev/null"))'
            % (json.dumps(sandbox), json.dumps(os.path.join(harness, "state"))),
            "(deny file-write* (subpath %s))"
            % json.dumps(os.path.join(sandbox, ".claude")),
            "(allow file-write* %s)"
            % " ".join(
                "(literal %s)" % json.dumps(os.path.join(harness, name))
                for name in ("invocations.jsonl", "host.jsonl", "docker.jsonl")
            ),
        ]
    )
    return "/usr/bin/sandbox-exec -p %s /bin/bash -c %s" % (
        shlex.quote(profile),
        shlex.quote(command),
    )
