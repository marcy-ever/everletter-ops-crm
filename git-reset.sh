#!/bin/bash
# Sync this checkout to exactly match origin/main, discarding local changes.
# Refuses when the working tree is dirty unless --force, so it can't silently
# destroy work in progress. Untracked files are left alone.
set -e

BRANCH="${BRANCH:-main}"

if [ "$1" != "--force" ] && [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Working tree has uncommitted changes:" >&2
  git status --short --untracked-files=no >&2
  echo "" >&2
  echo "Commit or stash them, or re-run with --force to discard them." >&2
  exit 1
fi

git fetch origin
git checkout "$BRANCH"
git reset --hard "origin/${BRANCH}"
echo "Now at: $(git log --oneline -1)"
