#!/usr/bin/env python3
"""Run the self-host skill evals as real `claude -p` conversations.

Each run gets an empty sandbox outside the repository, so no AGENTS.md,
CLAUDE.md, guide file or fixture is reachable from the agent's working
directory. `self-host` and `docker` on PATH are the stubs in bin/; the real
binaries are not on PATH and Bash is limited to a short allowlist, so the real
Project cannot be touched. Turns are sent one by one with --resume.

Output follows the skill-creator workspace layout, so its aggregate_benchmark
and generate_review scripts work unchanged:

  <workspace>/iteration-N/eval-<id>-<name>/eval_metadata.json
  <workspace>/iteration-N/eval-<id>-<name>/<config>/run-<k>/
      outputs/conversation.md   what happened, turn by turn
      outputs/replies.md        only what the agent said to the person
      outputs/commands.md       every self-host and docker call
      raw/turn-<n>.jsonl        the stream-json transcript
      raw/invocations.jsonl, raw/docker.jsonl, raw/metrics.json
      timing.json

Usage:
  python3 run.py --iteration 2
  python3 run.py --iteration 2 --runs 1 --evals 0 --configs with_skill=skills/self-host
  python3 run.py --iteration 3 --configs new_skill=skills/self-host old_skill=/tmp/snap
"""

import argparse
import concurrent.futures as cf
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

from validity import check_model, require_result

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
STUBS = os.path.join(HERE, "bin")
DEFAULT_WORKSPACE = os.path.join(
    os.environ.get("XDG_CACHE_HOME", os.path.expanduser("~/.cache")),
    "self-host-skill-evals",
)
TOKEN_SENTINEL = "EVAL-SENTINEL-CF-TOKEN-5528"


PREAMBLE = (
    "(Eval note: the person is not watching live. Reply to each message as you "
    "would in a real chat, then stop and wait for their answer. Your shell runs "
    "on the person's own machine, the one they describe; the platform in your "
    "system details is the relay you run from, so ignore it.)\n\n"
)


def parse_configs(specs):
    out = []
    for spec in specs:
        name, _, src = spec.partition("=")
        src = src or "none"
        guide = os.path.join(REPO, "internal", "skill", "guide.md")
        if ":" in src:
            src, guide = src.split(":", 1)
        if src != "none" and not os.path.isabs(src):
            src = os.path.join(REPO, src)
        if not os.path.isabs(guide):
            guide = os.path.join(REPO, guide)
        out.append(
            {"name": name, "skill": None if src == "none" else src, "guide": guide}
        )
    return out


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


HOST_TOOLS = (
    "uname",
    "hostname",
    "sw_vers",
    "lsb_release",
    "sudo",
    "curl",
    "wget",
    "apt",
    "apt-get",
    "brew",
    "winget",
    "dnf",
    "pacman",
    "systemctl",
    "usermod",
    "newgrp",
    "groupadd",
    "open",
    "xdg-open",
    "osascript",
    "service",
)


def install_stubs(ws):
    """Copy the stubs out of the repository, so `which` does not point at it.

    base/ is always on PATH; docker/ only once the scenario's machine has
    Docker (bin/guard.py decides per command).
    """
    stubs = os.path.join(ws, "_stubs")
    if os.path.isdir(stubs):
        shutil.rmtree(stubs)
    base, dock = os.path.join(stubs, "base"), os.path.join(stubs, "docker")
    for d in (base, dock):
        os.makedirs(d, exist_ok=True)
    for name in (
        "self-host",
        "hosttool",
        "guard.py",
        "dockerstate.py",
        "ask_user_mcp.py",
    ):
        shutil.copy(os.path.join(STUBS, name), os.path.join(base, name))
    for name in ("docker", "dockerstate.py"):
        shutil.copy(os.path.join(STUBS, name), os.path.join(dock, name))
    for d, names in ((base, ("self-host", "hosttool")), (dock, ("docker",))):
        for name in names:
            os.chmod(os.path.join(d, name), 0o755)
    for tool in HOST_TOOLS:
        link = os.path.join(base, tool)
        if not os.path.lexists(link):
            os.symlink("hosttool", link)
    return stubs


