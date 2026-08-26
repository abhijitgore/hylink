#!/usr/bin/env node
/**
 * docs/icons/*.svg — the menu's own icons, as standalone files the README can show.
 *
 * The README used to approximate them with emoji (→, ⊞, 🕵), which is a table that
 * quietly stops matching the product. These come from `src/icons.js`, the same set the
 * menu and the onboarding demo draw from, so they cannot drift; a test in
 * `tests/run.js` fails the build if the checked-in files fall behind it.
 *
 *   node tools/build-readme-icons.js
 *
 * They are not shipped: `tools/package.sh` only ever zips manifest, LICENSE, icons,
 * src, ui and _locales, and `docs/` is not on that list.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'icons');

/**
 * A colour, not `currentColor`: GitHub serves README images through its own proxy and
 * renders them as standalone documents, so there is no page text colour to inherit.
 * This grey clears 4:1 against both the light (#ffffff) and dark (#0d1117) canvas.
 */
const INK = '#7d8590';

// icons.js is a plain script that hangs itself off `self` and builds a DOMParser at
// load time; the tests stub it the same way.
function loadIcons() {
  const sandbox = { self: {}, DOMParser: function () {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'icons.js'), 'utf8'), sandbox);
  return sandbox.self.HyLinkIcons.ICONS;
}

/**
 * The same two rules `ui/ui.css` applies to a menu button's icon — stroked by default,
 * `.fill` shapes filled and knocked back. Kept as CSS rather than baked onto each
 * shape so the markup below stays byte-identical to `ICONS[id]`, which is what the
 * drift test compares.
 */
function svg(markup) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
  <style>
    .icon :not(.fill) { fill: none; stroke: ${INK}; stroke-width: 1.4;
      stroke-linecap: round; stroke-linejoin: round; }
    .icon .fill { fill: ${INK}; stroke: none; opacity: .28; }
  </style>
  <g class="icon">${markup}</g>
</svg>
`;
}

const icons = loadIcons();
fs.mkdirSync(OUT, { recursive: true });
for (const [id, markup] of Object.entries(icons)) {
  fs.writeFileSync(path.join(OUT, id + '.svg'), svg(markup));
  console.log('docs/icons/' + id + '.svg');
}
