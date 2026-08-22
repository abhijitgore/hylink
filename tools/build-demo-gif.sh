#!/bin/sh
# Rebuilds docs/demo-light.gif and docs/demo-dark.gif from the options page's own
# animation, so the README shows exactly what ships rather than a separate mock-up.
#
# Needs: Google Chrome, python3 with Pillow, and a local server for the repo root.
#
#   python3 -m venv /tmp/gifenv && /tmp/gifenv/bin/pip install pillow
#   PYTHON=/tmp/gifenv/bin/python sh tools/build-demo-gif.sh
#
# --disable-threaded-animation is not optional: opacity/transform animations run on
# the compositor, which --virtual-time-budget does not advance, so without it the
# action bar never appears in a capture.
set -e

CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
PYTHON=${PYTHON:-python3}
PORT=${PORT:-8749}
FRAMES=32
STEP=250            # ms between frames; FRAMES * STEP must equal the CSS loop (8s)
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"; kill $SERVER 2>/dev/null || true' EXIT

(cd "$ROOT" && python3 -m http.server "$PORT" >/dev/null 2>&1) &
SERVER=$!
sleep 1

shoot() {   # shoot <scheme> <output.gif>
  scheme=$1
  out=$2
  i=1
  while [ "$i" -le "$FRAMES" ]; do
    "$CHROME" --headless --disable-gpu --hide-scrollbars --disable-threaded-animation \
      --force-device-scale-factor=2 --window-size=700,420 \
      --blink-settings=preferredColorScheme="$scheme" \
      --virtual-time-budget=$((i * STEP)) \
      --screenshot="$WORK/f-$(printf %02d "$i").png" \
      "http://localhost:$PORT/ui/options.html" >/dev/null 2>&1
    i=$((i + 1))
  done
  "$PYTHON" "$ROOT/tools/assemble-gif.py" "$WORK" "$out" "$STEP"
  rm -f "$WORK"/f-*.png
}

# preferredColorScheme: 0 is dark, 1 is light. Anything else silently renders light,
# which is how the first "dark" build came out identical to the light one.
shoot 1 "$ROOT/docs/demo-light.gif"
shoot 0 "$ROOT/docs/demo-dark.gif"
