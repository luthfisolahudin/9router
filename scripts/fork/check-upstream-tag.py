#!/usr/bin/env python3
"""
scripts/fork/check-upstream-tag.py

Discovers the latest stable semver Git tag (vX.Y.Z) from the upstream repository.
Uses only standard library (no extra dependencies).
"""

import argparse
import json
import os
import re
import subprocess
import sys

STABLE_SEMVER_PATTERN = re.compile(r"^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")

def get_upstream_tags(upstream_url: str):
    """Fetch git tags from upstream using git ls-remote."""
    cmd = ["git", "ls-remote", "--tags", upstream_url]
    try:
        output = subprocess.check_output(cmd, stderr=subprocess.PIPE, text=True)
    except subprocess.CalledProcessError as e:
        sys.stderr.write(f"Error executing git ls-remote: {e.stderr}\n")
        sys.exit(1)

    peeled = {}
    direct = {}

    for line in output.strip().splitlines():
        if not line:
            continue
        parts = line.split()
        if len(parts) != 2:
            continue
        sha, ref = parts[0], parts[1]
        if ref.endswith("^{}"):
            tag = ref[:-3].replace("refs/tags/", "")
            peeled[tag] = sha
        elif ref.startswith("refs/tags/"):
            tag = ref.replace("refs/tags/", "")
            direct[tag] = sha

    resolved = {}
    for tag, sha in direct.items():
        resolved[tag] = peeled.get(tag, sha)

    stable_tags = []
    for tag, sha in resolved.items():
        m = STABLE_SEMVER_PATTERN.match(tag)
        if m:
            major, minor, patch = map(int, m.groups())
            stable_tags.append(((major, minor, patch), tag, sha))

    if not stable_tags:
        return None

    stable_tags.sort()
    latest_ver, latest_tag, latest_sha = stable_tags[-1]
    return {
        "tag": latest_tag,
        "commit": latest_sha,
        "version": f"{latest_ver[0]}.{latest_ver[1]}.{latest_ver[2]}"
    }

def main():
    parser = argparse.ArgumentParser(description="Find latest stable upstream tag")
    parser.add_argument(
        "--upstream",
        default="https://github.com/decolua/9router.git",
        help="Upstream git repository URL"
    )
    parser.add_argument(
        "--metadata-file",
        default=".github/fork-metadata.json",
        help="Path to fork-metadata.json"
    )
    parser.add_argument(
        "--output-json",
        action="store_true",
        help="Output result as JSON"
    )
    parser.add_argument(
        "--github-output",
        default=os.environ.get("GITHUB_OUTPUT", ""),
        help="Path to GITHUB_OUTPUT environment file"
    )
    args = parser.parse_args()

    # Read current metadata if exists
    current_synced_tag = None
    current_synced_commit = None
    if os.path.exists(args.metadata_file):
        try:
            with open(args.metadata_file, "r", encoding="utf-8") as f:
                meta = json.load(f)
                current_synced_tag = meta.get("synced_tag")
                current_synced_commit = meta.get("synced_commit")
        except Exception as e:
            sys.stderr.write(f"Warning: Failed to read {args.metadata_file}: {e}\n")

    latest = get_upstream_tags(args.upstream)
    if not latest:
        sys.stderr.write("No stable semver tags found in upstream repository.\n")
        sys.exit(1)

    has_update = (latest["tag"] != current_synced_tag) or (latest["commit"] != current_synced_commit)

    result = {
        "latest_tag": latest["tag"],
        "latest_commit": latest["commit"],
        "latest_version": latest["version"],
        "current_tag": current_synced_tag,
        "current_commit": current_synced_commit,
        "has_update": has_update
    }

    if args.output_json:
        print(json.dumps(result, indent=2))
    else:
        print(f"Latest upstream stable tag: {latest['tag']} ({latest['commit']})")
        print(f"Current synced tag: {current_synced_tag} ({current_synced_commit})")
        print(f"Update available: {has_update}")

    if args.github_output:
        try:
            with open(args.github_output, "a", encoding="utf-8") as gh_out:
                gh_out.write(f"latest_tag={latest['tag']}\n")
                gh_out.write(f"latest_commit={latest['commit']}\n")
                gh_out.write(f"latest_version={latest['version']}\n")
                gh_out.write(f"current_tag={current_synced_tag or ''}\n")
                gh_out.write(f"current_commit={current_synced_commit or ''}\n")
                gh_out.write(f"has_update={'true' if has_update else 'false'}\n")
        except Exception as e:
            sys.stderr.write(f"Warning: Failed to write to GITHUB_OUTPUT ({args.github_output}): {e}\n")

if __name__ == "__main__":
    main()
