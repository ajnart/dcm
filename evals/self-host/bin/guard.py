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
import re
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
    if tool not in (
        "Bash",
        "Read",
        "Skill",
        "mcp__person__ask_user",
        "EndConversation",
    ):
        return deny("This tool is not available in fixture evaluations.")
    if tool == "Skill" and inp.get("skill") != "self-host":
        return deny("Only the project-local self-host router is under evaluation.")

    if tool == "Bash":
        if inp.get("run_in_background"):
            return deny(
                "Background commands cannot be collected as completed evidence."
            )
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
        path.append(os.path.dirname(os.path.realpath(sys.executable)))
        root = os.path.join(sandbox, ".root")
        if os.path.isdir(root):
            for mount in ("/media/", "/mnt/", "/Volumes/"):
                cmd = cmd.replace(mount, root + mount)
        os_release = os.path.join(harness or "", "scenario", "os-release")
        if os.path.exists(os_release):
            cmd = cmd.replace("/etc/os-release", os_release)
        temporary = os.path.join(sandbox, ".tmp")
        os.makedirs(temporary, exist_ok=True)
        env = {
            "HOME": home,
            "PATH": ":".join(path) + ":/usr/bin:/bin:/usr/sbin:/sbin",
            "DOCKER_HOST": "unix:///nonexistent/docker.sock",
            "TERM": "dumb",
            "LANG": "en_US.UTF-8",
            "TMPDIR": temporary,
            "SELF_HOST_NO_UPDATE_CHECK": "1",
        }
        for k, v in os.environ.items():
            if k.startswith("SELF_HOST_EVAL_"):
                env[k] = v
        prefix = " ".join("%s=%s" % (k, shlex.quote(v)) for k, v in sorted(env.items()))
        from isolation import isolated_command

        try:
            isolated = isolated_command(cmd, sandbox, stubs, harness)
        except ValueError as error:
            return deny(str(error))
        wrapped = "cd %s && env -i %s %s" % (
            shlex.quote(sandbox),
            prefix,
            isolated,
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
        session = data.get("session_id")
        own = os.path.join(
            os.environ.get("HOME", ""),
            ".claude",
            "projects",
            slug,
            str(session),
            "tool-results",
        )
        if (
            tool == "Read"
            and isinstance(session, str)
            and re.fullmatch(r"[a-zA-Z0-9_-]+", session)
            and os.path.commonpath((real, os.path.realpath(own)))
            == os.path.realpath(own)
        ):
            return 0
        if os.path.commonpath((real, os.path.realpath(sandbox))) != os.path.realpath(
            sandbox
        ):
            return deny(
                "Outside this machine's working folder; stay inside %s." % sandbox
            )
    if tool == "Read" and not path:
        return deny("Read requires a path inside the working folder.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
