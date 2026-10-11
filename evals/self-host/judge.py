#!/usr/bin/env python3
"""Grade the judged assertions of each run with a blind `claude -p` judge.

The judge sees only what the person saw (outputs/replies.md) and the list of
commands that ran (outputs/commands.md). It never learns which configuration
produced the run, and runs are judged in a shuffled order. Writes judged.json
next to each run; checks.py merges it into grading.json.

Usage:
  python3 judge.py --iteration-dir <workspace>/iteration-N [--model claude-opus-5-5]
"""

import argparse
import concurrent.futures as cf
import glob
import json
import os
import random
import shutil
import subprocess
import tempfile

from validity import check_model, require_iteration, require_result, require_run

PROMPT = """You are grading one conversation between an assistant and a person
who wants to self-host apps on their own computer. Judge only from the material
below. Be strict: an assertion passes only when the reply clearly does what it
says. Quote the reply in your evidence.

Assertions to grade:
{assertions}

=== What the assistant said to the person ===
{replies}

=== Commands that ran (turn: tool argv) ===
{commands}

Answer with only a JSON array, one object per assertion in the same order:
[{{"text": "<assertion text, verbatim>", "passed": true|false, "evidence": "<short quote or reason>"}}]
"""


def judge_run(run, model):
    require_run(run)
    meta = json.load(
        open(os.path.join(os.path.dirname(os.path.dirname(run)), "eval_metadata.json"))
    )
    items = [a["text"] for a in meta["assertions"] if a["check"] == "judge"]
    if not items:
        return run, "no judge assertions"

    def read(path):
        with open(os.path.join(run, "outputs", path), errors="ignore") as f:
            return f.read()

    prompt = PROMPT.format(
        assertions="\n".join("%d. %s" % (i + 1, t) for i, t in enumerate(items)),
        replies=read("replies.md"),
        commands=read("commands.md"),
    )
    env = {
        k: v
        for k, v in os.environ.items()
        if k not in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT")
    }
    with tempfile.TemporaryDirectory() as cwd:
        proc = subprocess.run(
            [
                shutil.which("claude") or os.path.expanduser("~/.local/bin/claude"),
                "-p",
                prompt,
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
            timeout=600,
        )
    result = require_result(json.loads(proc.stdout), proc.returncode, proc.stderr)
    text = result["result"].strip()
    if text.startswith("```json") and text.endswith("```"):
        text = text[7:-3].strip()
    verdicts = json.loads(text)
    if not isinstance(verdicts, list) or len(verdicts) != len(items):
        raise ValueError("judge returned an incomplete verdict list")
    out = []
    for i, t in enumerate(items):
        v = verdicts[i]
        if (
            not isinstance(v, dict)
            or v.get("text") != t
            or type(v.get("passed")) is not bool
            or not isinstance(v.get("evidence"), str)
            or not v["evidence"].strip()
        ):
            raise ValueError("judge returned an invalid verdict for %r" % t)
        out.append(
            {
                "text": t,
                "passed": bool(v.get("passed")),
                "evidence": v.get("evidence", ""),
            }
        )
    with open(os.path.join(run, "judged.json"), "w") as f:
        json.dump(out, f, indent=2)
    return run, "%d/%d" % (sum(o["passed"] for o in out), len(out))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--iteration-dir", required=True)
    ap.add_argument("--model", default="claude-opus-5-5")
    ap.add_argument("--parallel", type=int, default=4)
    args = ap.parse_args()
    runs = sorted(glob.glob(os.path.join(args.iteration_dir, "eval-*", "*", "run-*")))
    require_iteration(args.iteration_dir, runs)
    check_model(args.model)
    random.shuffle(runs)
    with cf.ThreadPoolExecutor(args.parallel) as pool:
        for run, msg in pool.map(lambda r: judge_run(r, args.model), runs):
            print(
                "%s: %s" % (os.path.relpath(run, args.iteration_dir), msg), flush=True
            )


if __name__ == "__main__":
    main()
