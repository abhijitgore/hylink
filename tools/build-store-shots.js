'use strict';
/**
 * Chrome Web Store images — the real extension on a real page, not a mock-up of it.
 *
 *   node tools/build-store-shots.js      -> docs/store/*.png
 *
 * Chrome deprecated --load-extension in 137 and by 151 ignores it outright, in headless
 * and headed alike; --enable-unsafe-extension-debugging does not bring the switch back.
 * The replacement is the DevTools command Extensions.loadUnpacked, which is gated on
 * --remote-debugging-pipe rather than --remote-debugging-port. Hence the pipe transport
 * below: it is not a preference, it is the only way to get the extension loaded.
 *
 * The pipe is fd 3 to write and fd 4 to read, carrying the same JSON as the WebSocket
 * transport with a NUL byte between messages.
 *
 * The capture also cannot be headless — see the comment on the spawn below. A real
 * window appears for about fifteen seconds while this runs.
 *
 * Store images must be exactly 1280x800, which renders thin and undersampled at a
 * device scale factor of 1, so everything is captured at 2x and resampled with sips.
 */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'store');
const CHROME = process.env.CHROME
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.PORT || 8751);
const W = 1280, H = 800;

const GRIP_GAP = 3, GRIP_W = 22;        // must match src/content.js
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ------------------------------------------------------- CDP over the browser pipe */
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
  async open(url, { scale = 2, width = W, height = H, settle = 2000 } = {}) {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    // A tab created this way starts backgrounded, and a hidden page gets no animation
    // frames and has its timers clamped to about a second — so the hover would either
    // never resolve or resolve long after the screenshot.
    await this.send('Target.activateTarget', { targetId });
    await this.send('Page.enable', {}, sessionId);
    await this.send('Runtime.enable', {}, sessionId);
    await this.send('Emulation.setDeviceMetricsOverride',
      { width, height, deviceScaleFactor: scale, mobile: false }, sessionId);
    await this.send('Page.navigate', { url }, sessionId);
    await sleep(settle);
    return { targetId, sessionId };
  }
  eval(sessionId, expression) {
    return this.send('Runtime.evaluate', { expression, returnByValue: true }, sessionId)
      .then(r => r.result.value);
  }
  move(sessionId, x, y) {
    return this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 }, sessionId);
  }
  async shoot(sessionId, name, w = W, h = H) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    const file = path.join(OUT, name);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    execFileSync('sips', ['-z', String(h), String(w), file], { stdio: 'ignore' });
    console.log('  ' + path.relative(ROOT, file));
  }
}

/* --------------------------------------------------------------------------- main */
(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  // Serves the repo, so the sample article and the options page are both http rather
  // than file:// — content scripts do not run on file:// without a per-extension opt-in.
  const server = http.createServer((req, res) => {
    const rel = req.url === '/' ? 'tools/shots/article.html' : req.url.replace(/^\//, '');
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end(); }
      const type = file.endsWith('.css') ? 'text/css'
        : file.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8';
      res.writeHead(200, { 'content-type': type });
      res.end(buf);
    });
  }).listen(PORT);

  const profile = fs.mkdtempSync('/tmp/hylink-shots-');
  // Headed, not headless, and this is not a preference either. A headless page reports
  // visibilityState "hidden" and never composites the top layer, so the menu — which is
  // a popover — is built in the DOM exactly as it should be and then photographs as
  // nothing at all. A real window is the only way to capture it.
  const chrome = spawn(CHROME, [
    '--hide-scrollbars',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-features=CalculateNativeWinOcclusion',
    '--window-position=0,0', '--window-size=1400,1000',
    '--no-first-run', '--no-default-browser-check',
    // 1 is light, 0 is dark. Getting this wrong is silent — any other value renders
    // light without complaint, which is how the first "dark" GIF came out light. Left
    // to itself a headed Chrome follows the system, so a machine in dark mode would
    // otherwise put a dark grip on a light page.
    '--blink-settings=preferredColorScheme=1',
    '--user-data-dir=' + profile,
    '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });

  const cdp = new CDP(chrome);
  await cdp.send('Browser.getVersion');                       // waits for the pipe
  const { id: extId } = await cdp.send('Extensions.loadUnpacked', { path: ROOT });
  console.log('loaded ' + extId);

  /* 1 + 2 — the menu on an article ------------------------------------------------- */
  console.log('hover shots:');
  const article = await cdp.open(`http://127.0.0.1:${PORT}/`);
  const rect = await cdp.eval(article.sessionId, `(() => {
    const a = [...document.querySelectorAll('main a')]
      .find(a => a.textContent.includes('spend that budget'));
    const r = a.getClientRects(); const last = r[r.length - 1];
    return { right: last.right, top: last.top, bottom: last.bottom };
  })()`);
  if (!rect) throw new Error('could not find the demo link on the article page');
  const y = (rect.top + rect.bottom) / 2;

  await cdp.move(article.sessionId, rect.right - 30, y);      // hover the link
  await sleep(1000);
  await cdp.shoot(article.sessionId, 'screenshot-2-grip.png');

  // The menu lives in a closed shadow root, so there is nothing to query for its
  // position — the grip's placement is re-derived here the way content.js derives it.
  await cdp.move(article.sessionId, rect.right + GRIP_GAP + GRIP_W / 2, y);
  await sleep(1000);
  await cdp.shoot(article.sessionId, 'screenshot-1-actions.png');

  /* 3 — the settings page ---------------------------------------------------------- */
  console.log('settings page + promo tile:');
  // The page's own demo runs on an 8s loop and the action bar is only open between 45%
  // and 88% of it. Landing anywhere else catches the grip mid-flight, sitting on top of
  // the sentence, which reads as a rendering bug rather than a feature.
  const options = await cdp.open(`chrome-extension://${extId}/ui/options.html`, { settle: 5600 });
  await cdp.shoot(options.sessionId, 'screenshot-3-settings.png');

  /* 4 — the promo tile ------------------------------------------------------------- */
  const tile = await cdp.open(`http://127.0.0.1:${PORT}/tools/shots/tile.html`,
    { scale: 4, width: 440, height: 280, settle: 800 });
  await cdp.shoot(tile.sessionId, 'promo-440x280.png', 440, 280);

  chrome.kill();
  server.close();
  await sleep(600);                                  // Chrome flushes the profile on
  try { fs.rmSync(profile, { recursive: true, force: true }); }   // its way out
  catch (_) { /* a leftover temp profile is harmless */ }
  process.exit(0);
})().catch(err => { console.error(err.message || err); process.exit(1); });
