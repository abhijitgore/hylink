'use strict';
/**
 * Serves the repo over http, so the sample pages and the options page are both http
 * rather than file:// — content scripts do not run on file:// without a per-extension
 * opt-in. Shared by tools/build-store-shots.js and tools/build-demo-wikipedia.js.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

function serveRepo(root, { port, defaultPage = 'tools/shots/wikipedia.html' } = {}) {
  return http.createServer((req, res) => {
    const rel = req.url === '/' ? defaultPage : req.url.replace(/^\//, '');
    const file = path.join(root, rel);
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end(); }
      const type = file.endsWith('.css') ? 'text/css'
        : file.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8';
      res.writeHead(200, { 'content-type': type });
      res.end(buf);
    });
  }).listen(port);
}

module.exports = { serveRepo };
