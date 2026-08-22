#!/bin/sh
# Regenerate the copy of the content script the harness loads. The only change is
# the custom-element name, so the installed extension's UI can be told apart from
# the one under test. Run this after editing src/content.js.
cd "$(dirname "$0")"
sed 's/hylink-root/hylink-harness-root/g' ../../src/content.js > content.harness.js
