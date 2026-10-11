import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ShellBoundary(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.sandbox = self.root / "sandbox"
        self.sandbox.mkdir()
        self.harness = self.root / "harness"
        (self.harness / "state").mkdir(parents=True)
        (self.harness / "scenario").mkdir()
        self.stubs = self.root / "stubs"
        shutil.copytree(ROOT / "bin", self.stubs / "base")
        self.env = dict(
            os.environ,
            EVAL_SANDBOX=str(self.sandbox),
            EVAL_STUBS=str(self.stubs),
            SELF_HOST_EVAL_HARNESS=str(self.harness),
        )

    def decision(self, tool, inputs):
        hook = subprocess.run(
            [sys.executable, str(ROOT / "bin" / "guard.py")],
            input=json.dumps({"tool_name": tool, "tool_input": inputs}),
            env=self.env,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(hook.returncode, 0, hook.stderr)
        return json.loads(hook.stdout or "{}").get("hookSpecificOutput", {})

    def invoke(self, command):
        decision = self.decision("Bash", {"command": command})
        if decision["permissionDecision"] == "deny":
            return subprocess.CompletedProcess(
                [], 1, "", decision["permissionDecisionReason"]
            )
        return subprocess.run(
            decision["updatedInput"]["command"],
            shell=True,
            capture_output=True,
            text=True,
            check=False,
        )

    def test_command_cannot_read_outside_workspace(self):
        outside = self.root / "host-file"
        outside.write_text("PRIVATE-HOST-CANARY")
        result = self.invoke("/bin/cat " + str(outside))
        self.assertNotIn("PRIVATE-HOST-CANARY", result.stdout)
        self.assertNotEqual(result.returncode, 0)

    def test_shell_can_run_fixture_binary(self):
        (self.harness / "guide.md").write_text("FIXTURE-GUIDE")
        (self.harness / "config.json").write_text(
            json.dumps({"guide": str(self.harness / "guide.md"), "version": "dev-eval"})
        )
        (self.stubs / "base" / "self-host").chmod(0o755)
        result = self.invoke("self-host skill")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        self.assertIn("FIXTURE-GUIDE", result.stdout)

    def test_shell_cannot_write_outside_workspace(self):
        outside = self.root / "host-file"
        result = self.invoke("printf altered > " + str(outside))
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(outside.exists())

    def test_shell_cannot_change_guard_settings(self):
        settings = self.sandbox / ".claude" / "settings.json"
        settings.parent.mkdir()
        settings.write_text("protected")
        result = self.invoke("printf altered > " + str(settings))
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(settings.read_text(), "protected")

    def test_shell_cannot_reach_network_listener(self):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen()
            port = listener.getsockname()[1]
            result = self.invoke(
                "/usr/bin/python3 -c 'import socket; "
                'socket.create_connection(("127.0.0.1", %d), timeout=1); '
                'print("CONNECTED")\'' % port
            )
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("CONNECTED", result.stdout)

    @unittest.skipUnless(sys.platform == "darwin", "macOS volume alias")
    def test_shell_cannot_read_through_data_volume_alias(self):
        outside = self.root / "host-file"
        outside.write_text("PRIVATE-HOST-CANARY")
        alias = "/System/Volumes/Data" + str(outside.resolve())
        result = self.invoke("/bin/cat " + alias)
        self.assertNotIn("PRIVATE-HOST-CANARY", result.stdout)
        self.assertNotEqual(result.returncode, 0)

    def test_file_tool_cannot_read_workspace_name_prefix(self):
        sibling = self.root / "sandbox-other"
        sibling.mkdir()
        decision = self.decision("Read", {"file_path": str(sibling / "host-file")})
        self.assertEqual(decision.get("permissionDecision"), "deny")

    def test_unconfigured_tool_is_refused(self):
        decision = self.decision("WebFetch", {"url": "https://example.com"})
        self.assertEqual(decision.get("permissionDecision"), "deny")

    def test_fixture_supports_connecting_media_after_install(self):
        shutil.copytree(
            ROOT / "scenarios" / "newbie-macbook",
            self.harness / "scenario",
            dirs_exist_ok=True,
        )
        (self.harness / "config.json").write_text(json.dumps({"version": "dev-eval"}))
        (self.stubs / "base" / "self-host").chmod(0o755)
        result = self.invoke(
            "self-host config set MEDIA_ROOT=/Volumes/FILMS --yes --json"
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        events = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual(events[-1]["event"], "run.end")

    def test_single_app_install_has_only_its_credentials(self):
        shutil.copytree(
            ROOT / "scenarios" / "newbie-install",
            self.harness / "scenario",
            dirs_exist_ok=True,
        )
        (self.harness / "config.json").write_text(json.dumps({"version": "dev-eval"}))
        (self.stubs / "base" / "self-host").chmod(0o755)
        installed = self.invoke("self-host install jellyfin --yes --json")
        self.assertEqual(installed.returncode, 0, installed.stderr)
        credentials = self.invoke("self-host credentials --json")
        self.assertEqual(credentials.returncode, 0, credentials.stderr)
        apps = json.loads(credentials.stdout)["apps"]
        self.assertEqual([app["app"] for app in apps], ["jellyfin"])

    def test_single_app_install_is_not_labelled_as_media_recipe(self):
        shutil.copytree(
            ROOT / "scenarios" / "newbie-install",
            self.harness / "scenario",
            dirs_exist_ok=True,
        )
        (self.harness / "config.json").write_text(json.dumps({"version": "dev-eval"}))
        (self.stubs / "base" / "self-host").chmod(0o755)
        installed = self.invoke("self-host install jellyfin --yes --json")
        self.assertEqual(installed.returncode, 0, installed.stderr)
        events = [json.loads(line) for line in installed.stdout.splitlines()]
        self.assertEqual(events[0]["msg"], "install jellyfin")

    def test_docker_observation_agrees_with_installed_apps(self):
        shutil.copytree(
            ROOT / "scenarios" / "newbie-install",
            self.harness / "scenario",
            dirs_exist_ok=True,
        )
        (self.harness / "config.json").write_text(json.dumps({"version": "dev-eval"}))
        (self.stubs / "base" / "self-host").chmod(0o755)
        (self.stubs / "docker").mkdir()
        shutil.copy(ROOT / "bin" / "docker", self.stubs / "docker" / "docker")
        shutil.copy(
            ROOT / "bin" / "dockerstate.py", self.stubs / "docker" / "dockerstate.py"
        )
        (self.stubs / "docker" / "docker").chmod(0o755)
        installed = self.invoke("self-host install jellyfin --yes --json")
        self.assertEqual(installed.returncode, 0, installed.stderr)
        result = self.invoke("docker ps --format '{{.Names}} {{.Status}}'")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("jellyfin", result.stdout)
        self.assertIn("Up", result.stdout)
        self.assertNotIn("sonarr", result.stdout)

    def test_installed_project_home_exists_only_in_sandbox(self):
        shutil.copytree(
            ROOT / "scenarios" / "newbie-install",
            self.harness / "scenario",
            dirs_exist_ok=True,
        )
        home = self.sandbox / ".home" / ".self-host"
        (self.harness / "config.json").write_text(
            json.dumps({"version": "dev-eval", "home": str(home)})
        )
        (self.stubs / "base" / "self-host").chmod(0o755)
        installed = self.invoke("self-host install jellyfin --yes --json")
        self.assertEqual(installed.returncode, 0, installed.stderr)
        result = self.invoke("self-host status --json")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["home"], str(home))
        self.assertEqual(self.invoke('test -d "$HOME/.self-host"').returncode, 0)

    def test_shell_cannot_execute_binary_outside_allowed_roots(self):
        outside = self.root / "host-binary"
        shutil.copy("/bin/echo", outside)
        result = self.invoke(str(outside) + " EXECUTED-HOST-BINARY")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("EXECUTED-HOST-BINARY", result.stdout)


if __name__ == "__main__":
    unittest.main()
