#!/bin/sh
# Renders icons/*.png from tools/icons/icon.svg, and the Web Store's own icon from
# store-icon.svg.
#
#   sh tools/icons/build.sh
#
# Each file is rendered ONCE at 512 and resampled down. Rendering each size directly
# does not work: --window-size sets a viewport, not a scale, so a 16x16 window against
# a 128x128 SVG captures the top-left corner rather than the whole icon. Resampling
# also gives cleaner gradients at 16 px than rasterising there would.
set -eu

CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

render() {  # render <svg> <out.png>   — always 512x512
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

# The store wants the artwork at 96x96 inside a 128x128 canvas, unlike the toolbar
# icons, which should fill their box.
render "$ROOT/tools/icons/store-icon.svg" "$ROOT/docs/store/store-icon-128.png"
sips -z 128 128 "$ROOT/docs/store/store-icon-128.png" >/dev/null 2>&1
echo "  docs/store/store-icon-128.png"
