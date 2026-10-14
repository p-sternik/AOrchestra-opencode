"""Release evidence tests: no GitHub writes or model calls."""

import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location(
    "release_validation",
    Path(__file__).parents[1] / ".github/scripts/release-validation.py",
)
validation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validation)

SHA = "a" * 40
PR_SHA = "b" * 40
TREE = "c" * 40
REPO = "owner/repo"
ENV = {
    "GITHUB_REPOSITORY": REPO,
    "GITHUB_RUN_ID": "20",
    "GITHUB_RUN_ATTEMPT": "1",
    "GITHUB_SHA": SHA,
    "SOURCE_RUN": "10",
    "VALIDATED_SHA": PR_SHA,
    "MERGED_SHA": SHA,
}


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.run = dict(
            path=".github/workflows/release.yml",
            head_branch="main",
            head_repository={"full_name": REPO},
            event="push",
            status="completed",
            conclusion="success",
            run_attempt=1,
        )
        self.artifact = dict(id=5, name=f"validation-{PR_SHA}-1", expired=False)
        self.value = dict(
            sha=PR_SHA, tree=TREE, repository=REPO, run_id="10", run_attempt="1"
        )

    def api(self, path, binary=False):
        if path.endswith("/zip"):
            stream = io.BytesIO()
            with zipfile.ZipFile(stream, "w") as archive:
                archive.writestr("validation.json", json.dumps(self.value))
            return stream.getvalue()
        if "/artifacts?" in path:
            return {"artifacts": [self.artifact]}
        return self.run

    def test_matching_tree_reuses_different_commit_after_squash(self):
        with patch.dict(os.environ, ENV), patch.object(validation, "api", self.api):
            self.assertTrue(validation.reuse_main(REPO, SHA, TREE))
            self.assertFalse(validation.reuse_main(REPO, SHA, "d" * 40))
            self.assertFalse(validation.reuse_main(REPO, "e" * 40, TREE))

    def test_run_identity_status_and_attempt_are_required(self):
        original = copy.deepcopy(self.run)
        for field, value in [
            ("path", ".github/workflows/validate.yml"),
            ("head_branch", "feature"),
            ("head_repository", {"full_name": "other/repo"}),
            ("event", "pull_request"),
            ("status", "in_progress"),
            ("conclusion", "failure"),
            ("conclusion", "cancelled"),
            ("run_attempt", 2),
        ]:
            with self.subTest(field=field, value=value):
                self.run = {**original, field: value}
                with patch.object(validation, "api", self.api):
                    self.assertIsNone(validation.receipt(REPO, "10", PR_SHA))

    def test_expired_missing_and_mismatched_receipts_are_rejected(self):
        original = self.value.copy()
        for field, value in [
            ("sha", SHA),
            ("tree", "invalid"),
            ("repository", "other/repo"),
            ("run_id", "11"),
            ("run_attempt", "2"),
        ]:
            with self.subTest(field=field), patch.object(validation, "api", self.api):
                self.value = {**original, field: value}
                if field == "tree":
                    with self.assertRaises(ValueError):
                        validation.receipt(REPO, "10", PR_SHA)
                else:
                    self.assertIsNone(validation.receipt(REPO, "10", PR_SHA))
        self.value = original
        self.artifact["expired"] = True
        with patch.object(validation, "api", self.api):
            self.assertIsNone(validation.receipt(REPO, "10", PR_SHA))
        self.artifact["expired"] = False
        self.artifact["name"] = "different-artifact"
        with patch.object(validation, "api", self.api):
            self.assertIsNone(validation.receipt(REPO, "10", PR_SHA))

    def test_current_publication_requires_exact_sha_and_tree(self):
        with patch.dict(os.environ, ENV), patch.object(
            validation, "receipt", return_value=TREE
        ) as receipt, patch.object(validation, "pages", return_value=iter([])):
            self.assertTrue(validation.reuse_publication(REPO, SHA, TREE))
            receipt.assert_called_once_with(REPO, "20", SHA, current=True)
            receipt.reset_mock()
            self.assertFalse(validation.reuse_publication(REPO, PR_SHA, TREE))
            receipt.assert_not_called()
        with patch.dict(os.environ, ENV), patch.object(
            validation, "receipt", return_value="d" * 40
        ), patch.object(validation, "pages", return_value=iter([])):
            self.assertFalse(validation.reuse_publication(REPO, SHA, TREE))

    def test_retry_uses_successful_prior_evidence_or_requires_validation(self):
        with patch.dict(os.environ, ENV), patch.object(
            validation, "receipt", return_value=TREE
        ) as receipt, patch.object(
            validation,
            "pages",
            return_value=iter(
                [
                    {
                        "name": f"validation-{PR_SHA}-1",
                        "expired": False,
                        "workflow_run": {"id": 10},
                    }
                ]
            ),
        ) as pages:
            self.assertTrue(validation.reuse_publication(REPO, PR_SHA, TREE))
            receipt.assert_called_once_with(REPO, 10, PR_SHA)
            self.assertEqual(pages.call_args.args[0], f"repos/{REPO}/actions/artifacts")
        with patch.dict(os.environ, ENV), patch.object(
            validation, "receipt", return_value=None
        ), patch.object(
            validation,
            "pages",
            return_value=iter(
                [
                    {
                        "name": f"validation-{PR_SHA}-1",
                        "expired": False,
                        "workflow_run": {"id": 10},
                    }
                ]
            ),
        ):
            self.assertFalse(validation.reuse_publication(REPO, PR_SHA, TREE))

    def test_api_pagination_includes_boundary_page(self):
        with patch.object(
            validation,
            "api",
            side_effect=[{"artifacts": list(range(100))}, {"artifacts": [100]}],
        ) as api:
            self.assertEqual(
                list(validation.pages("example?name=validation", "artifacts")),
                list(range(101)),
            )
            self.assertIn("page=2", api.call_args.args[0])

    def test_unavailable_api_falls_back_without_claiming_success(self):
        with tempfile.TemporaryDirectory() as root:
            output = str(Path(root) / "output")
            with patch.dict(os.environ, {**ENV, "GITHUB_OUTPUT": output}), patch.object(
                validation.subprocess, "check_output", return_value=TREE
            ), patch.object(
                validation, "api", side_effect=subprocess.CalledProcessError(1, "gh")
            ):
                validation.main("main")
            self.assertEqual(Path(output).read_text(), f"sha={SHA}\nreused=false\n")

    def test_invalid_continuation_inputs_do_not_call_github(self):
        for overrides in [
            {"MERGED_SHA": PR_SHA},
            {"VALIDATED_SHA": "bad"},
            {"SOURCE_RUN": "bad"},
        ]:
            with patch.dict(os.environ, {**ENV, **overrides}), patch.object(
                validation, "api"
            ) as api:
                self.assertFalse(validation.reuse_main(REPO, SHA, TREE))
                api.assert_not_called()

    def test_lightweight_and_annotated_tags_resolve_exact_commit(self):
        for annotated in [False, True]:
            responses = [
                {"object": {"type": "tag" if annotated else "commit", "sha": PR_SHA}}
            ]
            if annotated:
                responses.append({"object": {"type": "commit", "sha": SHA}})
            expected = SHA if annotated else PR_SHA
            responses.append({"sha": expected, "tree": {"sha": TREE}})
            with patch.object(validation, "api", side_effect=responses):
                self.assertEqual(validation.tag_commit(REPO, "1.2.3"), (expected, TREE))
        with self.assertRaises(ValueError):
            validation.tag_commit(REPO, "main")

    def test_current_run_can_be_in_progress_but_prior_run_cannot(self):
        self.run["status"] = "in_progress"
        with patch.object(validation, "api", self.api):
            self.assertEqual(validation.receipt(REPO, "10", PR_SHA, current=True), TREE)
            self.assertIsNone(validation.receipt(REPO, "10", PR_SHA))


if __name__ == "__main__":
    unittest.main()
