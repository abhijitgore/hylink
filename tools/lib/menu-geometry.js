'use strict';
/**
 * The menu's on-screen geometry, re-derived rather than queried — src/content.js
 * renders it inside a *closed* shadow root, so nothing outside the content script can
 * read its real box back. These constants mirror the CSS in src/content.js exactly
 * (each call site notes which rule it matches) and the box math mirrors gripPlacement()
 * and growFrom()'s first candidate — the one that wins whenever nothing obstructs it,
 * which every page under tools/shots/ is built to guarantee.
 *
 * Shared by tools/build-store-shots.js and tools/build-demo-wikipedia.js so the two
 * capture scripts can't quietly drift apart from each other, only from content.js —
 * and a change to the menu's CSS is one place to update here, not two.
 */

const GRIP_GAP = 3;                    // content.js GRIP_GAP
const GRIP_W = 22, GRIP_H = 15;        // content.js .menu.grip .dots { width; height }
const BAR_PAD = 4;                     // content.js .menu { padding }
const BTN_W = 30, BTN_H = 28, BTN_GAP = 2, BTN_COUNT = 8;   // content.js .btn, .row
const CAPTION_H = 20;                  // content.js .caption — margin + one text line

const BAR_ROW_W = BTN_COUNT * BTN_W + (BTN_COUNT - 1) * BTN_GAP;
const BAR_W = BAR_PAD * 2 + BAR_ROW_W;
const BAR_H = BAR_PAD * 2 + BTN_H + CAPTION_H;

/** Where the three-dot grip sits, from the link's own getClientRects() rectangle. */
function gripBoxFor(rect) {
  const left = rect.right + GRIP_GAP;
  const top = rect.top + (rect.height - GRIP_H) / 2;
  return { left, top, right: left + GRIP_W, bottom: top + GRIP_H };
}

/**
 * The expanded bar's box. growFrom(gripBox, ...)'s first candidate in content.js is
 * `{ left: from.left, top: from.top }` — the bar grows right and down from the grip's
 * own top-left corner — and wins outright whenever it isn't obstructed.
 */
function barBoxFor(gripBox) {
  return {
    left: gripBox.left, top: gripBox.top,
    right: gripBox.left + BAR_W, bottom: gripBox.top + BAR_H,
  };
}

/** Centre point of the i-th button (0-indexed) in the expanded bar. */
function buttonCenter(barBox, i) {
  return {
    x: barBox.left + BAR_PAD + i * (BTN_W + BTN_GAP) + BTN_W / 2,
    y: barBox.top + BAR_PAD + BTN_H / 2,
  };
}

/** Where the grip sits once the pointer is hovering it — for moving onto the grip. */
function gripCenter(gripBox) {
  return { x: gripBox.left + GRIP_W / 2, y: gripBox.top + GRIP_H / 2 };
}

module.exports = {
  GRIP_GAP, GRIP_W, GRIP_H, BAR_W, BAR_H, BTN_COUNT,
  gripBoxFor, barBoxFor, buttonCenter, gripCenter,
};
