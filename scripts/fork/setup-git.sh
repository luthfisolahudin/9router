#!/usr/bin/env bash
set -euo pipefail

# Local clone settings for the fork's sync workflow. rerere replays conflict
# resolutions across rebases; the package.json resolver in this directory is the
# committed cross-machine fallback.
git config rerere.enabled true
git config rerere.autoupdate false
git config merge.conflictStyle zdiff3

echo "Configured rerere.enabled, rerere.autoupdate=false, merge.conflictStyle=zdiff3"
