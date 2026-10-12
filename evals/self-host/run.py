#!/usr/bin/env python3
"""Run the self-host skill evals as real `claude -p` conversations.

Each run gets an empty working folder outside the repository and frozen inputs.
File tools are guarded; Bash runs with a clean environment inside macOS
sandbox-exec. Only fixture App operations are supported. Turns are sent one
by one with --resume.

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
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid

from checks import commands, docker_mutating, host_change, is_mutating, selected_apps
from processes import cancellation_signals, run_process
from validity import check_cli, check_model, recap_criterion, require_result

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
        if not re.fullmatch(r"[a-z][a-z0-9_-]*", name) or name in (
            "stubs",
            "scenarios",
        ):
            raise ValueError(
                "configuration name must be a simple, nonreserved directory name"
            )
        if any(c["name"] == name for c in out):
            raise ValueError("configuration names must be unique")
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


def file_digest(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


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
    "ls",
    "stat",
    "file",
    "du",
    "df",
    "mount",
    "diskutil",
    "sysctl",
    "system_profiler",
    "ioreg",
    "ifconfig",
    "scutil",
    "ps",
    "top",
    "arch",
    "id",
    "whoami",
    "groups",
    "getconf",
    "networksetup",
    "vm_stat",
)


def install_stubs(stubs):
    """Copy the stubs out of the repository, so `which` does not point at it.

    base/ is always on PATH; docker/ only once the scenario's machine has
    Docker (bin/guard.py decides per command).
    """
    base, dock = os.path.join(stubs, "base"), os.path.join(stubs, "docker")
    for d in (base, dock):
        os.makedirs(d, exist_ok=True)
    for name in (
        "self-host",
        "hosttool",
        "guard.py",
        "dockerstate.py",
        "ask_user_mcp.py",
        "isolation.py",
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
    slug = uuid.uuid4().hex
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
    stubs = os.path.join(ws, "iteration-%d" % iteration, "inputs", "stubs")
    write_json(
        os.path.join(harness, "settings.json"),
        {
            "disableBundledSkills": True,
            "hooks": {
                "PreToolUse": [
                    {
                        "matcher": "*",
                        "hooks": [
                            {
                                "type": "command",
                                "command": "/usr/bin/python3",
                                "args": [os.path.join(stubs, "base", "guard.py")],
                                "onFailure": "block",
                            }
                        ],
                    }
                ]
            },
        },
    )

    # The harness owns a frozen copy of the guide so editing guide.md mid-run
    # cannot change what earlier runs saw.
    shutil.copy(config["guide"], os.path.join(run, "raw", "guide.md"))
    shutil.copy(os.path.join(run, "raw", "guide.md"), os.path.join(harness, "guide.md"))
    write_json(
        os.path.join(harness, "config.json"),
        {
            "guide": os.path.join(harness, "guide.md"),
            "version": "dev-eval",
            "stubs": stubs,
            "home": os.path.join(sandbox, ".home", ".self-host"),
        },
    )
    scenario = os.path.join(run, "raw", "scenario")
    shutil.copytree(ev["scenario_path"], scenario)
    if os.path.isfile(os.path.join(scenario, "status.json")):
        os.makedirs(os.path.join(sandbox, ".home", ".self-host"))
    os.symlink(scenario, os.path.join(harness, "scenario"))
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
    plat = os.path.join(scenario, "platform.json")
    for d in json.load(open(plat)).get("dirs", []) if os.path.exists(plat) else []:
        folder = os.path.join(sandbox, ".root", d.lstrip("/"))
        os.makedirs(folder)
    if config["skill"]:
        dest = os.path.join(sandbox, ".claude", "skills", "self-host")
        shutil.copytree(config["skill"], dest)
        shutil.copytree(config["skill"], os.path.join(run, "raw", "router"))
    inputs = {
        "scenario": ev["scenario"],
        "guide_sha256": file_digest(os.path.join(harness, "guide.md")),
        "router_sha256": None,
    }
    if config["skill"]:
        inputs["router_sha256"] = file_digest(
            os.path.join(run, "raw", "router", "SKILL.md")
        )
    write_json(os.path.join(run, "raw", "inputs.json"), inputs)
    with open(os.path.join(sandbox, "cloudflare-token"), "w") as f:
        f.write(TOKEN_SENTINEL + "\n")
    os.chmod(os.path.join(sandbox, "cloudflare-token"), 0o600)
    return run, sandbox, harness


def claude_turn(
    message, sandbox, harness, turn, model, session, out_path, timeout, stop
):
    env = {
        k: v
        for k, v in os.environ.items()
        if k not in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT")
        and not k.startswith("SELF_HOST_")
    }
    # bin/guard.py rewrites every Bash call to run under env -i with these.
    env["EVAL_SANDBOX"] = sandbox
    with open(os.path.join(harness, "config.json")) as config:
        env["EVAL_STUBS"] = json.load(config)["stubs"]
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
        "--settings",
        os.path.join(harness, "settings.json"),
        "--tools",
        "Bash,Read,Skill",
        "--allowedTools",
        "Bash,Read,Skill,mcp__person__ask_user",
        "--no-chrome",
        "--strict-mcp-config",
        "--mcp-config",
        os.path.join(harness, "mcp.json"),
        "--permission-mode",
        "dontAsk",
    ]
    if session:
        cmd += ["--resume", session]
    started = time.monotonic()
    stderr_path = out_path.replace(".jsonl", ".stderr.txt")
    with open(out_path, "w") as out, open(stderr_path, "w") as stderr:
        code = run_process(
            cmd,
            cwd=sandbox,
            env=env,
            stdout=out,
            stderr=stderr,
            timeout=timeout,
            stop=stop,
        )
    events = []
    with open(out_path) as f:
        for line in f:
            line = line.strip()
            if line:
                event = json.loads(line)
                if not isinstance(event, dict):
                    raise ValueError("task stream contains a non-object event")
                events.append(event)
    with open(stderr_path) as stderr:
        detail = stderr.read()[-2000:]
    return events, time.monotonic() - started, code, detail


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
                            "\n  - [ ] "
                            + o.get("label", "")
                            + (": " + o["description"] if o.get("description") else "")
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
PERSON_SCHEMA = {
    "type": "object",
    "properties": {
        "reply": {"type": "string"},
        "approves": {"type": "boolean"},
        "done": {"type": "boolean"},
        "completed_steps": {
            "type": "array",
            "items": {"type": "string", "enum": ["docker_desktop_wsl"]},
            "uniqueItems": True,
        },
    },
    "required": ["reply", "approves", "done", "completed_steps"],
    "additionalProperties": False,
}

PERSON_PROMPT = """You are playing a person chatting with an AI assistant that can
run commands on your computer. Stay in character.

