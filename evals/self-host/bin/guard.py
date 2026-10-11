#!/usr/bin/env python3
"""PreToolUse hook that keeps an eval agent inside its sandbox.

Claude's Bash replays the person's shell snapshot, so PATH and HOME would
otherwise reach the real `self-host` and `~/.self-host`. This hook rewrites
every Bash command to run under `env -i` with a fake HOME and a PATH holding
only the stubs and system directories, and denies file tools outside the
sandbox. run.py passes the values through EVAL_SANDBOX, EVAL_STUBS and
SELF_HOST_EVAL_*.
"""

import json
import os
import shlex
import sys


def deny(reason):
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": reason,
                }
            }
        )
    )
    return 0


def main():
    data = json.load(sys.stdin)
    tool = data.get("tool_name", "")
    inp = data.get("tool_input", {}) or {}
    sandbox = os.environ["EVAL_SANDBOX"]
    home = os.path.join(sandbox, ".home")

    if tool == "Bash":
        # Absolute paths into the real home (the real binary, ~/.self-host,
        # the repository) are refused; only the sandbox and stubs are allowed.
        cmd = inp.get("command", "")
        rest = cmd.replace(sandbox, "").replace(os.environ["EVAL_STUBS"], "")
        real_home = os.environ.get("HOME", "/nonexistent")
        if real_home in rest or "/usr/local/" in rest or "/opt/" in rest:
            return deny(
                "That path is outside this machine's working folder; stay inside %s."
                % sandbox
            )
        # The scenario's machine: docker is on PATH only once it exists there,
        # and /etc/os-release reads the scenario's copy.
        sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
        from dockerstate import docker_state

        harness = os.environ.get("SELF_HOST_EVAL_HARNESS")
        stubs = os.environ["EVAL_STUBS"]
        path = [os.path.join(stubs, "base")]
        if docker_state(harness) != "missing":
            path.append(os.path.join(stubs, "docker"))
        root = os.path.join(sandbox, ".root")
        if os.path.isdir(root):
            for mount in ("/media/", "/mnt/", "/Volumes/"):
                cmd = cmd.replace(mount, root + mount)
        os_release = os.path.join(harness or "", "scenario", "os-release")
        if os.path.exists(os_release):
            cmd = cmd.replace("/etc/os-release", os_release)
        env = {
            "HOME": home,
            "PATH": ":".join(path) + ":/usr/bin:/bin:/usr/sbin:/sbin",
            "DOCKER_HOST": "unix:///nonexistent/docker.sock",
            "TERM": "dumb",
            "LANG": "en_US.UTF-8",
            "SELF_HOST_NO_UPDATE_CHECK": "1",
        }
        for k, v in os.environ.items():
            if k.startswith("SELF_HOST_EVAL_"):
                env[k] = v
        prefix = " ".join("%s=%s" % (k, shlex.quote(v)) for k, v in sorted(env.items()))
        wrapped = "cd %s && env -i %s /bin/bash -c %s" % (
            shlex.quote(sandbox),
            prefix,
            shlex.quote(cmd),
        )
        print(
            json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "allow",
                        "updatedInput": dict(inp, command=wrapped),
                    }
                }
            )
        )
        return 0

    path = inp.get("file_path") or inp.get("notebook_path") or inp.get("path")
    if path:
        if path.startswith("~"):
            path = os.path.join(home, path[2:])
        elif not os.path.isabs(path):
            path = os.path.join(sandbox, path)
        real = os.path.realpath(path)
        # Claude saves long tool output under its own session folder and reads
        # it back; that folder is named after the sandbox.
        slug = (
            os.path.realpath(sandbox)
            .replace("/", "-")
            .replace(".", "-")
            .replace("_", "-")
        )
        own = os.path.join(os.environ.get("HOME", ""), ".claude", "projects", slug)
        if real.startswith(own):
            return 0
        if not real.startswith(os.path.realpath(sandbox)):
            return deny(
                "Outside this machine's working folder; stay inside %s." % sandbox
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
