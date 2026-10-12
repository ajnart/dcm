import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import tempfile

from processes import run_process


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
    for name in (
        "input_tokens",
        "output_tokens",
        "cache_creation_input_tokens",
        "cache_read_input_tokens",
    ):
        value = usage.get(name, 0)
        if type(value) is not int or value < 0:
            raise ValueError("Claude call returned invalid token usage")
    for name in ("duration_ms", "total_cost_usd"):
        value = result.get(name)
        if value is not None and (
            type(value) not in (int, float) or not math.isfinite(value) or value < 0
        ):
            raise ValueError("Claude call returned invalid %s" % name)
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


def recap_criterion(meta):
    version = meta.get("judgment_schema")
    if version is None:
        return None
    if type(version) is not int or version != 2:
        raise ValueError("unsupported judgment schema")
    if meta.get("completion") != "install":
        return None
    criterion = meta.get("recap_assessment")
    if not isinstance(criterion, str) or not criterion.strip():
        raise ValueError("missing independent Recap criterion")
    return criterion


def recap_observation(metrics):
    observation = metrics.get("completion_observation")
    if (
        not isinstance(observation, dict)
        or not isinstance(observation.get("home"), str)
        or not observation["home"].strip()
        or not isinstance(observation.get("apps"), list)
        or not observation["apps"]
        or any(
            not isinstance(app, dict)
            or not isinstance(app.get("id"), str)
            or not app["id"].strip()
            or not isinstance(app.get("url"), str)
            or not app["url"].strip()
            for app in observation["apps"]
        )
    ):
        raise ValueError("missing or invalid verified Recap observation")
    return {
        "home": observation["home"],
        "apps": [
            {
                key: app[key]
                for key in ("id", "description", "url", "addresses")
                if key in app
            }
            for app in observation["apps"]
        ],
    }


def require_recap_assessment(assessment):
    if (
        not isinstance(assessment, dict)
        or type(assessment.get("passed")) is not bool
        or not isinstance(assessment.get("evidence"), str)
        or not assessment["evidence"].strip()
    ):
        raise ValueError("missing or invalid independent Recap assessment")
    return {"passed": assessment["passed"], "evidence": assessment["evidence"]}


def judgment_digest(run):
    meta_path = os.path.join(
        os.path.dirname(os.path.dirname(run)), "eval_metadata.json"
    )
    with open(meta_path) as source:
        meta = json.load(source)
    inputs = {"assertions": meta["assertions"]}
    criterion = recap_criterion(meta)
    if meta.get("judgment_schema") == 2:
        inputs.update(
            {
                "judgment_schema": 2,
                "completion": meta["completion"],
                "completion_criteria": meta["completion_criteria"],
            }
        )
    if criterion is not None:
        inputs["recap_assessment"] = criterion
        inputs["completion_observation"] = recap_observation(require_run(run))
    for name in ("replies.md", "commands.md"):
        with open(os.path.join(run, "outputs", name), "rb") as source:
            inputs[name] = hashlib.sha256(source.read()).hexdigest()
    return hashlib.sha256(json.dumps(inputs, sort_keys=True).encode()).hexdigest()


def check_model(model, stop=None):
    env = {
        k: v
        for k, v in os.environ.items()
        if k not in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT")
    }
    temporary_root = os.environ.get("TMPDIR")
    with tempfile.TemporaryDirectory(
        prefix="self-host-eval-preflight-", dir=temporary_root
    ) as cwd:
        with (
            open(os.path.join(cwd, "stdout.json"), "w+") as output,
            open(os.path.join(cwd, "stderr.txt"), "w+") as stderr,
        ):
            code = run_process(
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
                stdout=output,
                stderr=stderr,
                timeout=120,
                stop=stop,
            )
            output.seek(0)
            stderr.seek(0)
            result = require_result(json.load(output), code, stderr.read())
    if result.get("result", "").strip() != "READY":
        raise ValueError("model preflight returned an unexpected answer")
