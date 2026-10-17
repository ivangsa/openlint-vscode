#!/usr/bin/env bash
# Package and publish the extension. semantic-release runs this during prepare,
# after it has written the next version into package.json and before it commits,
# tags, or pushes. A marketplace failure leaves git unchanged.
set -euo pipefail

version="$(node -p "require('./package.json').version")"
echo "Publishing ${version}"

root="$(pwd)"
openlint_dir="${root}/../openlint"
if [ ! -f "${openlint_dir}/package.json" ]; then
  echo "OpenLint checkout is missing at ${openlint_dir}."
  exit 1
fi

(
  cd "${openlint_dir}"
  export HUSKY=0
  node .yarn/releases/yarn-3.5.0.cjs install --immutable
  node .yarn/releases/yarn-3.5.0.cjs build
)

if [[ "${version}" == *-* ]]; then
  pnpm run package -- --pre-release
else
  pnpm run package
fi

if [ -z "${VSCE_PAT:-}" ]; then
  echo "Add the VSCE_PAT repository secret (Azure DevOps PAT with Marketplace Manage scope)."
  exit 1
fi
if [ -z "${OVSX_PAT:-}" ]; then
  echo "Add the OVSX_PAT repository secret (Open VSX access token)."
  exit 1
fi

shopt -s nullglob
vsix=( *.vsix )
if [ "${#vsix[@]}" -ne 1 ]; then
  echo "Expected one .vsix file, found ${#vsix[@]}."
  exit 1
fi

pre=()
if [[ "${version}" == *-* ]]; then
  pre+=(--pre-release)
fi

pnpm exec vsce publish --packagePath "${vsix[0]}" --skip-duplicate "${pre[@]}"
# Open VSX reads the pre-release flag from the VSIX.
pnpm exec ovsx publish "${vsix[0]}" --skip-duplicate
