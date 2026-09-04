'use strict';
/**
 * Shared CDP-over-pipe transport for the capture scripts in this directory
 * (tools/build-store-shots.js, tools/build-demo-wikipedia.js).
 *
 * Chrome deprecated --load-extension in 137 and by 151 ignores it outright, in headless
 * and headed alike; --enable-unsafe-extension-debugging does not bring the switch back.
 * The replacement is the DevTools command Extensions.loadUnpacked, which is gated on
 * --remote-debugging-pipe rather than --remote-debugging-port. Hence the pipe transport
 * below: it is not a preference, it is the only way to get the extension loaded.
 *
 * The pipe is fd 3 to write and fd 4 to read, carrying the same JSON as the WebSocket
 * transport with a NUL byte between messages.
 */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');

const sleep = ms => new Promise(r => setTimeout(r, ms));

class CDP {
  constructor(proc) {
    this.proc = proc;
    this.id = 0;
    this.pending = new Map();
    [, , , this.wr, this.rd] = proc.stdio;
    let buf = '';
    this.rd.on('data', chunk => {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf('\0')) >= 0) {
        const m = JSON.parse(buf.slice(0, i));
        buf = buf.slice(i + 1);
        const p = this.pending.get(m.id);
        if (!p) continue;                       // an event, not a reply
        this.pending.delete(m.id);
        m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.wr.write(JSON.stringify({ id, method, params, sessionId }) + '\0');
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async open(url, { scale = 2, width = 1280, height = 800, settle = 2000 } = {}) {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    // A tab created this way starts backgrounded, and a hidden page gets no animation
    // frames and has its timers clamped to about a second — so a hover would either
    // never resolve or resolve long after the screenshot.
    await this.send('Target.activateTarget', { targetId });
    await this.send('Page.enable', {}, sessionId);
    await this.send('Runtime.enable', {}, sessionId);
    await this.send('Emulation.setDeviceMetricsOverride',
      { width, height, deviceScaleFactor: scale, mobile: false }, sessionId);
    await this.send('Page.navigate', { url }, sessionId);
    await sleep(settle);
    return { targetId, sessionId, scale, width, height };
  }
  eval(sessionId, expression) {
    // returnByValue's own errors reject the CDP call itself; a *thrown* exception
    // inside `expression` instead comes back as a normal reply with exceptionDetails
    // set and result.value undefined — silently swallowing that would turn a real bug
    // in injected page script into "eval just returned undefined" with no trace of why.
    return this.send('Runtime.evaluate', { expression, returnByValue: true }, sessionId)
      .then(r => {
        if (r.exceptionDetails) {
          const msg = r.exceptionDetails.exception && r.exceptionDetails.exception.description
            || r.exceptionDetails.text;
          throw new Error('page eval threw: ' + msg + '\n  in: ' + expression);
        }
        return r.result.value;
      });
  }
  move(sessionId, x, y) {
    return this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 }, sessionId);
  }
  /** Saves the raw screenshot (device pixels, no resizing) to `file`. */
  async shootRaw(sessionId, file) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  }
}

/**
 * Headed, not headless, and this is not a preference either. A headless page reports
 * visibilityState "hidden" and never composites the top layer, so a popover — which is
 * how both the extension's menu and the demo scripts' synthetic cursor render — is
 * built in the DOM exactly as it should be and then photographs as nothing at all. A
 * real window is the only way to capture either.
 */
function launchChrome({ chromePath, profileDir, windowSize = '1400,1000', colorScheme = 1 }) {
  return spawn(chromePath, [
    '--hide-scrollbars',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-features=CalculateNativeWinOcclusion',
    '--window-position=0,0', '--window-size=' + windowSize,
    '--no-first-run', '--no-default-browser-check',
    // 1 is light, 0 is dark. Getting this wrong is silent — any other value renders
    // light without complaint. Left to itself a headed Chrome follows the system, so a
    // machine in dark mode would otherwise put a dark grip on a light page.
    '--blink-settings=preferredColorScheme=' + colorScheme,
    '--user-data-dir=' + profileDir,
    '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
}

async function loadExtension(cdp, rootPath) {
  await cdp.send('Browser.getVersion');                       // waits for the pipe
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: rootPath });
  await sleep(1500);            // registration is not instant
  return id;
}

/**
 * Crops `file` to an arbitrary box (device pixels, {left, top, right, bottom}) and
 * scales the result up to exactly `outW`x`outH` — real store screenshots must be that
 * exact size. Two sips calls: `-c`/`--cropOffset` takes an arbitrary top-left crop
 * (verified empirically — cropOffset is TOP LEFT of the box, not the image centre,
 * which sips's own `-c` alone would give you), then `-z` resizes.
 */
function cropAndResize(file, box, outW, outH) {
  const w = Math.round(box.right - box.left);
  const h = Math.round(box.bottom - box.top);
  execFileSync('sips', ['-c', String(h), String(w),
    '--cropOffset', String(Math.round(box.top)), String(Math.round(box.left)),
    file], { stdio: 'ignore' });
  execFileSync('sips', ['-z', String(outH), String(outW), file], { stdio: 'ignore' });
}

function resize(file, outW, outH) {
  execFileSync('sips', ['-z', String(outH), String(outW), file], { stdio: 'ignore' });
}

/**
 * Pads `box` (CSS px) evenly on every side, then grows whichever dimension is short
 * of `aspect` (default 1280:800) so the result can be scaled up to that ratio without
 * distortion — centred on the original box, clamped to the viewport. The padding is
 * deliberately generous: the box passed in is usually a geometric *estimate* of where
 * the menu sits (its real box is unreadable — it renders inside a closed shadow root),
 * so the margin is the tolerance for that estimate being a little off in any direction.
 */
function zoomBox(box, { pad = 50, aspect = 1280 / 800, viewportW = 1280, viewportH = 800 } = {}) {
  let left = box.left - pad, top = box.top - pad, right = box.right + pad, bottom = box.bottom + pad;
  const cx = (left + right) / 2, cy = (top + bottom) / 2;
  let w = right - left, h = bottom - top;
  if (w / h > aspect) h = w / aspect; else w = h * aspect;
  left = cx - w / 2; right = cx + w / 2;
  top = cy - h / 2; bottom = cy + h / 2;
  // Shift back on-screen if the centred box ran past an edge, rather than shrinking it
  // (shrinking would break the locked aspect ratio again).
  if (left < 0) { right -= left; left = 0; }
  if (top < 0) { bottom -= top; top = 0; }
  if (right > viewportW) { left -= (right - viewportW); right = viewportW; }
  if (bottom > viewportH) { top -= (bottom - viewportH); bottom = viewportH; }
  return { left, top, right, bottom };
}

module.exports = { CDP, launchChrome, loadExtension, cropAndResize, resize, zoomBox, sleep };