Who you are and what you know:
{persona}

Scenario completion criteria:
{completion_criteria}

Recorded CLI verification (synthetic observations, not browser/native acceptance):
{verification}

The conversation so far (your messages are "Person", the assistant's are "Agent";
"Asks:" lines are questions shown to you with buttons):
{conversation}

Write your next message. Rules:
- Answer only what the assistant asked, briefly and in your own plain words, as
  this person would. When it offered buttons, answer with one button's label.
- Use only facts from your description and recorded CLI observations.
  If asked something you don't know, say so.
- If it asks to do something on your machine and the plan fits what you want,
  agree clearly. Refuse anything you said you don't want.
- Only claim a manual action when your description explicitly permits that action.
  Never invent browser failures, library scans, playback or device/network observations.
  Say "I haven't checked that" when those facts are not supplied.
- completed_steps is [] unless you just finished installing Docker Desktop in
  Windows and enabling WSL integration at the assistant's request. Only then
  include "docker_desktop_wsl". Permission alone does not complete a step.
- Finish only when the scenario completion criteria are met and CLI verification
  is recorded. Ask for missing verification or handoff details rather than accepting
  an unsupported success claim. Decline optional follow-ups outside this scenario.
- Do not coach the assistant with command names, guide rules or assertion wording.
  Ask for missing outcomes in this person's plain words, not an evaluator's hints.
- done ends the conversation only; it never passes an assertion or proves acceptance.

Reply with only JSON:
{{"reply": "<your message, empty when done>",
  "approves": <true when this message gives permission to change something>,
  "done": <true when there is nothing left to answer>,
  "completed_steps": []}}
