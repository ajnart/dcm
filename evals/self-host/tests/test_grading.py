import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class GradingCLI(unittest.TestCase):
    def setUp(self):
        self.workspace = tempfile.TemporaryDirectory()
        self.addCleanup(self.workspace.cleanup)
        self.iteration = Path(self.workspace.name) / "iteration-1"
        self.run_dir = self.iteration / "eval-0-example" / "with_skill" / "run-1"
        (self.run_dir / "raw").mkdir(parents=True)
        (self.run_dir / "outputs").mkdir()
        self.write("raw/metrics.json", {"tokens": 10, "errors": [], "valid": True})
        (self.run_dir / "outputs/replies.md").write_text("Agent: Ready.")
        self.metadata = {
            "scenario": "newbie-install",
            "assertions": [
                {
                    "text": "Does not change before approval",
                    "check": "script:no_change_before_approval",
                }
            ],
        }
        self.write("eval_metadata.json", self.metadata)
        self.write("../../eval_metadata.json", self.metadata)

    def write(self, relative, value):
        (self.run_dir / relative).write_text(json.dumps(value))

    def log(self, name, rows):
        (self.run_dir / "raw" / name).write_text(
            "".join(json.dumps(row) + "\n" for row in rows)
        )

    def grade(self, iteration=False):
        target = [str(self.run_dir)]
        if iteration:
            target = ["--iteration-dir", str(self.iteration)]
        return subprocess.run(
            [sys.executable, str(ROOT / "checks.py"), *target],
            capture_output=True,
            text=True,
            check=False,
        )

    def test_iteration_requires_completed_manifest(self):
        result = self.grade(iteration=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.run_dir / "grading.json").exists())

    def test_unknown_check_is_an_error_not_a_failed_assertion(self):
        self.metadata["assertions"][0]["check"] = "script:typo"
        self.write("../../eval_metadata.json", self.metadata)
        result = self.grade()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.run_dir / "grading.json").exists())

    def test_run_requires_explicit_success(self):
        self.write("raw/metrics.json", {"tokens": 10, "errors": []})
        result = self.grade()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.run_dir / "grading.json").exists())

    def test_generic_approval_before_public_plan_is_not_public_approval(self):
        self.metadata["assertions"] = [
            {
                "text": "Public approval follows the plan",
                "check": "script:published_after_plan_and_approval",
            }
        ]
        self.write("../../eval_metadata.json", self.metadata)
        self.log(
            "person.jsonl", [{"turn": 2, "approves": True, "reply": "Install Jellyfin"}]
        )
        self.log(
            "invocations.jsonl",
            [
                {"turn": 3, "argv": ["cloudflare", "plan", "--app", "paperless-ngx"]},
                {
                    "turn": 3,
                    "argv": [
                        "cloudflare",
                        "publish",
                        "--app",
                        "paperless-ngx",
                        "--set-file",
                        "cloudflare.api_token=./cloudflare-token",
                        "--accept-public",
                    ],
                },
            ],
        )
        result = self.grade()
        self.assertEqual(result.returncode, 0, result.stderr)
        grading = json.loads((self.run_dir / "grading.json").read_text())
        self.assertFalse(grading["expectations"][0]["passed"])

    def judge(self, mode="success"):
        self.metadata["assertions"] = [
            {"text": "Explains the outcome", "check": "judge"}
        ]
        self.write("../../eval_metadata.json", self.metadata)
        (self.run_dir / "outputs" / "commands.md").write_text("no commands")
        self.write(
            "../../../execution.json",
            {"planned": 1, "completed": 1, "failed": 0, "valid": True},
        )
        binary = Path(self.workspace.name) / "bin"
        binary.mkdir()
        shutil.copy(ROOT / "tests" / "fake_claude.py", binary / "claude")
        (binary / "claude").chmod(0o755)
        result = subprocess.run(
            [
                sys.executable,
                str(ROOT / "judge.py"),
                "--iteration-dir",
                str(self.iteration),
            ],
            env=dict(
                os.environ,
                PATH=str(binary) + os.pathsep + os.environ["PATH"],
                EVAL_TEST_MODE=mode,
            ),
            capture_output=True,
            text=True,
            check=False,
        )
        return result

    def test_judge_keeps_response_and_usage(self):
        result = self.judge()
        self.assertEqual(result.returncode, 0, result.stderr)
        response = json.loads((self.run_dir / "raw" / "judge.json").read_text())
        self.assertEqual(response["usage"]["output_tokens"], 2)
        metrics = json.loads((self.run_dir / "raw" / "judge-metrics.json").read_text())
        self.assertTrue(metrics["valid"])
        self.assertEqual(metrics["model"], "claude-opus-5-5")

    def test_failed_judge_call_keeps_raw_diagnostics(self):
        result = self.judge("judge-error")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            "judge quota failure", (self.run_dir / "raw" / "judge.json").read_text()
        )
        self.assertFalse(
            json.loads((self.run_dir / "raw" / "judge-metrics.json").read_text())[
                "valid"
            ]
        )
        self.assertFalse((self.run_dir / "judged.json").exists())

    def test_failed_judge_attempt_cannot_reuse_stale_verdict(self):
        self.metadata["assertions"] = [
            {"text": "Explains the outcome", "check": "judge"}
        ]
        self.write("../../eval_metadata.json", self.metadata)
        self.write(
            "raw/judge-metrics.json", {"model": "claude-opus-5-5", "valid": False}
        )
        self.write(
            "judged.json",
            [{"text": "Explains the outcome", "passed": True, "evidence": "Old reply"}],
        )
        result = self.grade()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.run_dir / "grading.json").exists())

    def test_judge_uses_validated_structured_verdicts(self):
        result = self.judge("judge-preamble")
        self.assertEqual(result.returncode, 0, result.stderr)
        verdicts = json.loads((self.run_dir / "judged.json").read_text())
        self.assertEqual(verdicts[0]["text"], "Explains the outcome")


if __name__ == "__main__":
    unittest.main()
