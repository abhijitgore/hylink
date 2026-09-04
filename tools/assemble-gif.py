#!/usr/bin/env python3
"""Crops rendered frames to a box and writes an animated GIF.

Called by tools/build-demo-gif.sh and tools/build-demo-wikipedia.js; needs Pillow.

    assemble-gif.py WORK OUT STEP [BOX] [DURATIONS]

WORK is a directory of frames named f-*.png, sorted and used in that order. STEP is
the default per-frame duration in ms, used as-is unless DURATIONS overrides it.

BOX, if given, is an explicit "left,top,right,bottom" crop rectangle in the frames' own
pixel space (i.e. already at whatever device-scale-factor they were captured at) — for
a page with no fixed demo box to detect, like tools/shots/wikipedia.html. Without it,
the crop is found by looking for the options page's own demo box border (see below),
which is what tools/build-demo-gif.sh relies on.

DURATIONS, if given, is a comma-separated list of per-frame ms, one entry per frame —
so a hover a viewer should register can hold longer than a quick transition between
two hovers. It must have exactly as many entries as there are frames; without it every
frame holds for STEP, same as before this option existed.
"""
import glob
import os
import sys

from PIL import Image

WORK, OUT, STEP = sys.argv[1], sys.argv[2], int(sys.argv[3])
BOX = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] else None
DURATIONS = sys.argv[5] if len(sys.argv) > 5 and sys.argv[5] else None

BORDERS = ((0x33, 0x41, 0x55), (0xE2, 0xE8, 0xF0))   # --line, dark and light
EXPECTED_HEIGHT = 302                                 # 150px stage + border, at 2x
COLOURS = 48


def edges(pixels, size, colour, tol=14):
    """Rows and columns that are mostly this colour — the box's border lines."""
    width, height = size
    def near(c):
        return all(abs(a - b) <= tol for a, b in zip(c, colour))
    rows = [y for y in range(height)
            if sum(near(pixels[x, y]) for x in range(0, width, 3)) > width // 24]
    cols = [x for x in range(width)
            if sum(near(pixels[x, y]) for y in range(0, height, 3)) > 20]
    return rows, cols


def find_box(image):
    """Auto-detects the options page's own bordered demo box (the fallback when no
    explicit BOX is given)."""
    pixels = image.load()
    for colour in BORDERS:
        rows, cols = edges(pixels, image.size, colour)
        for top in rows:
            for bottom in rows:
                if abs((bottom - top) - EXPECTED_HEIGHT) <= 12 and cols:
                    return (cols[0] + 1, top + 1, cols[-1], bottom)
    raise SystemExit('could not find the demo box in the capture')


frames = [Image.open(p).convert('RGB') for p in sorted(glob.glob(os.path.join(WORK, 'f-*.png')))]
if not frames:
    raise SystemExit('no frames to assemble')

box = tuple(int(n) for n in BOX.split(',')) if BOX else find_box(frames[0])
cropped = [f.crop(box) for f in frames]
# Flat UI colours, so a small palette and no dithering keeps the file well under a MB.
palette = [f.quantize(colors=COLOURS, method=Image.MEDIANCUT, dither=Image.NONE)
           for f in cropped]

if DURATIONS:
    durations = [int(n) for n in DURATIONS.split(',')]
    if len(durations) != len(palette):
        raise SystemExit(f'DURATIONS has {len(durations)} entries for {len(palette)} frames')
else:
    durations = STEP

palette[0].save(OUT, save_all=True, append_images=palette[1:], duration=durations,
                loop=0, optimize=True, disposal=2)
print(f'{OUT}: {len(palette)} frames, {cropped[0].size[0]}x{cropped[0].size[1]}, '
      f'{os.path.getsize(OUT) // 1024} kB')
