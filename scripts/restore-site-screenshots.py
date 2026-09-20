#!/usr/bin/env python3
"""Restore successful main CI captures, retaining their original provenance."""

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import re
import subprocess
from urllib.request import urlopen

REPO = "ArchiveBox/electron-archivebox"
PLATFORMS = ("linux", "windows", "macos")
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("destination", type=Path)
args = parser.parse_args()
args.destination.mkdir(parents=True, exist_ok=True)


def api(path):
    return json.loads(subprocess.check_output(["gh", "api", f"repos/{REPO}/{path}"]))


def trusted(run):
    return (
        run["head_repository"]["full_name"] == REPO
        and run["head_branch"] == "main"
        and run["event"] in ("push", "workflow_dispatch")
        and run["path"] == ".github/workflows/ci.yml"
        and run["conclusion"] == "success"
    )


def restore_artifact():
    page = 1
    while True:
        runs = api(f"actions/workflows/ci.yml/runs?branch=main&status=success&per_page=50&page={page}")["workflow_runs"]
        for run in runs:
            if not trusted(run):
                continue
            rows = subprocess.check_output([
                "gh", "api", f"repos/{REPO}/actions/runs/{run['id']}/artifacts?per_page=100",
                "--paginate", "--jq", ".artifacts[] | @json",
            ], text=True)
            names = {a["name"] for line in rows.splitlines() if not (a := json.loads(line))["expired"]}
            downloads = [("site-screenshots", args.destination)] if "site-screenshots" in names else [
                (f"archivebox-screenshots-{platform}", args.destination / platform) for platform in PLATFORMS
            ]
            if not all(name in names for name, _ in downloads):
                continue
            for name, destination in downloads:
                subprocess.run(["gh", "run", "download", str(run["id"]), "--repo", REPO,
                                "--name", name, "--dir", str(destination)], check=True)
            return run
        if len(runs) < 50:
            return None
        page += 1


run = restore_artifact()
if run is None:
    # Published captures outlive Actions artifact retention. The builder checks
    # every image digest, dimensions, coverage and original workflow provenance.
    base = "https://electron.archivebox.io/screenshots/"

    def fetch(name):
        with urlopen(base + name, timeout=60) as response:
            data = response.read()
        target = args.destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return data

    run_ids = set()
    files = []
    for platform in PLATFORMS:
        manifest = json.loads(fetch(f"{platform}/manifest.json"))
        run_ids.add(str(manifest["workflowRun"]["id"]))
        for capture in manifest["screenshots"]:
            if not re.fullmatch(r"[a-zA-Z0-9_-]+\.png", capture["file"]):
                raise ValueError("Unsafe screenshot filename")
            files.append(f"{platform}/{capture['file']}")
    if len(run_ids) != 1 or not re.fullmatch(r"[1-9]\d*", next(iter(run_ids))):
        raise ValueError("Published captures must belong to one CI run")
    run = api(f"actions/runs/{next(iter(run_ids))}")
    if not trusted(run):
        raise ValueError("Published captures must come from successful main CI")
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(fetch, files))

package = api(f"contents/package.json?ref={run['head_sha']}")
package = json.loads(base64.b64decode(package["content"]))
major, minor, patch = map(int, package["version"].split("."))
increment = run["run_number"] - package.get("releaseRunBase", 0)
if increment < 0:
    raise ValueError("CI run predates this release series")
metadata = {"commit": run["head_sha"], "runId": str(run["id"]),
            "appVersion": f"{major}.{minor}.{patch + increment}"}
(args.destination / "capture-run.json").write_text(json.dumps(metadata) + "\n")
print(f"Restored captures from successful main CI run {run['id']} ({run['head_sha']})")
