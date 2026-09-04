'use strict';
/**
 * Chrome Web Store images — the real extension on a real page, not a mock-up of it.
 *
 *   node tools/build-store-shots.js      -> docs/store/*.png
 *
 * The CDP-over-pipe plumbing (why a pipe, why headed, why Extensions.loadUnpacked
 * instead of --load-extension) lives in tools/lib/cdp.js, shared with
 * tools/build-demo-wikipedia.js.
 *
 * Store images must be exactly 1280x800. The hover/grip shots are captured at 3x and
 * cropped tight around the menu before being scaled back up to that size — a "zoom",
 * not just a bigger page — because the menu is a few dozen pixels in an otherwise
 * full-page shot and is unreadable at listing thumbnail size otherwise. The settings
 * and promo-tile shots stay full-frame, captured at 2x/4x and resampled down as before.
 */
const fs = require('fs');
const path = require('path');
const { CDP, launchChrome, loadExtension, cropAndResize, resize, zoomBox, sleep } =
  require('./lib/cdp');
const { GRIP_GAP, GRIP_W, gripBoxFor, barBoxFor } = require('./lib/menu-geometry');
const { serveRepo } = require('./lib/serve');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'store');
const CHROME = process.env.CHROME
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.PORT || 8751);
const W = 1280, H = 800;
const ZOOM_SCALE = 3;   // captured native resolution for the crops, ahead of the upscale

/** Captures a raw (unresized) frame — callers decide whether to resize or crop+zoom. */
async function shootRawNamed(cdp, session, name) {
  const file = path.join(OUT, name);
  await cdp.shootRaw(session.sessionId, file);
  return file;
}

async function shootFrame(cdp, session, name, { w = W, h = H } = {}) {
  const file = await shootRawNamed(cdp, session, name);
  resize(file, w, h);
  console.log('  ' + path.relative(ROOT, file));
  return file;
}

/** Crops `file` (captured at `session.scale`) to a zoomed box around `box` (CSS px). */
function zoomShot(file, session, box) {
  const z = zoomBox(box, { viewportW: session.width, viewportH: session.height });
  const s = session.scale;
  cropAndResize(file,
    { left: z.left * s, top: z.top * s, right: z.right * s, bottom: z.bottom * s }, W, H);
}

/* --------------------------------------------------------------------------- main */
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = serveRepo(ROOT, { port: PORT });

  const profile = fs.mkdtempSync('/tmp/hylink-shots-');
  const chrome = launchChrome({ chromePath: CHROME, profileDir: profile });
  const cdp = new CDP(chrome);
  const extId = await loadExtension(cdp, ROOT);
  console.log('loaded ' + extId);

  /* 1 + 2 — the menu on the sample encyclopedia page -------------------------------- */
  console.log('hover shots:');
  const page = await cdp.open(`http://127.0.0.1:${PORT}/`, { scale: ZOOM_SCALE });
  const rect = await cdp.eval(page.sessionId, `(() => {
    const a = document.getElementById('demo-link');
    const r = a.getClientRects(); const last = r[r.length - 1];
    return { right: last.right, top: last.top, bottom: last.bottom, height: last.height };
  })()`);
  if (!rect) throw new Error('could not find #demo-link on the sample page');
  const y = (rect.top + rect.bottom) / 2;

  const gripBox = gripBoxFor(rect);
  const barBox = barBoxFor(gripBox);

  /**
   * Hovering once and sleeping is not enough: on a page that has only just loaded the
   * content script may not have its listeners attached yet, and a missed `pointerover`
   * never fires again while the pointer stays on the same link. So leave the link and
   * come back until the menu actually exists — and fail loudly if it never does, since
   * the failure mode otherwise is a screenshot of an ordinary web page.
   */
  const shown = () => cdp.eval(page.sessionId, "!!document.querySelector('hylink-root')");
  let ready = false;
  for (let attempt = 0; attempt < 4 && !ready; attempt++) {
    // A reload, not just another hover. If the page won the race against the
    // extension registering, it has no content script at all and never will —
    // content scripts are injected at navigation, so only a fresh load can fix it.
    if (attempt) {
      await cdp.send('Page.reload', {}, page.sessionId);
      await sleep(2500);
    }
    for (let i = 0; i < 3 && !ready; i++) {
      // Leave the link and come back: a `pointerover` missed while the listeners were
      // still attaching never fires again while the pointer stays on the same element.
      await cdp.move(page.sessionId, 60, 720);              // somewhere blank
      await sleep(200);
      await cdp.move(page.sessionId, rect.right - 30, y);   // hover the link
      await sleep(800);                                     // 220ms delay, then the fade
      ready = await shown();
    }
  }
  if (!ready) throw new Error('the menu never appeared — nothing to screenshot');
  const gripFile = await shootRawNamed(cdp, page, 'screenshot-2-grip.png');

  // The menu lives in a closed shadow root, so there is nothing to query for its
  // position — the grip's placement is re-derived here the way content.js derives it.
  await cdp.move(page.sessionId, rect.right + GRIP_GAP + GRIP_W / 2, y);
  await sleep(1200);
  const barFile = await shootRawNamed(cdp, page, 'screenshot-1-actions.png');
  // The bar is far bigger than the grip, so two identical raw captures mean the
  // pointer missed the capsule and both shots caught the same state.
  if (fs.readFileSync(barFile).equals(fs.readFileSync(gripFile))) {
    throw new Error('the action bar never opened — both shots are the same image');
  }
  zoomShot(gripFile, page, gripBox);
  zoomShot(barFile, page, barBox);
  console.log('  ' + path.relative(ROOT, gripFile));
  console.log('  ' + path.relative(ROOT, barFile));

  /* 3 — the settings page ---------------------------------------------------------- */
  console.log('settings page + promo tile:');
  // The page's own demo runs on an 8s loop and the action bar is only open between 45%
  // and 88% of it. Landing anywhere else catches the grip mid-flight, sitting on top of
  // the sentence, which reads as a rendering bug rather than a feature.
  const options = await cdp.open(`chrome-extension://${extId}/ui/options.html`, { settle: 5600 });
  await shootFrame(cdp, options, 'screenshot-3-settings.png');

  // The intro shot above is the pitch (the demo, the enable toggle); this one is the
  // actual configuration surface — the reorderable, toggleable action list is the
  // richest control on the page, more representative of "configuring HyLink" than the
  // top of the page (which is mostly explainer text) ever was.
  await cdp.eval(options.sessionId, `(() => {
    const section = document.getElementById('actions').closest('section');
    window.scrollTo(0, window.scrollY + section.getBoundingClientRect().top - 24);
    return true;
  })()`);
  await sleep(300);
  await shootFrame(cdp, options, 'screenshot-4-config.png');

  /* 4 — the promo tile ------------------------------------------------------------- */
  const tile = await cdp.open(`http://127.0.0.1:${PORT}/tools/shots/tile.html`,
    { scale: 4, width: 440, height: 280, settle: 800 });
  await shootFrame(cdp, tile, 'promo-440x280.png', { w: 440, h: 280 });

  chrome.kill();
  server.close();
  await sleep(600);                                  // Chrome flushes the profile on
  try { fs.rmSync(profile, { recursive: true, force: true }); }   // its way out
  catch (_) { /* a leftover temp profile is harmless */ }
  process.exit(0);
})().catch(err => { console.error(err.message || err); process.exit(1); });