def prepare(ws, iteration, ev, config, k):
    tag = "eval-%d-%s/%s/run-%d" % (ev["id"], ev["name"], config["name"], k)
    run = os.path.join(ws, "iteration-%d" % iteration, tag)
    slug = tag.replace("/", "--")
    sandbox = os.path.join(ws, "_sandboxes", "iteration-%d" % iteration, slug)
    harness = os.path.join(ws, "_harness", "iteration-%d" % iteration, slug)
    for d in (run, sandbox, harness):
        if os.path.isdir(d):
            shutil.rmtree(d)
    os.makedirs(os.path.join(run, "outputs"))
    os.makedirs(os.path.join(run, "raw"))
    # generate_review.py looks for the prompt in the run folder or its parent.
    shutil.copy(
        os.path.join(os.path.dirname(os.path.dirname(run)), "eval_metadata.json"), run
    )
    os.makedirs(os.path.join(sandbox, ".home"))
    os.makedirs(os.path.join(harness, "state"))
    stubs = os.path.join(ws, "_stubs")  # installed once by main()
    write_json(
        os.path.join(sandbox, ".claude", "settings.json"),
        {
            "hooks": {
                "PreToolUse": [
                    {
                        "matcher": "Bash|Read|Write|Edit|MultiEdit|Glob|Grep|NotebookEdit",
                        "hooks": [
                            {
                                "type": "command",
                                "command": "/usr/bin/python3 %s"
                                % os.path.join(stubs, "base", "guard.py"),
                            }
                        ],
                    }
                ]
            }
        },
    )

    # The harness owns a frozen copy of the guide so editing guide.md mid-run
    # cannot change what earlier runs saw.
    shutil.copy(config["guide"], os.path.join(harness, "guide.md"))
    write_json(
        os.path.join(harness, "config.json"),
        {"guide": os.path.join(harness, "guide.md"), "version": "dev-eval"},
    )
    os.symlink(
        os.path.join(HERE, "scenarios", ev["scenario"]),
        os.path.join(harness, "scenario"),
    )
    open(os.path.join(harness, "invocations.jsonl"), "w").close()
    write_json(
        os.path.join(harness, "mcp.json"),
        {
            "mcpServers": {
                "person": {
                    "command": "/usr/bin/python3",
                    "args": [os.path.join(stubs, "base", "ask_user_mcp.py")],
                }
            }
        },
    )

    # The person's drives, under .root; bin/guard.py maps /media, /mnt and
    # /Volumes there so `ls /media/...` works on the eval Mac.
    plat = os.path.join(HERE, "scenarios", ev["scenario"], "platform.json")
    for d in json.load(open(plat)).get("dirs", []) if os.path.exists(plat) else []:
        folder = os.path.join(sandbox, ".root", d.lstrip("/"))
        os.makedirs(folder)
        for film in (
            "Arrival (2016).mkv",
            "Paddington 2 (2017).mkv",
            "The Iron Giant (1999).mp4",
        ):
            open(os.path.join(folder, film), "w").close()
    if config["skill"]:
        dest = os.path.join(sandbox, ".claude", "skills", "self-host")
        shutil.copytree(config["skill"], dest)
    with open(os.path.join(sandbox, "cloudflare-token"), "w") as f:
        f.write(TOKEN_SENTINEL + "\n")
    os.chmod(os.path.join(sandbox, "cloudflare-token"), 0o600)
    return run, sandbox, harness


def claude_turn(message, sandbox, harness, turn, model, session, out_path, timeout):
    env = {
        k: v
        for k, v in os.environ.items()
        if k not in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT")
        and not k.startswith("SELF_HOST_")
    }
    # bin/guard.py rewrites every Bash call to run under env -i with these.
    env["EVAL_SANDBOX"] = sandbox
    env["EVAL_STUBS"] = os.path.join(
        os.path.dirname(os.path.dirname(harness.rstrip("/"))), "..", "_stubs"
    )
    env["EVAL_STUBS"] = os.path.realpath(env["EVAL_STUBS"])
    env["SELF_HOST_EVAL_HARNESS"] = harness
    env["SELF_HOST_EVAL_TURN"] = str(turn)
    cmd = [
        shutil.which("claude") or os.path.expanduser("~/.local/bin/claude"),
        "-p",
        message,
        "--output-format",
        "stream-json",
        "--verbose",
        "--model",
        model,
        "--setting-sources",
        "project",
        "--strict-mcp-config",
        "--mcp-config",
        os.path.join(harness, "mcp.json"),
        "--permission-mode",
        "bypassPermissions",
    ]
    if session:
        cmd += ["--resume", session]
    started = time.time()
    with open(out_path, "w") as out:
        proc = subprocess.run(
            cmd,
            cwd=sandbox,
            env=env,
            stdout=out,
            stderr=subprocess.PIPE,
            text=True,
            timeout=timeout,
        )
    events = []
    with open(out_path) as f:
        for line in f:
            line = line.strip()
            if line.startswith("{"):
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return events, time.time() - started, proc.returncode, proc.stderr[-2000:]


