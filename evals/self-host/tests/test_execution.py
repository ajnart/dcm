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

    def test_background_tool_execution_is_refused(self):
        decision = self.decision(
            "Bash", {"command": "sleep 10", "run_in_background": True}
        )
        self.assertEqual(decision.get("permissionDecision"), "deny")

    def test_file_tool_reads_only_current_session_tool_results(self):
        home = self.root / "fake-home"
        self.env["HOME"] = str(home)
        slug = (
            str(self.sandbox.resolve())
            .replace("/", "-")
            .replace(".", "-")
            .replace("_", "-")
        )
        own = home / ".claude/projects" / slug
        for relative, expected in (
            ("current/tool-results/result.txt", None),
            ("other/tool-results/result.txt", "deny"),
            ("current.jsonl", "deny"),
        ):
            with self.subTest(path=relative):
                hook = subprocess.run(
                    [sys.executable, str(ROOT / "bin/guard.py")],
                    input=json.dumps(
                        {
                            "tool_name": "Read",
                            "tool_input": {"file_path": str(own / relative)},
                            "session_id": "current",
                        }
                    ),
                    env=self.env,
                    capture_output=True,
                    text=True,
                    check=False,
                )
                self.assertEqual(hook.returncode, 0, hook.stderr)
                decision = json.loads(hook.stdout or "{}").get("hookSpecificOutput", {})
                self.assertEqual(decision.get("permissionDecision"), expected)

    def test_fixture_accepts_equals_flags_and_preserves_profile_changes(self):
        shutil.copytree(
            ROOT / "scenarios/public-access",
            self.harness / "scenario",
            dirs_exist_ok=True,
        )
        (self.harness / "config.json").write_text(json.dumps({"version": "dev-eval"}))
        (self.stubs / "base/self-host").chmod(0o755)
        initial = self.invoke("self-host status --json")
        self.assertEqual(initial.returncode, 0, initial.stderr)
        before = json.loads(initial.stdout)
        planned = self.invoke(
            "self-host cloudflare plan --app=paperless-ngx "
            "--domain=review.example.com --email=me@example.org --json"
        )
        self.assertEqual(planned.returncode, 0, planned.stderr)
        publication = {
            "app": "paperless-ngx",
            "name": "paperless-ngx.review.example.com",
            "address": "https://paperless-ngx.review.example.com",
        }
        self.assertEqual(json.loads(planned.stdout)["publish"], [publication])
        denied = self.invoke(
            "self-host cloudflare publish --app=paperless-ngx "
            "--domain=review.example.com --email=me@example.org --json"
        )
        self.assertNotEqual(denied.returncode, 0)
        self.assertEqual(
            json.loads(self.invoke("self-host status --json").stdout), before
        )
        result = self.invoke(
            "self-host cloudflare publish --app=paperless-ngx "
            "--domain=review.example.com --email=me@example.org "
            "--set-file=cloudflare.api_token=./token --accept-public --json"
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("cloudflare publish: ok", result.stdout)
        self.assertIn(publication["address"], result.stdout)
        status = json.loads(self.invoke("self-host status --json").stdout)
        self.assertEqual(status["access"], ["home", "cloudflare"])
        apps = {app["id"]: app for app in status["apps"]}
        self.assertEqual(apps["paperless-ngx"]["url"], publication["address"])
        self.assertEqual(
            apps["paperless-ngx"]["addresses"],
            [publication["address"], "http://192.168.1.50:8000"],
        )
        self.assertEqual(apps["jellyfin"]["addresses"], ["http://192.168.1.50:8096"])
        self.assertNotIn("dashboard", status)
        planned = self.invoke(
            "self-host cloudflare plan --app=paperless-ngx "
            "--domain=review.example.com --email=me@example.org --json"
        )
        self.assertEqual(planned.returncode, 0, planned.stderr)
        plan = json.loads(planned.stdout)
        self.assertEqual(plan["current"], [publication])
        self.assertFalse(plan.get("additions"))
        for flags in (
            "--app=paperless-ngx --domain=other.example.com --email=me@example.org",
            "--app=jellyfin --domain=review.example.com "
            "--email=me@example.org --accept-public",
        ):
            denied = self.invoke(
                "self-host cloudflare publish "
                + flags
                + " --set-file=cloudflare.api_token=./token --json"
            )
            self.assertNotEqual(denied.returncode, 0)
            self.assertEqual(
                json.loads(self.invoke("self-host status --json").stdout), status
            )
        result = self.invoke(
            "self-host profile set experience new && self-host profile --json"
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            json.loads(result.stdout.splitlines()[-1])["experience"], "new"
        )

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
        platform = json.loads((self.harness / "scenario/platform.json").read_text())
        root = self.sandbox / ".root"
        (root / platform["dirs"][0].lstrip("/")).mkdir(parents=True)
        for tool in ("ls", "stat", "file", "df", "mount", "diskutil", "sysctl"):
            (self.stubs / "base" / tool).symlink_to("hosttool")
        (self.stubs / "base/hosttool").chmod(0o755)
        films = platform["media"]["files"]
        listed = self.invoke("ls -l /Volumes/FILMS/Movies")
        self.assertEqual(listed.returncode, 0, listed.stderr)
        self.assertIn("metadata-only", listed.stdout)
        for film in films:
            self.assertIn(film["name"], listed.stdout)
            self.assertIn(str(film["bytes"]), listed.stdout)
            sized = self.invoke(
                "stat -f %z '/Volumes/FILMS/Movies/" + film["name"] + "'"
            )
            self.assertEqual(sized.returncode, 0, sized.stderr)
            self.assertEqual(sized.stdout.strip(), str(film["bytes"]))
        self.assertFalse(list((root / platform["dirs"][0].lstrip("/")).iterdir()))
        for command in (
            "file '/Volumes/FILMS/Movies/" + films[0]["name"] + "'",
            "df -h /Volumes/FILMS/Movies",
            "mount",
            "diskutil list",
            "sysctl kern.osrelease",
        ):
            denied = self.invoke(command)
            self.assertNotEqual(denied.returncode, 0)
            self.assertIn("not modeled", denied.stderr)

    def test_single_app_install_has_only_its_credentials(self):
        for fixture in sorted((ROOT / "scenarios").glob("*/credentials.json")):
            with self.subTest(fixture=fixture.parent.name):
                document = json.loads(fixture.read_text())
                self.assertIsInstance(document["admin"]["username"], str)
                self.assertIsInstance(document["admin"]["password"], str)
                self.assertIsInstance(document["apps"], dict)
                for app, secrets in document["apps"].items():
                    self.assertIsInstance(app, str)
                    self.assertIsInstance(secrets, dict)
                    self.assertTrue(
                        all(isinstance(value, str) for value in secrets.values())
                    )
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
        self.assertEqual(list(apps), ["jellyfin"])
        self.assertEqual(list(apps["jellyfin"]), ["JELLYFIN_API_KEY"])

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
        status = json.loads(self.invoke("self-host status --json").stdout)
        self.assertEqual([app["id"] for app in status["apps"]], ["jellyfin"])
        self.assertNotIn("recipe", status["apps"][0])
        self.assertNotIn("dashboard", status)
        installed = self.invoke("self-host install media --yes --json")
        self.assertEqual(installed.returncode, 0, installed.stderr)
        status = json.loads(self.invoke("self-host status --json").stdout)
        apps = {app["id"]: app for app in status["apps"]}
        self.assertNotIn("recipe", apps["jellyfin"])
        self.assertEqual(apps["sonarr"]["recipe"], "media")
        self.assertNotIn("dashboard", status)

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
        (self.harness / "state" / "installed").unlink()
        (self.harness / "state" / "recipes.json").unlink()
        shutil.copytree(
            ROOT / "scenarios" / "failed-setup",
            self.harness / "scenario",
            dirs_exist_ok=True,
        )
        before = json.loads(self.invoke("self-host status --json").stdout)
        before_apps = {app["id"]: app for app in before["apps"]}
        self.assertEqual(set(before_apps), {"jellyfin", "qbittorrent", "sonarr"})
        debug = self.invoke("self-host debug sonarr --json")
        self.assertEqual(debug.returncode, 0, debug.stderr)
        report = json.loads(debug.stdout)
        self.assertEqual(report["id"], "sonarr")
        self.assertEqual(report["setup"], "incomplete")
        self.assertEqual(report["failed_steps"][0]["id"], "download-client")
        self.assertEqual(report["health_check"]["url"], before_apps["sonarr"]["url"])
        self.assertIsInstance(report["health_check"]["working"], str)
        setup = self.invoke("self-host setup sonarr --json")
        self.assertEqual(setup.returncode, 0, setup.stderr)
        after = json.loads(self.invoke("self-host status --json").stdout)
        after_apps = {app["id"]: app for app in after["apps"]}
        self.assertEqual(set(after_apps), set(before_apps))
        for app in ("jellyfin", "qbittorrent"):
            self.assertEqual(after_apps[app], before_apps[app])
        self.assertEqual(before_apps["sonarr"]["setup"], "incomplete")
        self.assertEqual(after_apps["sonarr"]["setup"], "ok")
        for key in before_apps["sonarr"].keys() - {"setup", "steps"}:
            self.assertEqual(after_apps["sonarr"][key], before_apps["sonarr"][key])
        self.assertEqual(after_apps["sonarr"]["steps"][0]["status"], "ok")
        repaired = self.invoke("self-host debug sonarr --json")
        self.assertEqual(repaired.returncode, 0, repaired.stderr)
        self.assertEqual(json.loads(repaired.stdout)["setup"], "ok")
        self.assertFalse(json.loads(repaired.stdout).get("failed_steps"))
        result = self.invoke("docker ps --format '{{.Names}}'")
        self.assertEqual(result.returncode, 0, result.stderr)
        for app in before_apps:
            self.assertIn("self-host-%s-1" % app, result.stdout)

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

    def test_shell_cannot_bypass_stub_with_absolute_host_tool(self):
        isolated = self.decision("Bash", {"command": "true"})["updatedInput"]["command"]
        self.assertNotIn("process-fork sysctl-read", isolated)
        self.assertNotIn("(allow file-read-metadata)", isolated)
        for command in (
            "/usr/bin/uname -a",
            "/bin/df -h /",
            "/sbin/mount",
            "/usr/sbin/diskutil list",
            "/usr/sbin/sysctl kern.osrelease",
        ):
            with self.subTest(command=command):
                result = self.invoke(command)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(result.stdout.strip())
        result = self.invoke("/usr/bin/osascript -e 'return \"REAL-HOST-TOOL\"'")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("REAL-HOST-TOOL", result.stdout)

    def test_workspace_symlink_cannot_read_host_file(self):
        outside = self.root / "host-file"
        outside.write_text("PRIVATE-HOST-CANARY")
        link = self.sandbox / "linked-file"
        link.symlink_to(outside)
        self.assertEqual(
            self.decision("Read", {"file_path": str(link)}).get("permissionDecision"),
            "deny",
        )
        result = self.invoke("cat linked-file")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("PRIVATE-HOST-CANARY", result.stdout)


if __name__ == "__main__":
    unittest.main()
