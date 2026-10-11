#!/usr/bin/env python3
import json
import os
import sys

args = sys.argv[1:]
mode = os.environ.get("EVAL_TEST_MODE", "success")
if args == ["--version"]:
    print("2.1.100 (Claude Code)" if mode == "old-cli" else "2.1.296 (Claude Code)")
    sys.exit(0)
prompt = args[args.index("-p") + 1]
is_preflight = prompt == "Reply with only the word READY."
is_stream = args[args.index("--output-format") + 1] == "stream-json"
result = {
    "type": "result",
    "subtype": "success",
    "is_error": False,
    "session_id": "00000000-0000-4000-8000-000000000000",
    "usage": {"input_tokens": 5, "output_tokens": 2},
    "duration_ms": 1,
    "total_cost_usd": 0,
    "result": "Ready.",
}
if is_preflight:
    result["result"] = "READY"
elif is_stream:
    if mode == "require-restricted" and not (
        "--settings" in args
        and "--tools" in args
        and args[args.index("--tools") + 1] == "Bash,Read,Skill"
        and "--allowedTools" in args
        and "dontAsk" in args
        and "bypassPermissions" not in args
    ):
        sys.exit("task tools must be restricted")
    print(
        json.dumps(
            {
                "type": "system",
                "subtype": "init",
                "session_id": result["session_id"],
                "tools": ["Bash", "Read", "Skill", "mcp__person__ask_user"],
                "skills": ["self-host"] if mode != "missing-router" else [],
            }
        )
    )
    print(
        json.dumps(
            {
                "type": "assistant",
                "message": {"content": [{"type": "text", "text": "Ready."}]},
            }
        )
    )
elif prompt.startswith("You are grading"):
    assertions = (
        prompt.split("Assertions to grade:\n", 1)[1].split("\n\n===", 1)[0].splitlines()
    )
    result["result"] = json.dumps(
        [
            {"text": line.split(". ", 1)[1], "passed": True, "evidence": "Ready."}
            for line in assertions
        ]
    )
else:
    result["result"] = json.dumps({"reply": "", "done": True, "approves": False})
if mode == "task-error" and is_stream:
    result.update(
        is_error=True, subtype="error_during_execution", result="captured quota failure"
    )
    result["usage"]["output_tokens"] = 0
if mode == "turn-cap" and not is_preflight and not is_stream:
    result["result"] = json.dumps(
        {"reply": "Please continue", "done": False, "approves": False}
    )
if mode == "nine-turns" and not is_preflight and not is_stream:
    done = "## Agent (turn 9)" in prompt
    result["result"] = json.dumps(
        {
            "reply": "Please continue" if not done else "",
            "done": done,
            "approves": False,
        }
    )
if mode == "malformed-stream" and is_stream:
    print('{"broken":')
if mode == "person-error" and not is_preflight and not is_stream:
    result.update(
        is_error=True, subtype="error_during_execution", result="person quota failure"
    )
    print("person diagnostic", file=sys.stderr)
if mode == "judge-error" and prompt.startswith("You are grading"):
    result.update(
        is_error=True, subtype="error_during_execution", result="judge quota failure"
    )
if "--json-schema" in args and not result["is_error"]:
    value = json.loads(result["result"])
    if prompt.startswith("You are grading"):
        value = {"verdicts": value}
    result["structured_output"] = value
if mode == "person-preamble" and not is_preflight and not is_stream:
    result["result"] = (
        'Yes please.\n\n```json\n{"reply":"","done":true,"approves":false}\n```'
    )
if mode == "judge-preamble" and prompt.startswith("You are grading"):
    result["result"] = "Here are my judgments."
print(json.dumps(result))
if result["is_error"]:
    sys.exit(1)