"""


def person_reply(ev, conversation, verification, turn, model, raw, timeout, stop):
    """Play the person: answer what the agent actually asked, from the persona."""
    env = {
        k: v
        for k, v in os.environ.items()
        if k not in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT")
    }
    prompt = PERSON_PROMPT.format(
        persona=ev["persona"],
        conversation=conversation,
        completion_criteria=ev["completion_criteria"],
        verification=json.dumps(verification),
    )
    output_path = os.path.join(raw, "person-%d.json" % turn)
    stderr_path = os.path.join(raw, "person-%d.stderr.txt" % turn)
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
                    json.dumps(PERSON_SCHEMA),
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
    answer = result.get("structured_output")
    if not isinstance(answer, dict) or not isinstance(answer.get("reply"), str):
        raise ValueError("simulated person returned no reply string")
    if type(answer.get("approves")) is not bool or type(answer.get("done")) is not bool:
        raise ValueError("simulated person returned invalid approval/completion flags")
    if not answer["done"] and not answer["reply"].strip():
        raise ValueError("simulated person returned an empty unfinished reply")
    steps = answer.get("completed_steps")
    if not isinstance(steps, list) or any(
        step != "docker_desktop_wsl" for step in steps
    ):
        raise ValueError("simulated person returned invalid completed steps")
    answer["turn"] = turn
    answer["usage"] = result.get("usage", {})
    answer["cost_usd"] = result.get("total_cost_usd")
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


def completion_evidence(ev, harness):
    path = os.path.join(harness, "state", "verified.json")
    if not os.path.isfile(path):
        return {"verified": False, "reason": "no successful CLI Status observation"}
    with open(path) as source:
        observation = json.load(source)
    calls = commands(read_jsonl(os.path.join(harness, "invocations.jsonl")))
    changes = [call for call in calls if is_mutating(call)]
    change_times = [call["ts"] for call in changes]
    for name, classify in (
        ("host.jsonl", host_change),
        ("docker.jsonl", docker_mutating),
    ):
        change_times.extend(
            call.get("ts", observation["ts"])
            for call in read_jsonl(os.path.join(harness, name))
            if classify(call["argv"])
        )
    statuses = [call for call in calls if call["cmd"] == "status"]
    if (
        not changes
        or not statuses
        or statuses[-1]["ts"] != observation["ts"]
        or max(change_times) >= observation["ts"]
    ):
        return {"verified": False, "reason": "CLI Status must succeed after the change"}
    status = observation["status"]
    apps = {app["id"]: app for app in status["apps"]}
    kind = ev["completion"]
    verified = False
    if kind == "install":
        verified = (
            any(call["cmd"] == "install" for call in changes)
            and "jellyfin" in apps
            and bool(apps)
            and all(
                app.get("url")
                and app.get("state") == "running"
                and app.get("health") in (None, "", "ok", "healthy")
                and app.get("setup") == "ok"
                for app in apps.values()
            )
        )
    elif kind == "lan":
        verified = (
            any(call["cmd"] == "config" for call in changes)
            and os.path.isfile(os.path.join(harness, "state", "lan_fixed"))
            and apps.get("jellyfin", {})
            .get("url", "")
            .startswith("http://" + status.get("lan_ip", "") + ":")
        )
    elif kind == "setup":
        verified = (
            any(call["cmd"] == "setup" and "sonarr" in call["pos"] for call in changes)
            and apps.get("sonarr", {}).get("setup") == "ok"
        )
    elif kind == "public":
        publication = os.path.join(harness, "state", "publication.json")
        if os.path.isfile(publication):
            with open(publication) as source:
                published = json.load(source)["publish"]
            verified = (
                any(
                    call["cmd"] == "cloudflare"
                    and call["sub"] == "publish"
                    and "paperless-ngx" in selected_apps(call["argv"])
                    for call in changes
                )
                and "cloudflare" in status.get("access", [])
                and any(app["app"] == "paperless-ngx" for app in published)
                and all(
                    apps.get(app["app"], {}).get("url") == app["address"]
                    and app["address"] in apps[app["app"]].get("addresses", [])
                    for app in published
                )
                and apps.get("jellyfin", {}).get("url", "").startswith("http://")
            )
    return {
        "verified": bool(verified),
        "reason": "CLI observations match the scenario goal"
        if verified
        else "CLI observations do not match the scenario goal",
        "status": {
            key: status[key] for key in ("home", "access", "apps") if key in status
        },
    }


def run_one(
    ws, iteration, ev, config, k, model, timeout, person_model, person_timeout, stop
):
    run, sandbox, harness = prepare(ws, iteration, ev, config, k)
    session, turns_log = None, []
    total = {
        "duration_ms": 0,
        "tokens": 0,
        "cost_usd": 0.0,
        "denials": [],
        "errors": [],
        "tool_calls": 0,
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
                stop,
            )
        except (ValueError, OSError, subprocess.TimeoutExpired) as error:
            stop.set()
            total["errors"].append({"turn": i, "source": "agent", "error": str(error)})
            break
        turns_log.append({"turn": i, "message": msg, "events": events})
        total["tool_calls"] += sum(
            block.get("type") == "tool_use"
            for event in events
            if event.get("type") == "assistant"
            for block in event.get("message", {}).get("content", [])
        )
        result = next((e for e in reversed(events) if e.get("type") == "result"), None)
        init = next(
            (
                e
                for e in events
                if e.get("type") == "system" and e.get("subtype") == "init"
            ),
            None,
        )
        session = (result or init or {}).get("session_id", session)
        try:
            require_result(result, code, err)
            generated = [
                block
                for event in events
                if event.get("type") == "assistant"
                for block in event.get("message", {}).get("content", [])
                if block.get("type") == "tool_use"
                or (block.get("type") == "text" and block.get("text", "").strip())
            ]
            if not generated:
                raise ValueError("task stream contains no assistant reply or tool call")
            visible = "self-host" in (init or {}).get("skills", [])
            if visible != bool(config["skill"]):
                raise ValueError(
                    "router discovery does not match the selected configuration"
                )
        except ValueError as error:
            stop.set()
            total["errors"].append({"turn": i, "source": "agent", "error": str(error)})
            break
        if result:
            u = result.get("usage", {})
            total["duration_ms"] += result.get("duration_ms") or int(secs * 1000)
            total["tokens"] += sum(
                u.get(x, 0)
                for x in (
                    "input_tokens",
                    "output_tokens",
                    "cache_creation_input_tokens",
                    "cache_read_input_tokens",
                )
            )
            cost = result.get("total_cost_usd")
            if cost is None or total["cost_usd"] is None:
                total["cost_usd"] = None
            else:
                total["cost_usd"] += cost
            total["denials"] += [
                dict(d, turn=i) for d in result.get("permission_denials") or []
            ]
        else:
            total["duration_ms"] += int(secs * 1000)
        if session is None:
            stop.set()
            total["errors"].append(
                {"turn": i, "source": "agent", "error": "missing session ID"}
            )
            break
        _, replies_so_far = render(turns_log)
        try:
            verification = completion_evidence(ev, harness)
            answer = person_reply(
                ev,
                replies_so_far,
                verification,
                i + 1,
                person_model,
                os.path.join(run, "raw"),
                person_timeout,
                stop,
            )
            if "docker_desktop_wsl" in answer["completed_steps"]:
                with open(os.path.join(harness, "scenario", "platform.json")) as source:
                    platform = json.load(source)
                _, latest = render([turns_log[-1]])
                agent_reply = latest.split("## Agent (turn %d)\n" % i, 1)[1].lower()
                if (
                    "microsoft" not in platform.get("uname", {}).get("r", "").lower()
                    or "docker desktop" not in agent_reply
                    or "wsl" not in agent_reply
                    or not answer["reply"].strip()
                ):
                    raise ValueError(
                        "manual Docker completion does not match a WSL request"
                    )
                with open(os.path.join(harness, "state", "docker_installed"), "w"):
                    pass
        except (ValueError, KeyError, OSError, subprocess.TimeoutExpired) as error:
            stop.set()
            total["errors"].append(
                {"turn": i + 1, "source": "person", "error": str(error)}
            )
            break
        person_log.append(answer)
        if verification["verified"]:
            observed = verification["status"]
            total["completion_observation"] = {
                "home": observed.get("home"),
                "apps": [
                    {
                        key: app[key]
                        for key in ("id", "description", "url", "addresses")
                        if key in app
                    }
                    for app in observed["apps"]
                ],
            }
        if answer["done"] and not verification["verified"]:
            stop.set()
            total["errors"].append(
                {
                    "turn": i,
                    "source": "completion",
                    "error": "conversation ended without scenario CLI verification: "
                    + verification["reason"],
                }
            )
            break
        if not answer["done"] and i >= ev.get("max_turns", MAX_TURNS):
            stop.set()
            total["errors"].append(
                {
                    "turn": i,
                    "source": "runner",
                    "error": "conversation exceeded turn limit",
                }
            )
            break
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
            "cost_usd": None
            if total["cost_usd"] is None
            else round(total["cost_usd"], 4),
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


def main(stop):
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
    ap.add_argument(
        "--person-timeout",
        type=int,
        default=300,
        help="seconds per simulated-person call",
    )
    ap.add_argument(
        "--max-conversation-turns",
        type=int,
        help="override the conversation budget for all configurations",
    )
    args = ap.parse_args()

    if os.path.realpath(args.workspace).startswith(os.path.realpath(REPO)):
        sys.exit(
            "workspace must be outside the repository, or the agent reads AGENTS.md"
        )
    iteration_dir = os.path.join(args.workspace, "iteration-%d" % args.iteration)
    if os.path.exists(iteration_dir):
        ap.error(
            "iteration already exists; choose a new --iteration "
            "to preserve its evidence"
        )
    if args.runs < 1 or args.parallel < 1:
        ap.error("--runs and --parallel must be positive")
    if args.timeout < 1 or args.person_timeout < 1:
        ap.error("model timeouts must be positive")
    if sys.platform != "darwin" or not shutil.which("sandbox-exec"):
        ap.error("task evaluations require macOS sandbox-exec")
    if args.max_conversation_turns is not None and args.max_conversation_turns < 1:
        ap.error("--max-conversation-turns must be positive")
    configs = parse_configs(args.configs)
    evals = json.load(open(os.path.join(HERE, "evals", "evals.json")))
    wanted = {int(x) for x in args.evals.split(",") if x.strip()}
    unknown = wanted - {ev["id"] for ev in evals["evals"]}
    if unknown:
        ap.error("unknown eval ids: %s" % sorted(unknown))
    for ev in evals["evals"]:
        if not wanted or ev["id"] in wanted:
            recap_criterion(dict(ev, judgment_schema=2))
    for config in configs:
        if not os.path.isfile(config["guide"]):
            ap.error("configuration guide does not exist")
        if config["skill"] and not os.path.isfile(
            os.path.join(config["skill"], "SKILL.md")
        ):
            ap.error("configuration router does not exist")
    cli_version = check_cli()
    for model in dict.fromkeys((args.model, args.person_model)):
        check_model(model, stop=stop)
    inputs = os.path.join(iteration_dir, "inputs")
    for config in configs:
        frozen = os.path.join(inputs, config["name"])
        os.makedirs(frozen)
        shutil.copy(config["guide"], os.path.join(frozen, "guide.md"))
        config["guide"] = os.path.join(frozen, "guide.md")
        if config["skill"]:
            shutil.copytree(config["skill"], os.path.join(frozen, "router"))
            config["skill"] = os.path.join(frozen, "router")
    jobs = []
    for ev in evals["evals"]:
        if wanted and ev["id"] not in wanted:
            continue
        if args.max_conversation_turns is not None:
            ev["max_turns"] = args.max_conversation_turns
        ev["scenario_path"] = os.path.join(inputs, "scenarios", ev["scenario"])
        if not os.path.exists(ev["scenario_path"]):
            shutil.copytree(
                os.path.join(HERE, "scenarios", ev["scenario"]), ev["scenario_path"]
            )
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
                "max_turns": ev.get("max_turns", MAX_TURNS),
                "prompt": "%s\n\n---\nThe person (played by a model):\n%s"
                % (ev["first_message"], ev["persona"]),
                "assertions": ev["assertions"],
                "completion": ev["completion"],
                "completion_criteria": ev["completion_criteria"],
                "judgment_schema": 2,
                "recap_assessment": ev.get("recap_assessment"),
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
            "claude_code_version": cli_version,
            "person_model": args.person_model,
            "runs": args.runs,
            "eval_ids": sorted({ev["id"] for ev, _, _ in jobs}),
            "parallel": args.parallel,
            "timeout_seconds": args.timeout,
            "person_timeout_seconds": args.person_timeout,
            "max_conversation_turns": args.max_conversation_turns,
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
    install_stubs(os.path.join(inputs, "stubs"))
    failed = 0
    completed = 0
    interrupted = None
    with cf.ThreadPoolExecutor(args.parallel) as pool:
        futs = []
        try:
            for ev, c, k in jobs:
                futs.append(
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
                        args.person_timeout,
                        stop,
                    )
                )
            for fut in cf.as_completed(futs):
                if fut.cancelled():
                    failed += 1
                    continue
                try:
                    print(fut.result(), flush=True)
                    completed += 1
                except Exception as e:
                    stop.set()
                    failed += 1
                    print("run failed: %r" % (e,), flush=True)
                    for pending in futs:
                        pending.cancel()
        except KeyboardInterrupt as error:
            interrupted = str(error) or "KeyboardInterrupt"
        finally:
            stop.set()
            for pending in futs:
                pending.cancel()
    if interrupted:
        failed = len(jobs) - completed
    write_json(
        os.path.join(iteration_dir, "execution.json"),
        {
            "valid": not failed and not interrupted,
            "planned": len(jobs),
            "completed": completed,
            "failed": failed,
            "interrupted": interrupted,
        },
    )
    print(os.path.join(args.workspace, "iteration-%d" % args.iteration))
    if interrupted:
        sys.exit("%s; cancelled batch, not grading a partial iteration" % interrupted)
    if failed:
        sys.exit(
            "%d of %d runs failed; not grading a partial iteration"
            % (failed, len(jobs))
        )


if __name__ == "__main__":
    stop = threading.Event()
    with cancellation_signals(stop):
        try:
            main(stop)
        except KeyboardInterrupt as error:
            sys.exit(str(error) or "batch interrupted")
