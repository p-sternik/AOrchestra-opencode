"""Reuse successful release validation; missing evidence always means validate again."""

import io
import json
import os
import re
import subprocess
import sys
import zipfile


def api(path, binary=False):
    raw = subprocess.check_output(["gh", "api", path], stderr=subprocess.PIPE)
    return raw if binary else json.loads(raw)


def pages(path, key):
    page = 1
    while True:
        values = api(f"{path}{'&' if '?' in path else '?'}per_page=100&page={page}")[
            key
        ]
        yield from values
        if len(values) < 100:
            return
        page += 1


def sha(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{40}", value):
        raise ValueError("Invalid Git object ID")
    return value


def commit(repo, revision):
    value = api(f"repos/{repo}/git/commits/{sha(revision)}")
    return sha(value["sha"]), sha(value["tree"]["sha"])


def tag_commit(repo, tag):
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", tag):
        raise ValueError("Invalid release tag")
    obj = api(f"repos/{repo}/git/ref/tags/{tag}")["object"]
    for _ in range(10):
        if obj["type"] == "commit":
            return commit(repo, obj["sha"])
        if obj["type"] != "tag":
            break
        obj = api(f"repos/{repo}/git/tags/{sha(obj['sha'])}")["object"]
    raise ValueError("Release tag does not identify a commit")


def receipt(repo, run_id, revision, current=False):
    if not str(run_id).isdigit():
        return None
    run = api(f"repos/{repo}/actions/runs/{run_id}")
    if (
        run["path"] != ".github/workflows/release.yml"
        or run["head_branch"] != "main"
        or run["head_repository"]["full_name"] != repo
        or run["event"] not in ("push", "workflow_dispatch")
        or (
            not current
            and (run["status"] != "completed" or run["conclusion"] != "success")
        )
        or (current and run["status"] not in ("in_progress", "completed"))
        or (current and run["status"] == "completed" and run["conclusion"] != "success")
    ):
        return None
    name = f"validation-{revision}-{run['run_attempt']}"
    for artifact in pages(f"repos/{repo}/actions/runs/{run_id}/artifacts", "artifacts"):
        if artifact["name"] != name or artifact["expired"]:
            continue
        with zipfile.ZipFile(
            io.BytesIO(
                api(f"repos/{repo}/actions/artifacts/{artifact['id']}/zip", True)
            )
        ) as archive:
            value = json.loads(archive.read("validation.json"))
        if (
            value.get("sha") == revision
            and value.get("repository") == repo
            and str(value.get("run_id")) == str(run_id)
            and str(value.get("run_attempt")) == str(run["run_attempt"])
        ):
            return sha(value["tree"])
    return None


def reuse_main(repo, revision, tree):
    # Inputs only select evidence. They never establish that validation passed.
    if os.environ.get("MERGED_SHA") != revision:
        return False
    previous = os.environ.get("VALIDATED_SHA", "")
    if not re.fullmatch(r"[0-9a-f]{40}", previous):
        return False
    return receipt(repo, os.environ.get("SOURCE_RUN", ""), previous) == tree


def reuse_publication(repo, revision, tree):
    current = os.environ["GITHUB_RUN_ID"]
    if (
        revision == os.environ["GITHUB_SHA"]
        and receipt(repo, current, revision, current=True) == tree
    ):
        return True
    # Artifact discovery also finds successful tag-only retries whose workflow
    # head SHA is newer than the older tag they validated.
    for artifact in pages(f"repos/{repo}/actions/artifacts", "artifacts"):
        if artifact["expired"] or not artifact["name"].startswith(
            f"validation-{revision}-"
        ):
            continue
        run_id = artifact["workflow_run"]["id"]
        if str(run_id) != current and receipt(repo, run_id, revision) == tree:
            return True
    return False


def record():
    value = {
        "sha": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
        "tree": subprocess.check_output(
            ["git", "rev-parse", "HEAD^{tree}"], text=True
        ).strip(),
        "repository": os.environ["GITHUB_REPOSITORY"],
        "run_id": os.environ["GITHUB_RUN_ID"],
        "run_attempt": os.environ["GITHUB_RUN_ATTEMPT"],
    }
    sha(value["sha"])
    sha(value["tree"])
    with open("validation.json", "w", encoding="utf8") as output:
        json.dump(value, output)


def main(mode):
    if mode == "record":
        record()
        return
    repo = os.environ["GITHUB_REPOSITORY"]
    revision, tree = (
        tag_commit(repo, os.environ["RELEASE_TAG"])
        if mode == "publish"
        else (
            sha(os.environ["GITHUB_SHA"]),
            sha(
                subprocess.check_output(
                    ["git", "rev-parse", "HEAD^{tree}"], text=True
                ).strip()
            ),
        )
    )
    try:
        reused = (
            reuse_publication(repo, revision, tree)
            if mode == "publish"
            else reuse_main(repo, revision, tree)
        )
    except (subprocess.CalledProcessError, ValueError, KeyError, zipfile.BadZipFile):
        # Unavailable API/expired artifacts must not bypass validation.
        reused = False
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf8") as output:
        output.write(f"sha={revision}\nreused={str(reused).lower()}\n")
    print("Reusing successful validation" if reused else "Full validation required")


if __name__ == "__main__":
    main(sys.argv[1])
