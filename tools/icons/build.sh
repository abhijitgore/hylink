#!/bin/sh
# Renders icons/*.png and docs/store/store-icon-128.png from tools/icons/icon.svg.
#
#   sh tools/icons/build.sh
#
# The store icon is derived here rather than kept as a second file, so the two can
# never drift: it is the same artwork at 96x96 inside a 128x128 canvas, which is what
# the Chrome Web Store asks for. Toolbar icons deliberately fill their box instead.
#
# Each PNG is rendered ONCE at 512 and resampled down. Rendering each size directly
# does not work: --window-size sets a viewport, not a scale, so a 16x16 window against
# a 128x128 SVG captures the top-left corner rather than the whole icon. Resampling
# also gives cleaner gradients at 16 px than rasterising there would.
set -eu

CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

render() {  # render <svg> <out.png>  — always 512x512, transparent
  "$CHROME" --headless --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=4 --window-size=128,128 \
    --default-background-color=00000000 \
    --screenshot="$2" "file://$1" >/dev/null 2>&1
}

render "$ROOT/tools/icons/icon.svg" "$WORK/icon.png"
for size in 16 32 48 128; do
  cp "$WORK/icon.png" "$ROOT/icons/icon$size.png"
  sips -z "$size" "$size" "$ROOT/icons/icon$size.png" >/dev/null 2>&1
  echo "  icons/icon$size.png"
done

python3 - "$ROOT/tools/icons/icon.svg" "$WORK/store-icon.svg" <<'PY'
import sys, pathlib
src = pathlib.Path(sys.argv[1]).read_text()
inner = src.split('>', 1)[1].rsplit('</svg>', 1)[0]
pathlib.Path(sys.argv[2]).write_text(
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" '
    'viewBox="0 0 128 128">\n'
    '  <g transform="translate(16 16) scale(0.75)">' + inner + '</g>\n</svg>\n')
PY
render "$WORK/store-icon.svg" "$ROOT/docs/store/store-icon-128.png"
sips -z 128 128 "$ROOT/docs/store/store-icon-128.png" >/dev/null 2>&1
echo "  docs/store/store-icon-128.png  (96x96 artwork, 16px padding)"
