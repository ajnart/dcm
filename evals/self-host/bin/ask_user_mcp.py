#!/usr/bin/env python3
"""A minimal MCP server giving the eval agent an ask-user tool.

`claude -p` has no question tool, but real harnesses do (Claude Code's
AskUserQuestion, OpenCode's question tool), and the guide tells agents to use
one. This stands in for it: each call is logged to the run's ask.jsonl with
its turn, and the agent is told the answer arrives as the person's next
message, which is how the scripted turns reply.
"""

import json
import os
import sys
import time

TOOL = {
    "name": "ask_user",
    "description": (
        "Ask the person a question in the chat UI, optionally with clickable "
        "options so they do not have to type. Use one call per question."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "question": {"type": "string"},
            "options": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "label": {"type": "string"},
                        "description": {"type": "string"},
                    },
                    "required": ["label"],
                },
            },
            "multiple": {"type": "boolean"},
        },
        "required": ["question"],
    },
}


def log(args):
    harness = os.environ.get("SELF_HOST_EVAL_HARNESS")
    if not harness or not os.path.isdir(harness):
        return
    with open(os.path.join(harness, "ask.jsonl"), "a") as f:
        f.write(
            json.dumps(
                {
                    "ts": time.time(),
                    "turn": int(os.environ.get("SELF_HOST_EVAL_TURN", "1")),
                    "question": args.get("question", ""),
                    "options": [o.get("label", "") for o in args.get("options") or []],
                }
            )
            + "\n"
        )


def reply(msg_id, result):
    sys.stdout.write(
        json.dumps({"jsonrpc": "2.0", "id": msg_id, "result": result}) + "\n"
    )
    sys.stdout.flush()


def main():
    for line in sys.stdin:
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        method, msg_id = msg.get("method"), msg.get("id")
        if msg_id is None:
            continue  # notifications
        if method == "initialize":
            reply(
                msg_id,
                {
                    "protocolVersion": msg.get("params", {}).get(
                        "protocolVersion", "2024-11-05"
                    ),
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "person", "version": "1"},
                },
            )
        elif method == "tools/list":
            reply(msg_id, {"tools": [TOOL]})
        elif method == "tools/call":
            log(msg.get("params", {}).get("arguments", {}))
            reply(
                msg_id,
                {
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "The question is on the person's screen. "
                                "Their answer arrives as their next message: "
                                "end your turn now without assuming it."
                            ),
                        }
                    ]
                },
            )
        else:
            reply(msg_id, {})


if __name__ == "__main__":
    main()