def text_of(content):
    if isinstance(content, str):
        return content
    parts = []
    for c in content or []:
        if c.get("type") == "text":
            parts.append(c.get("text", ""))
        elif c.get("type") == "tool_result":
            parts.append(text_of(c.get("content")))
    return "\n".join(parts)


def render(turns_log):
    conv, replies = [], []
    for t in turns_log:
        conv.append("## Person (turn %d)\n\n%s\n" % (t["turn"], t["message"]))
        replies.append(
            "## Person (turn %d)\n\n%s\n\n## Agent (turn %d)\n"
            % (t["turn"], t["message"], t["turn"])
        )
        for ev in t["events"]:
            if ev.get("type") == "system" and ev.get("subtype") == "init":
                skills = ev.get("skills") or [
                    s for s in ev.get("slash_commands", []) if "self-host" in s
                ]
                conv.append(
                    "_session %s; self-host skill visible: %s_\n"
                    % (ev.get("session_id"), "self-host" in json.dumps(skills))
                )
            elif ev.get("type") == "assistant":
                for c in ev.get("message", {}).get("content", []):
                    if c.get("type") == "text" and c.get("text", "").strip():
                        conv.append("**Agent:** %s\n" % c["text"].strip())
                        replies.append(c["text"].strip() + "\n")
                    elif c.get("type") == "tool_use" and c.get("name", "").endswith(
                        "ask_user"
                    ):
                        q = c.get("input", {})
                        opts = "".join(
                            "\n  - [ ] %s" % o.get("label", "")
                            for o in q.get("options") or []
                        )
                        conv.append(
                            "**Agent asks:** %s%s\n" % (q.get("question", ""), opts)
                        )
                        replies.append(
                            "**Asks:** %s%s\n" % (q.get("question", ""), opts)
                        )
                    elif c.get("type") == "tool_use":
                        conv.append(
                            "```tool %s\n%s\n```\n"
                            % (
                                c.get("name"),
                                json.dumps(c.get("input"), indent=1)[:1500],
                            )
                        )
            elif ev.get("type") == "user":
                for c in ev.get("message", {}).get("content", []) or []:
                    if isinstance(c, dict) and c.get("type") == "tool_result":
                        body = text_of(c.get("content"))
                        if len(body) > 1500:
                            body = body[:1500] + "\n... (%d more chars)" % (
                                len(body) - 1500
                            )
                        conv.append(
                            "```result%s\n%s\n```\n"
                            % (" (error)" if c.get("is_error") else "", body)
                        )
            elif ev.get("type") == "result":
                for d in ev.get("permission_denials") or []:
                    conv.append(
                        "_denied: %s %s_\n"
                        % (d.get("tool_name"), json.dumps(d.get("tool_input"))[:300])
                    )
    return "\n".join(conv), "\n".join(replies)


MAX_TURNS = 8

PERSON_PROMPT = """You are playing a person chatting with an AI assistant that can
run commands on your computer. Stay in character.

Who you are and what you know:
{persona}

The conversation so far (your messages are "Person", the assistant's are "Agent";
"Asks:" lines are questions shown to you with buttons):
{conversation}

Write your next message. Rules:
- Answer only what the assistant asked, briefly and in your own plain words, as
  this person would. When it offered buttons, answer with one button's label.
- Use only facts from your description. If asked something you don't know, say so.
- If it asks to do something on your machine and the plan fits what you want,
  agree clearly. Refuse anything you said you don't want.
- If it asks you to do something yourself (in a browser, in Windows), say you did it.
- If the assistant has finished and asked you nothing, you are done.

Reply with only JSON:
{{"reply": "<your message, empty when done>",
  "approves": <true when this message gives permission to change something>,
  "done": <true when there is nothing left to answer>}}
"""


def person_reply(ev, conversation, turn, model):
    """Play the person: answer what the agent actually asked, from the persona."""
    env = {
        k: v
        for k, v in os.environ.items()
        if k not in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT")
    }
    prompt = PERSON_PROMPT.format(persona=ev["persona"], conversation=conversation)
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
            timeout=300,
        )
    result = require_result(json.loads(proc.stdout), proc.returncode, proc.stderr)
    text = result["result"].strip()
    if text.startswith("```json") and text.endswith("```"):
        text = text[7:-3].strip()
    answer = json.loads(text)
    if not isinstance(answer, dict) or not isinstance(answer.get("reply"), str):
        raise ValueError("simulated person returned no reply string")
    if type(answer.get("approves")) is not bool or type(answer.get("done")) is not bool:
        raise ValueError("simulated person returned invalid approval/completion flags")
    if not answer["done"] and not answer["reply"].strip():
        raise ValueError("simulated person returned an empty unfinished reply")
    answer["turn"] = turn
    answer["usage"] = result.get("usage", {})
    answer["cost_usd"] = result.get("total_cost_usd", 0.0)
    return answer


