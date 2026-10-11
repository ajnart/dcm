import json
import os
import re
import shutil
import subprocess
import tempfile


def check_cli():
    proc = subprocess.run(
        [shutil.which("claude") or "claude", "--version"],
        capture_output=True,
        text=True,
        timeout=30,
    )
    version = re.search(r"\b(\d+)\.(\d+)\.(\d+)\b", proc.stdout)
    if (
        proc.returncode
        or version is None
        or tuple(map(int, version.groups())) < (2, 1, 295)
    ):
        raise ValueError("Claude Code 2.1.295+ is required for fail-closed hooks")
    return version.group(0)


def require_result(result, code=0, stderr=""):
    if code != 0 or not isinstance(result, dict):
        detail = (
            result.get("result", "")
            if isinstance(result, dict)
            else "missing result event"
        )
        raise ValueError("Claude call failed (exit %s): %s" % (code, detail or stderr))
    if (
        result.get("type") != "result"
        or result.get("is_error") is not False
        or result.get("subtype") != "success"
    ):
        raise ValueError(
            "Claude call failed: %s"
            % (result.get("result") or result.get("errors") or result.get("subtype"))
        )
    usage = result.get("usage", {})
    if not isinstance(usage, dict) or not usage.get("output_tokens", 0):
        raise ValueError("Claude call returned no generated output tokens")
    return result


def require_run(run):
    path = os.path.join(run, "raw", "metrics.json")
    if not os.path.isfile(path):
        raise ValueError("%s: missing execution metrics" % run)
    with open(path) as f:
        metrics = json.load(f)
    if metrics.get("errors") or metrics.get("valid") is not True:
        raise ValueError("%s: invalid execution: %s" % (run, metrics.get("errors")))
    if not metrics.get("tokens", 0):
        raise ValueError("%s: no model tokens recorded" % run)
    replies = os.path.join(run, "outputs", "replies.md")
    if not os.path.isfile(replies) or not os.path.getsize(replies):
        raise ValueError("%s: missing conversation output" % run)
    return metrics


def require_iteration(directory, runs):
    if not runs:
        raise ValueError("no runs found")
    path = os.path.join(directory, "execution.json")
    if not os.path.isfile(path):
        raise ValueError("%s: missing execution manifest" % directory)
    with open(path) as f:
        execution = json.load(f)
    if (
        execution.get("valid") is not True
        or execution.get("planned") != len(runs)
        or execution.get("completed") != len(runs)
        or execution.get("failed", 0)
    ):
        raise ValueError("%s: incomplete or invalid iteration" % directory)
    for run in runs:
        require_run(run)


def check_model(model):
    env = {
        k: v
        for k, v in os.environ.items()
        if k not in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT")
    }
    temporary_root = os.environ.get("TMPDIR")
    with tempfile.TemporaryDirectory(
        prefix="self-host-eval-preflight-", dir=temporary_root
    ) as cwd:
        proc = subprocess.run(
            [
                shutil.which("claude") or os.path.expanduser("~/.local/bin/claude"),
                "-p",
                "Reply with only the word READY.",
                "--output-format",
                "json",
                "--model",
                model,
                "--setting-sources",
                "project",
                "--strict-mcp-config",
                "--tools",
                "",
                "--disable-slash-commands",
                "--no-session-persistence",
            ],
            cwd=cwd,
            env=env,
            capture_output=True,
            text=True,
            timeout=120,
        )
    result = require_result(json.loads(proc.stdout), proc.returncode, proc.stderr)
    if result.get("result", "").strip() != "READY":
        raise ValueError("model preflight returned an unexpected answer")
