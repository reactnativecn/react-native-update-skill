#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${GITHUB_REPOSITORY:?Run from the release workflow}"
: "${GITHUB_SHA:?Missing tested commit}"
: "${GH_TOKEN:?Missing release token}"
version="$(cat VERSION)"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'VERSION must be a stable semver'; exit 1; }
tag="v$version"
notes="releases/$tag.md"
test -s "$notes"

# Refuse to publish a source snapshot superseded while its tests were running.
git fetch --no-tags origin main
if [[ "$(git rev-parse origin/main)" != "$GITHUB_SHA" ]]; then
  echo 'Skipping superseded source snapshot; the newer main run owns publication.'
  exit 0
fi
python3 tools/package_skill.py
python3 tools/package_skill.py --check
git add -- react-native-update.skill
if ! git diff --cached --quiet; then
  git -c user.name='github-actions[bot]' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
    commit -m "chore: synchronize skill package for $tag"
  git push origin HEAD:main
fi
commit="$(git rev-parse HEAD)"
sha256sum react-native-update.skill > SHA256SUMS

state="$(mktemp)"
trap 'rm -f "$state"' EXIT
# Read collection with a successful API call so authorization/network errors are
# never mistaken for a missing release. Release assets are only replaced in drafts.
gh api --paginate "repos/$GITHUB_REPOSITORY/releases?per_page=100" \
  --jq ".[] | select(.tag_name == \"$tag\") | [.draft, .target_commitish] | @tsv" > "$state"
if [[ -s "$state" ]]; then
  IFS=$'\t' read -r draft target < "$state"
  if [[ "$draft" == 'false' ]]; then
    echo "$tag is already published; leaving its tag and assets unchanged."
    exit 0
  fi
  [[ "$target" == "$commit" ]] || { echo 'Existing draft targets a different commit; manual reconciliation required'; exit 1; }
else
  gh release create "$tag" --repo "$GITHUB_REPOSITORY" --draft --target "$commit" \
    --title "react-native-update skill $tag" --notes-file "$notes"
fi
gh release upload "$tag" react-native-update.skill SHA256SUMS --repo "$GITHUB_REPOSITORY" --clobber
gh release edit "$tag" --repo "$GITHUB_REPOSITORY" --draft=false --latest
printf 'Published %s from tested source %s (package commit %s)\n' "$tag" "$GITHUB_SHA" "$commit"