def write_jsonl(path, items):
    with open(path, "w") as f:
        for item in items:
            f.write(json.dumps(item) + "\n")


def read_jsonl(path):
    if not os.path.exists(path):
        return []
    with open(path) as f:
        return [json.loads(line) for line in f if line.strip()]


def run_one(ws, iteration, ev, config, k, model, timeout, person_model):
    run, sandbox, harness = prepare(ws, iteration, ev, config, k)
    session, turns_log = None, []
    total = {
        "duration_ms": 0,
        "tokens": 0,
        "cost_usd": 0.0,
        "denials": [],
        "errors": [],
    }
    person_log = []
    msg, i = ev["first_message"], 0
    while msg is not None and i < ev.get("max_turns", MAX_TURNS):
        i += 1
        message = (PREAMBLE + msg) if i == 1 else msg
        try:
            events, secs, code, err = claude_turn(
                message,
                sandbox,
                harness,
                i,
                model,
                session,
                os.path.join(run, "raw", "turn-%d.jsonl" % i),
                timeout,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            total["errors"].append({"turn": i, "source": "agent", "error": str(error)})
            break
        turns_log.append({"turn": i, "message": msg, "events": events})
        result = next((e for e in reversed(events) if e.get("type") == "result"), None)
        init = next((e for e in events if e.get("type") == "system"), None)
        session = (result or init or {}).get("session_id", session)
        try:
            require_result(result, code, err)
        except ValueError as error:
            total["errors"].append({"turn": i, "source": "agent", "error": str(error)})
            break
        if result:
            u = result.get("usage", {})
            total["duration_ms"] += result.get("duration_ms", int(secs * 1000))
            total["tokens"] += sum(
                u.get(x, 0)
                for x in (
                    "input_tokens",
                    "output_tokens",
                    "cache_creation_input_tokens",
                    "cache_read_input_tokens",
                )
            )
            total["cost_usd"] += result.get("total_cost_usd", 0.0) or 0.0
            total["denials"] += [
                dict(d, turn=i) for d in result.get("permission_denials") or []
            ]
        else:
            total["duration_ms"] += int(secs * 1000)
        if session is None:
            total["errors"].append(
                {"turn": i, "source": "agent", "error": "missing session ID"}
            )
            break
        if i >= ev.get("max_turns", MAX_TURNS):
            break
        _, replies_so_far = render(turns_log)
        try:
            answer = person_reply(ev, replies_so_far, i + 1, person_model)
        except (ValueError, KeyError, OSError, subprocess.TimeoutExpired) as error:
            total["errors"].append(
                {"turn": i + 1, "source": "person", "error": str(error)}
            )
            break
        person_log.append(answer)
        msg = None if answer.get("done") else answer.get("reply") or None

    write_jsonl(os.path.join(run, "raw", "person.jsonl"), person_log)
    conv, replies = render(turns_log)
    with open(os.path.join(run, "outputs", "conversation.md"), "w") as f:
        f.write(conv)
    with open(os.path.join(run, "outputs", "replies.md"), "w") as f:
        f.write(replies)
    for name in ("invocations.jsonl", "docker.jsonl", "host.jsonl", "ask.jsonl"):
        src = os.path.join(harness, name)
        if os.path.exists(src):
            shutil.copy(src, os.path.join(run, "raw", name))
    calls = sorted(
        (c.get("ts", 0), c.get("turn", 1), " ".join(prefix + c["argv"]))
        for prefix, name in (
            (["self-host"], "invocations.jsonl"),
            (["docker"], "docker.jsonl"),
            ([], "host.jsonl"),
        )
        for c in read_jsonl(os.path.join(harness, name))
    )
    cmds = ["turn %d: %s" % (turn, line) for _, turn, line in calls]
    with open(os.path.join(run, "outputs", "commands.md"), "w") as f:
        f.write(
            "\n".join(cmds) + "\n" if cmds else "(no self-host or docker command)\n"
        )
    total["skill_visible"] = "self-host skill visible: True" in conv
    total["valid"] = not total["errors"]
    write_json(os.path.join(run, "raw", "metrics.json"), total)
    write_json(
        os.path.join(run, "timing.json"),
        {
            "total_tokens": total["tokens"],
            "duration_ms": total["duration_ms"],
            "total_duration_seconds": round(total["duration_ms"] / 1000, 1),
            "cost_usd": round(total["cost_usd"], 4),
        },
    )
    if not total["valid"]:
        raise ValueError(
            "%s/%s/run-%d: %s" % (ev["name"], config["name"], k, total["errors"])
        )
    return "%s/%s/run-%d: %d turns, %d cmds, %d denials, %d errors" % (
        ev["name"],
        config["name"],
        k,
        len(turns_log),
        len(cmds),
        len(total["denials"]),
        len(total["errors"]),
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--iteration", type=int, required=True)
    ap.add_argument("--workspace", default=DEFAULT_WORKSPACE)
    ap.add_argument(
        "--configs",
        nargs="+",
        default=["with_skill=skills/self-host", "without_skill=none"],
        help="name=SKILL_DIR|none[:GUIDE_PATH]; the first is the one under test",
    )
    ap.add_argument("--evals", default="", help="comma-separated eval ids")
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--model", default="claude-sonnet-5-5")
    ap.add_argument(
        "--person-model",
        default="claude-sonnet-5-5",
        help="model that plays the person from the eval's persona",
    )
    ap.add_argument("--parallel", type=int, default=4)
    ap.add_argument("--timeout", type=int, default=900, help="seconds per turn")
    args = ap.parse_args()

    if os.path.realpath(args.workspace).startswith(os.path.realpath(REPO)):
        sys.exit(
            "workspace must be outside the repository, or the agent reads AGENTS.md"
        )
    iteration_dir = os.path.join(args.workspace, "iteration-%d" % args.iteration)
    if os.path.exists(iteration_dir):
        ap.error(
            "iteration already exists; choose a new --iteration to preserve its evidence"
        )
    if args.runs < 1 or args.parallel < 1:
        ap.error("--runs and --parallel must be positive")
    for model in dict.fromkeys((args.model, args.person_model)):
        check_model(model)
    evals = json.load(open(os.path.join(HERE, "evals", "evals.json")))
    wanted = {int(x) for x in args.evals.split(",") if x.strip()}
    configs = parse_configs(args.configs)
    jobs = []
    for ev in evals["evals"]:
        if wanted and ev["id"] not in wanted:
            continue
        edir = os.path.join(
            args.workspace,
            "iteration-%d" % args.iteration,
            "eval-%d-%s" % (ev["id"], ev["name"]),
        )
        write_json(
            os.path.join(edir, "eval_metadata.json"),
            {
                "eval_id": ev["id"],
                "eval_name": ev["name"],
                "scenario": ev["scenario"],
                "prompt": "%s\n\n---\nThe person (played by a model):\n%s"
                % (ev["first_message"], ev["persona"]),
                "assertions": ev["assertions"],
            },
        )
        for config in configs:
            for k in range(1, args.runs + 1):
                jobs.append((ev, config, k))

    write_json(
        os.path.join(
            args.workspace, "iteration-%d" % args.iteration, "run_config.json"
        ),
        {
            "model": args.model,
            "runs": args.runs,
            "configs": [
                {"name": c["name"], "skill": c["skill"], "guide": c["guide"]}
                for c in configs
            ],
            "started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        },
    )
    if not jobs:
        ap.error("no evals selected")
    write_json(
        os.path.join(iteration_dir, "execution.json"),
        {"valid": False, "planned": len(jobs), "completed": 0},
    )
    install_stubs(args.workspace)
    with cf.ThreadPoolExecutor(args.parallel) as pool:
        futs = [
            pool.submit(
                run_one,
                args.workspace,
                args.iteration,
                ev,
                c,
                k,
                args.model,
                args.timeout,
                args.person_model,
            )
            for ev, c, k in jobs
        ]
        failed = 0
        completed = 0
        for fut in cf.as_completed(futs):
            if fut.cancelled():
                failed += 1
                continue
            try:
                print(fut.result(), flush=True)
                completed += 1
            except Exception as e:  # keep the batch going, but fail the command
                failed += 1
                print("run failed: %r" % (e,), flush=True)
                for pending in futs:
                    pending.cancel()
    write_json(
        os.path.join(iteration_dir, "execution.json"),
        {
            "valid": not failed,
            "planned": len(jobs),
            "completed": completed,
            "failed": failed,
        },
    )
    print(os.path.join(args.workspace, "iteration-%d" % args.iteration))
    if failed:
        sys.exit(
            "%d of %d runs failed; not grading a partial iteration"
            % (failed, len(jobs))
        )


if __name__ == "__main__":
    main()
