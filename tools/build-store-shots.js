'use strict';
/**
 * Chrome Web Store images.
 *
 *   node tools/build-store-shots.js      -> docs/store/*.png
 *
 * Two of the four images can be built from nothing but this repo: the options page is
 * an ordinary HTML page, and the promo tile is a static mock-up. Those always run.
 *
 * The other two have to show the menu on a real page, which means a Chrome with HyLink
 * genuinely installed. Chrome 137 deprecated --load-extension and by 151 it is ignored
 * outright — headless and headed alike, and --enable-unsafe-extension-debugging does
 * not bring it back — so a throwaway Chrome cannot be told to load the extension any
 * more. Instead this attaches to a Chrome that already has it, if one is listening:
 *
 *   1. Quit Chrome.
 *   2. Relaunch it with a debugging port, using your normal profile:
 *
 *      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *        --remote-debugging-port=9333 &
 *
 *   3. Run this script again. It opens its own tab, takes the two shots, closes it,
 *      and leaves the rest of your browser alone.
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
const LIVE_PORT = Number(process.env.HYLINK_CDP || 9333);   // a Chrome that has HyLink
const OWN_PORT = 9334;                                       // the throwaway one
const W = 1280, H = 800;

const GRIP_GAP = 3, GRIP_W = 22;        // must match src/content.js
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------------------------------------------------------- tiny CDP client */
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    };
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws failed')); });
    return new CDP(ws);
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async open(url, scale = 2, width = W, height = H) {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    await this.send('Page.enable', {}, sessionId);
    await this.send('Runtime.enable', {}, sessionId);
    await this.send('Emulation.setDeviceMetricsOverride',
      { width, height, deviceScaleFactor: scale, mobile: false }, sessionId);
    await this.send('Page.navigate', { url }, sessionId);
    await sleep(2000);
    return { targetId, sessionId };
  }
  close(t) { return this.send('Target.closeTarget', { targetId: t.targetId }); }
  eval(sessionId, expression) {
    return this.send('Runtime.evaluate', { expression, returnByValue: true }, sessionId)
      .then(r => r.result.value);
  }
  async shoot(sessionId, name, w = W, h = H) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    const file = path.join(OUT, name);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    execFileSync('sips', ['-z', String(h), String(w), file], { stdio: 'ignore' });
    console.log('  ' + path.relative(ROOT, file));
  }
}

const endpoint = async port => {
  try { return (await fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.json())).webSocketDebuggerUrl; }
  catch (_) { return null; }
};

/* --------------------------------------------------------------------------- main */
(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  // Serves the repo, so the options page and the sample article are both same-origin
  // http rather than file:// — content scripts do not run on file:// by default.
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

  /* ---- the two that need no extension: options page and promo tile --------------- */
  const profile = fs.mkdtempSync('/tmp/hylink-shots-');
  const chrome = spawn(CHROME, [
    '--headless', '--disable-gpu', '--hide-scrollbars', '--disable-threaded-animation',
    // 1 is light, 0 is dark. The listing reads better light, and getting this wrong is
    // silent — any other value renders light without complaint.
    '--blink-settings=preferredColorScheme=1',
    '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + profile,
    '--remote-debugging-port=' + OWN_PORT,
    'about:blank',
  ], { stdio: 'ignore' });

  let own = null;
  for (let i = 0; i < 60 && !own; i++) { own = await endpoint(OWN_PORT); if (!own) await sleep(250); }
  if (!own) throw new Error('Chrome never opened its debugging port');
  const cdp = await CDP.connect(own);

  console.log('settings page + promo tile:');
  const options = await cdp.open(`http://127.0.0.1:${PORT}/ui/options.html`);
  // The page's own demo runs on an 8s loop and the action bar is only open between
  // 45% and 88% of it. Landing anywhere else catches the grip mid-flight, sitting on
  // top of the sentence, which reads as a rendering bug rather than a feature.
  await sleep(3600);
  await cdp.shoot(options.sessionId, 'screenshot-3-settings.png');
  await cdp.close(options);

  const tile = await cdp.open(`http://127.0.0.1:${PORT}/tools/shots/tile.html`, 4, 440, 280);
  await cdp.shoot(tile.sessionId, 'promo-440x280.png', 440, 280);
  await cdp.close(tile);

  chrome.kill();
  await sleep(600);   // Chrome flushes the profile on the way out; deleting it under
  try { fs.rmSync(profile, { recursive: true, force: true }); }   // that races and throws
  catch (_) { /* a leftover temp profile is harmless */ }

  /* ---- the two that need the real extension -------------------------------------- */
  const live = await endpoint(LIVE_PORT);
  if (!live) {
    console.log(`\nno Chrome listening on ${LIVE_PORT}, so the two on-page shots were skipped.`);
    console.log('Quit Chrome, relaunch it with --remote-debugging-port=' + LIVE_PORT
      + ', and run this again — see the comment at the top of this file.');
    server.close();
    return process.exit(0);
  }

  console.log('\nhover shots, on the Chrome already running HyLink:');
  const liveCdp = await CDP.connect(live);
  const article = await liveCdp.open(`http://127.0.0.1:${PORT}/`);

  const rect = await liveCdp.eval(article.sessionId, `(() => {
    const a = [...document.querySelectorAll('main a')]
      .find(a => a.textContent.includes('spend that budget'));
    const r = a.getClientRects(); const last = r[r.length - 1];
    return { right: last.right, top: last.top, bottom: last.bottom };
  })()`);
  if (!rect) throw new Error('could not find the demo link on the article page');
  const y = (rect.top + rect.bottom) / 2;

  const move = (x, yy) =>
    liveCdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: yy, buttons: 0 }, article.sessionId);

  await move(rect.right - 30, y);                       // rest on the link
  await sleep(1000);
  await liveCdp.shoot(article.sessionId, 'screenshot-2-grip.png');

  await move(rect.right + GRIP_GAP + GRIP_W / 2, y);    // move onto the grip
  await sleep(1000);
  await liveCdp.shoot(article.sessionId, 'screenshot-1-actions.png');

  await liveCdp.close(article);
  server.close();
  process.exit(0);
})().catch(err => { console.error(err.message || err); process.exit(1); });
