import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class RunnerCLI(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.project = self.root / "project"
        self.harness = self.project / "evals" / "self-host"
        shutil.copytree(
            ROOT, self.harness, ignore=shutil.ignore_patterns("runs", "__pycache__")
        )
        (self.project / "internal" / "skill").mkdir(parents=True)
        (self.project / "internal" / "skill" / "guide.md").write_text("Original guide")
        (self.project / "skills" / "self-host").mkdir(parents=True)
        (self.project / "skills" / "self-host" / "SKILL.md").write_text(
            "Original router"
        )
        binary = self.root / "bin"
        binary.mkdir()
        shutil.copy(ROOT / "tests" / "fake_claude.py", binary / "claude")
        (binary / "claude").chmod(0o755)
        self.env = dict(os.environ, PATH=str(binary) + os.pathsep + os.environ["PATH"])
        self.workspace = self.root / "workspace"

    def execute(self, mode="success", config="with_skill=skills/self-host", extra=()):
        return subprocess.run(
            [
                sys.executable,
                str(self.harness / "run.py"),
                "--workspace",
                str(self.workspace),
                "--iteration",
                "1",
                "--evals",
                "0",
                "--runs",
                "1",
                "--parallel",
                "1",
                "--configs",
                config,
                *extra,
            ],
            env=dict(self.env, EVAL_TEST_MODE=mode),
            capture_output=True,
            text=True,
            check=False,
        )

    def test_run_preserves_fixture_inputs_without_symlinks(self):
        result = self.execute()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        run = next((self.workspace / "iteration-1").glob("eval-*/*/run-*"))
        snapshot = run / "raw" / "scenario"
        self.assertTrue((snapshot / "apps-list.json").is_file())
        self.assertFalse(any(path.is_symlink() for path in snapshot.rglob("*")))
        source = self.harness / "scenarios" / "newbie-macbook" / "apps-list.json"
        original = (snapshot / "apps-list.json").read_text()
        source.write_text("changed after execution")
        self.assertEqual((snapshot / "apps-list.json").read_text(), original)

    def test_turn_limit_is_not_silent_completion(self):
        result = self.execute("turn-cap")
        self.assertNotEqual(result.returncode, 0)
        manifest = json.loads(
            (self.workspace / "iteration-1" / "execution.json").read_text()
        )
        self.assertFalse(manifest["valid"])

    def test_task_cli_limits_tools_and_settings(self):
        result = self.execute("require-restricted")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_malformed_task_stream_invalidates_execution(self):
        result = self.execute("malformed-stream")
        self.assertNotEqual(result.returncode, 0)
        run = next((self.workspace / "iteration-1").glob("eval-*/*/run-*"))
        self.assertIn('"broken":', (run / "raw" / "turn-1.jsonl").read_text())
        self.assertFalse(
            json.loads((run / "raw" / "metrics.json").read_text())["valid"]
        )

    def test_failed_person_call_keeps_raw_diagnostics(self):
        result = self.execute("person-error")
        self.assertNotEqual(result.returncode, 0)
        run = next((self.workspace / "iteration-1").glob("eval-*/*/run-*"))
        self.assertIn(
            "person quota failure", (run / "raw" / "person-2.json").read_text()
        )
        self.assertIn(
            "person diagnostic", (run / "raw" / "person-2.stderr.txt").read_text()
        )

    def test_missing_router_discovery_invalidates_run(self):
        result = self.execute("missing-router")
        self.assertNotEqual(result.returncode, 0)
        run = next((self.workspace / "iteration-1").glob("eval-*/*/run-*"))
        self.assertFalse(
            json.loads((run / "raw" / "metrics.json").read_text())["valid"]
        )

    def test_old_cli_is_refused_before_creating_iteration(self):
        result = self.execute("old-cli")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.workspace / "iteration-1").exists())

    def test_iteration_keeps_its_own_frozen_stubs(self):
        previous = self.workspace / "_stubs" / "earlier-evidence"
        previous.parent.mkdir(parents=True)
        previous.write_text("keep")
        result = self.execute()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(previous.read_text(), "keep")
        frozen = (
            self.workspace / "iteration-1" / "inputs" / "stubs" / "base" / "guard.py"
        )
        self.assertTrue(frozen.is_file())

    def test_configuration_name_cannot_escape_iteration(self):
        result = self.execute(config="../../escape=skills/self-host")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.workspace / "escape").exists())
        self.assertFalse((self.workspace / "iteration-1").exists())

    def test_explicit_turn_budget_is_used_and_recorded(self):
        result = self.execute("nine-turns", extra=("--max-conversation-turns", "10"))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        iteration = self.workspace / "iteration-1"
        metadata = json.loads(
            next(iteration.glob("eval-*/eval_metadata.json")).read_text()
        )
        self.assertEqual(metadata["max_turns"], 10)
        run = next(iteration.glob("eval-*/*/run-*"))
        self.assertTrue((run / "raw" / "turn-9.jsonl").exists())

    def test_person_reply_uses_validated_structured_output(self):
        result = self.execute("person-preamble")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        run = next((self.workspace / "iteration-1").glob("eval-*/*/run-*"))
        response = json.loads((run / "raw" / "person-2.json").read_text())
        self.assertTrue(response["structured_output"]["done"])


if __name__ == "__main__":
    unittest.main()
