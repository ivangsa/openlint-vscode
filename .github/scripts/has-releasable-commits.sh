#!/usr/bin/env bash
# Exit 0 when commits since the last v* tag should publish a new version.
# feat and fix follow conventional commits. A breaking change is major,
# including refactor!: and a BREAKING CHANGE footer.
set -euo pipefail

if last="$(git describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null)"; then
  range="${last}..HEAD"
else
  range="HEAD"
fi

log="$(git log --format=%B ${range})"

if printf '%s\n' "${log}" | grep -Eq '^(feat|fix)(\([^)]*\))?!?:|^[A-Za-z]+(\([^)]*\))?!:|^BREAKING CHANGE:|^BREAKING-CHANGE:'; then
  exit 0
fi

exit 1
