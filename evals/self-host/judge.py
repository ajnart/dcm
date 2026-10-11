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
import tempfile
import threading

from processes import cancellation_signals, run_process
from validity import (
    check_model,
    judgment_digest,
    require_iteration,
    require_result,
    require_run,
)

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

Return a JSON object with a verdicts array, one object per assertion in order:
{{"verdicts": [{{"text": "<assertion text, verbatim>", "passed": true|false,
"evidence": "<short quote or reason>"}}]}}
"""


def judge_run(run, model, timeout, stop):
    require_run(run)
    meta = json.load(
        open(os.path.join(os.path.dirname(os.path.dirname(run)), "eval_metadata.json"))
    )
    items = [a["text"] for a in meta["assertions"] if a["check"] == "judge"]
    if not items:
        return run, "no judge assertions"
    schema = {
        "type": "object",
        "properties": {
            "verdicts": {
                "type": "array",
                "minItems": len(items),
                "maxItems": len(items),
                "items": {
                    "type": "object",
                    "properties": {
                        "text": {"type": "string", "enum": items},
                        "passed": {"type": "boolean"},
                        "evidence": {"type": "string", "minLength": 1},
                    },
                    "required": ["text", "passed", "evidence"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["verdicts"],
        "additionalProperties": False,
    }

    def read(path):
        with open(os.path.join(run, "outputs", path), errors="ignore") as f:
            return f.read()

    digest = judgment_digest(run)
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
    metrics = {"model": model, "valid": False, "timeout_seconds": timeout}
    with open(os.path.join(run, "raw", "judge-metrics.json"), "w") as output:
        json.dump(metrics, output, indent=2)
    output_path = os.path.join(run, "raw", "judge.json")
    stderr_path = os.path.join(run, "raw", "judge.stderr.txt")
    with tempfile.TemporaryDirectory() as cwd:
        with open(output_path, "w") as output, open(stderr_path, "w") as stderr:
            code = run_process(
                [
                    shutil.which("claude") or os.path.expanduser("~/.local/bin/claude"),
                    "-p",
                    prompt,
                    "--output-format",
                    "json",
                    "--json-schema",
                    json.dumps(schema),
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
                timeout=timeout,
                stop=stop,
            )
    with open(output_path) as output, open(stderr_path) as stderr:
        result = require_result(json.load(output), code, stderr.read())
    metrics = {
        "model": model,
        "valid": False,
        "timeout_seconds": timeout,
        "usage": result.get("usage", {}),
        "cost_usd": result.get("total_cost_usd"),
        "duration_ms": result.get("duration_ms"),
        "input_sha256": digest,
    }
    with open(os.path.join(run, "raw", "judge-metrics.json"), "w") as output:
        json.dump(metrics, output, indent=2)
    structured = result.get("structured_output")
    if not isinstance(structured, dict):
        raise ValueError("judge returned no structured output")
    verdicts = structured.get("verdicts")
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
    if judgment_digest(run) != digest:
        raise ValueError("judge inputs changed during the attempt")
    with open(os.path.join(run, "judged.json"), "w") as f:
        json.dump(out, f, indent=2)
    metrics["valid"] = True
    with open(os.path.join(run, "raw", "judge-metrics.json"), "w") as output:
        json.dump(metrics, output, indent=2)
    return run, "%d/%d" % (sum(o["passed"] for o in out), len(out))


def invalidate_judgments(runs, model, retain_metrics=False):
    for run in runs:
        for name in ("judged.json", "grading.json"):
            path = os.path.join(run, name)
            if os.path.isfile(path):
                os.unlink(path)
        path = os.path.join(run, "raw", "judge-metrics.json")
        metrics = {"model": model, "valid": False}
        if retain_metrics and os.path.isfile(path):
            with open(path) as source:
                metrics = json.load(source)
            metrics["valid"] = False
        with open(path, "w") as output:
            json.dump(metrics, output)


def main(stop):
    ap = argparse.ArgumentParser()
    ap.add_argument("--iteration-dir", required=True)
    ap.add_argument("--model", default="claude-opus-5-5")
    ap.add_argument("--parallel", type=int, default=4)
    ap.add_argument("--timeout", type=int, default=600, help="seconds per judge call")
    args = ap.parse_args()
    if args.parallel < 1 or args.timeout < 1:
        ap.error("--parallel and --timeout must be positive")
    runs = sorted(glob.glob(os.path.join(args.iteration_dir, "eval-*", "*", "run-*")))
    invalidate_judgments(runs, args.model)
    require_iteration(args.iteration_dir, runs)
    check_model(args.model, stop=stop)
    random.shuffle(runs)
    failed = False
    with cf.ThreadPoolExecutor(args.parallel) as pool:
        futures = []
        try:
            for run in runs:
                futures.append(
                    pool.submit(judge_run, run, args.model, args.timeout, stop)
                )
            for future in cf.as_completed(futures):
                if future.cancelled():
                    continue
                try:
                    run, msg = future.result()
                    print(
                        "%s: %s" % (os.path.relpath(run, args.iteration_dir), msg),
                        flush=True,
                    )
                except Exception as error:
                    failed = True
                    stop.set()
                    for pending in futures:
                        pending.cancel()
                    print("judgment failed: %r" % error, flush=True)
        except KeyboardInterrupt as error:
            failed = True
            print("judgment interrupted: %s" % error, flush=True)
        finally:
            stop.set()
            for pending in futures:
                pending.cancel()
    if failed:
        invalidate_judgments(runs, args.model, retain_metrics=True)
        raise SystemExit("judging failed; no partial iteration may be graded")


if __name__ == "__main__":
    stop = threading.Event()
    with cancellation_signals(stop):
        try:
            main(stop)
        except KeyboardInterrupt as error:
            raise SystemExit(str(error) or "judgment interrupted")
