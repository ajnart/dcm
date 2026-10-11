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
    sandbox, stubs, harness = map(os.path.realpath, (sandbox, stubs, harness))
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
    profile = "\n".join(
        [
            "(version 1)",
            "(deny default)",
            "(allow process-exec process-fork sysctl-read)",
            "(allow file-map-executable)",
            "(allow file-read-metadata)",
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
