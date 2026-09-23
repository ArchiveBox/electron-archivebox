#!/usr/bin/env -S uv run --no-project python
"""Restore successful main CI captures, retaining their original provenance."""

import argparse
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import urlopen

REPO = "ArchiveBox/electron-archivebox"
PLATFORMS = ("linux", "windows", "macos")
ARTIFACT_NAMES = ("site-screenshots", *(f"archivebox-screenshots-{platform}" for platform in PLATFORMS))
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("destination", type=Path)
args = parser.parse_args()
args.destination.mkdir(parents=True, exist_ok=True)


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / ".github/pages"))
import artifacts


def restore_artifact():
    for run in artifacts.runs(REPO, "ci.yml", "main", artifact_names=ARTIFACT_NAMES):
        names = artifacts.names(REPO, run)
        downloads = (
            [("site-screenshots", args.destination)]
            if "site-screenshots" in names
            else [
                (f"archivebox-screenshots-{platform}", args.destination / platform)
                for platform in PLATFORMS
            ]
        )
        if not all(name in names for name, _ in downloads):
            continue
        for name, destination in downloads:
            artifacts.download(REPO, run, name, destination)
        return run
    return None


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
    run = artifacts.api(REPO, f"actions/runs/{next(iter(run_ids))}")
    if not artifacts.trusted(run, REPO, "ci.yml", "main"):
        raise ValueError("Published captures must come from successful main CI")
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(fetch, files))

versions = {
    json.loads((args.destination / platform / "manifest.json").read_text())["appVersion"]
    for platform in PLATFORMS
}
if len(versions) != 1 or not re.fullmatch(r"\d+\.\d+\.\d+", next(iter(versions))):
    raise ValueError("Platform captures disagree on the app version")
metadata = {
    "commit": run["head_sha"],
    "runId": str(run["id"]),
    "appVersion": versions.pop(),
}
(args.destination / "capture-run.json").write_text(json.dumps(metadata) + "\n")
print(f"Restored captures from successful main CI run {run['id']} ({run['head_sha']})")
