'use strict';
/**
 * The README/marketing demo GIF: the real extension, hovering a real link on the
 * Wikipedia-styled sample page, dots appearing, the bar opening, and the cursor
 * visiting every action in turn.
 *
 *   node tools/build-demo-wikipedia.js      -> docs/demo-wikipedia.gif
 *
 * Needs Google Chrome and, for the final assembly step, python3 with Pillow — same
 * requirement as tools/build-demo-gif.sh, see its header for the venv one-liner. Set
 * PYTHON to point at it if it's not just `python3` on PATH.
 *
 * This is not a Chrome Web Store asset — the Store's screenshot slots only take static
 * PNG/JPEG, so this GIF has nowhere to go there. It exists for the README and for
 * sharing elsewhere.
 *
 * Two things this script has to work around that a single static screenshot doesn't:
 *
 * 1. `Page.captureScreenshot` never draws the OS pointer, so without extra work every
 *    frame would show buttons lighting up with no visible cursor. The fix is a small
 *    synthetic cursor injected into the page. It has to render *above* the extension's
 *    menu, and a plain z-indexed element can't — content.js's menu is a Popover, and
 *    the top layer always wins over z-index regardless of value (see the comment on
 *    SUPPORTS_POPOVER in src/content.js). So the synthetic cursor is a Popover too
 *    (`popover="manual"`, the same attribute content.js uses), and before every frame
 *    the driver hides and re-shows it — which always re-promotes it to the top of the
 *    top-layer stack, on top of whatever content.js is showing, with no assumption
 *    about which of the two opened first.
 *
 * 2. The menu renders inside a *closed* shadow root — see tools/lib/menu-geometry.js
 *    for why the crop box and the button positions are computed rather than queried.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { CDP, launchChrome, loadExtension, zoomBox, sleep } = require('./lib/cdp');
const { barBoxFor, gripBoxFor, gripCenter, buttonCenter, BTN_COUNT } =
  require('./lib/menu-geometry');
const { serveRepo } = require('./lib/serve');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'demo-wikipedia.gif');
const CHROME = process.env.CHROME
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PYTHON = process.env.PYTHON || 'python3';
const PORT = Number(process.env.PORT || 8752);
const SCALE = 2;
// Matches build-store-shots.js's viewport — #demo-link sits well down the sample page,
// and a shorter viewport puts it below the fold, where dispatched mouse coordinates
// land outside the visible area and never actually hover the link.
const VIEW_W = 1280, VIEW_H = 800;

/**
 * A small arrow glyph, tip at its own (0,0), promoted to the top layer as a Popover so
 * it can render above content.js's menu (see the file header).
 *
 * `ensure()` recreates the element whenever it's missing rather than assuming a
 * one-time setup call persists — a `Page.reload` in the "dots" retry loop below wipes
 * all page state including this, and a positioning call landing on a torn-down element
 * would otherwise throw or (before tools/lib/cdp.js surfaced page-side exceptions)
 * silently no-op, leaving every later frame cursor-less with nothing in the log to say
 * why. Self-healing on every call sidesteps needing that to never happen.
 */
function positionCursor(x, y) {
  return `(() => {
    function ensure() {
      let el = document.getElementById('hylink-demo-cursor');
      if (el) return el;
      el = document.createElement('div');
      el.id = 'hylink-demo-cursor';
      el.setAttribute('popover', 'manual');
      el.style.cssText =
        'position:fixed;margin:0;padding:0;border:0;inset:auto;left:0;top:0;' +
        'background:none;pointer-events:none;';
      el.innerHTML = '<svg width="20" height="20" viewBox="0 0 13 19" ' +
        'style="display:block;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.5))">' +
        '<path d="M0,0 L0,14.5 L4,11.3 L6.7,17.3 L9,16.3 L6.3,10.3 L11.5,10.3 Z" ' +
        'fill="#fff" stroke="#111" stroke-width="1.1" stroke-linejoin="round"/></svg>';
      document.body.appendChild(el);
      return el;
    }
    const el = ensure();
    el.style.left = '${x}px'; el.style.top = '${y}px';
    try { if (!el.matches(':popover-open')) el.showPopover(); } catch (_) {}
    return true;
  })()`;
}

/**
 * Re-promotes the cursor to the top of the top-layer stack. Must run immediately
 * before every capture, not just after every move: content.js's menu popover only
 * calls its own showPopover() the *first* time it opens (openMenu()'s promote() no-ops
 * once :popover-open is already true), and that first open can land during a sleep()
 * that comes after a moveTo() — a reshow done only in moveTo() would then be stacked
 * *under* a menu that hadn't opened yet when it ran.
 */
