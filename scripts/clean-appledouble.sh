#!/usr/bin/env bash
#
# Remove macOS AppleDouble "._*" files (and .DS_Store) that get created when
# working on non-APFS/exFAT volumes. Safe to run repeatedly.
#
# Usage:
#   ./scripts/clean-appledouble.sh          # clean the repo root
#   ./scripts/clean-appledouble.sh /path    # clean a specific directory

set -euo pipefail

# Target directory: first arg, or the repo root (parent of this script).
TARGET="${1:-"$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"}"

if [[ ! -d "$TARGET" ]]; then
  echo "Error: '$TARGET' is not a directory" >&2
  exit 1
fi

echo "Cleaning AppleDouble files under: $TARGET"

# Prune heavy/irrelevant dirs (deps and VCS) for speed.
PRUNE=(-type d \( -name node_modules -o -name .git \) -prune -o)

# Count first for a clear report, then delete.
dot_underscore=$(find "$TARGET" "${PRUNE[@]}" -type f -name '._*' -print | wc -l | tr -d ' ')
ds_store=$(find "$TARGET" "${PRUNE[@]}" -type f -name '.DS_Store' -print | wc -l | tr -d ' ')

find "$TARGET" "${PRUNE[@]}" -type f -name '._*' -delete 2>/dev/null || true
find "$TARGET" "${PRUNE[@]}" -type f -name '.DS_Store' -delete 2>/dev/null || true

echo "Removed ${dot_underscore} '._*' file(s) and ${ds_store} '.DS_Store' file(s)."
