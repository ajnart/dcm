"""Docker's state on the scenario's machine, shared by the stubs and the guard.

platform.json's "docker" is "ok" (default), "missing" or "permission"; the
host tools mark state/docker_installed or state/docker_group when the agent
fixes it.
"""

import json
import os


def docker_state(harness):
    if not harness:
        return "ok"
    path = os.path.join(harness, "scenario", "platform.json")
    start = json.load(open(path)).get("docker", "ok") if os.path.exists(path) else "ok"
    state = os.path.join(harness, "state")
    if start == "missing" and os.path.exists(os.path.join(state, "docker_installed")):
        return "ok"
    if start == "permission" and os.path.exists(os.path.join(state, "docker_group")):
        return "ok"
    return start
