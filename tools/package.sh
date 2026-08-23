#!/bin/sh
# Builds the Chrome Web Store upload: a zip with manifest.json at its root and nothing
# in it that is not part of the running extension. Anything the store does not execute
# — tests, build tooling, the README's GIFs, notes to myself — stays out, because every
# file in the package is a file a reviewer can ask about.
#
#   sh tools/package.sh          -> dist/hylink-<version>.zip
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

version=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' manifest.json | head -1)
[ -n "$version" ] || { echo "could not read version from manifest.json" >&2; exit 1; }

out="dist/hylink-$version.zip"
mkdir -p dist
rm -f "$out"

# An allow-list, not an ignore-list: a new top-level directory should have to be added
# here on purpose rather than ship because nobody remembered to exclude it.
zip -q -r -X "$out" manifest.json LICENSE icons src ui _locales \
  -x '*.DS_Store' -x '__MACOSX/*'

echo "$out"
unzip -l "$out" | tail -1