function bringCursorToFront() {
  return `(() => {
    const el = document.getElementById('hylink-demo-cursor');
    if (!el) return false;   // moveTo()'s positionCursor() always runs first and creates it
    try { el.hidePopover(); } catch (_) {}
    try { el.showPopover(); } catch (_) {}
    return true;
  })()`;
}

(async () => {
  const workDir = fs.mkdtempSync('/tmp/hylink-demo-');
  const server = serveRepo(ROOT, { port: PORT });
  const profile = fs.mkdtempSync('/tmp/hylink-demo-profile-');
  const chrome = launchChrome({ chromePath: CHROME, profileDir: profile, windowSize: '1300,900' });
  const cdp = new CDP(chrome);
  const extId = await loadExtension(cdp, ROOT);
  console.log('loaded ' + extId);

  const page = await cdp.open(`http://127.0.0.1:${PORT}/`, { scale: SCALE, width: VIEW_W, height: VIEW_H });
  const session = page.sessionId;

  const rect = await cdp.eval(session, `(() => {
    const a = document.getElementById('demo-link');
    const r = a.getClientRects(); const last = r[r.length - 1];
    return { right: last.right, top: last.top, bottom: last.bottom, height: last.height };
  })()`);
  if (!rect) throw new Error('could not find #demo-link on the sample page');
  const y = (rect.top + rect.bottom) / 2;

  const gripBox = gripBoxFor(rect);
  const barBox = barBoxFor(gripBox);
  const grip = gripCenter(gripBox);

  const cropCss = zoomBox(barBox, { pad: 60, viewportW: VIEW_W, viewportH: VIEW_H });
  const crop = [cropCss.left, cropCss.top, cropCss.right, cropCss.bottom]
    .map(n => Math.round(n * SCALE));

  const shown = () => cdp.eval(session, "!!document.querySelector('hylink-root')");
  const frames = [];
  const durations = [];
  async function moveTo(x, y) {
    await cdp.move(session, x, y);
    await cdp.eval(session, positionCursor(x, y));
  }
  async function capture(ms) {
    await cdp.eval(session, bringCursorToFront());
    const n = frames.length + 1;
    const file = path.join(workDir, 'f-' + String(n).padStart(2, '0') + '.png');
    await cdp.shootRaw(session, file);
    frames.push(file);
    durations.push(ms);
    return file;
  }

  /* 1 — dots appear ----------------------------------------------------------------- */
  console.log('dots:');
  // Same "leave and come back until it actually shows" retry as build-store-shots.js —
  // a pointerover missed while the content script's listeners are still attaching
  // never fires again while the pointer stays on the same link.
  let ready = false;
  for (let attempt = 0; attempt < 4 && !ready; attempt++) {
    if (attempt) { await cdp.send('Page.reload', {}, session); await sleep(2500); }
    for (let i = 0; i < 3 && !ready; i++) {
      await moveTo(60, 620);
      await sleep(200);
      await moveTo(rect.right - 30, y);
      await sleep(700);        // 220ms hover delay + 90ms fade + 200ms pop, with margin
      ready = await shown();
    }
  }
  if (!ready) throw new Error('the grip never appeared — nothing to animate');
  const dotsFrame = await capture(700);

  /* 2 — the bar opens ---------------------------------------------------------------- */
  console.log('bar opens:');
  await moveTo(grip.x, grip.y);
  await sleep(350);
  if (!(await shown())) throw new Error('the menu vanished when the pointer reached the grip');
  const barFrame = await capture(700);
  if (fs.readFileSync(barFrame).equals(fs.readFileSync(dotsFrame))) {
    throw new Error('the bar never expanded — the grip and bar frames are identical');
  }

  /* 3 — the cursor visits every action ----------------------------------------------- */
  console.log('actions:');
  for (let i = 0; i < BTN_COUNT; i++) {
    const c = buttonCenter(barBox, i);
    await moveTo(c.x, c.y);
    await sleep(450);
    if (!(await shown())) {
      throw new Error(`the menu vanished while visiting button ${i} — ` +
        'tools/lib/menu-geometry.js has probably drifted from src/content.js\'s CSS');
    }
    await capture(550);
  }

  /* 4 — closing ------------------------------------------------------------------- */
  console.log('closing:');
  await moveTo(gripBox.left - 15, gripBox.top - 25);
  await sleep(500);
  await capture(900);

  chrome.kill();
  server.close();
  await sleep(400);
  for (const dir of [profile]) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* harmless */ }
  }

  console.log('assembling gif:');
  execFileSync(PYTHON,
    [path.join(ROOT, 'tools', 'assemble-gif.py'), workDir, OUT, '500', crop.join(','), durations.join(',')],
    { stdio: 'inherit' });

  if (!process.env.KEEP_FRAMES) {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (_) { /* harmless */ }
  } else {
    console.log('kept raw frames in ' + workDir);
  }
  process.exit(0);
})().catch(err => { console.error(err.message || err); process.exit(1); });
