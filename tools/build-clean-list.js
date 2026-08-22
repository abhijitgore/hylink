#!/usr/bin/env node
/**
 * Regenerates src/clean-list.js from Brave's published rules.
 *
 *   node tools/build-clean-list.js [path-or-url]
 *
 * The rules are copied verbatim so the generated file can be diffed against
 * upstream; all of the matching logic lives in src/clean.js instead.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SOURCE =
  'https://raw.githubusercontent.com/brave/adblock-lists/master/brave-lists/clean-urls.json';
const OUT = path.resolve(__dirname, '..', 'src', 'clean-list.js');

async function load(from) {
  if (from && !/^https?:/.test(from)) return JSON.parse(fs.readFileSync(from, 'utf8'));
  const res = await fetch(from || SOURCE);
  if (!res.ok) throw new Error(`${res.status} fetching ${from || SOURCE}`);
  return res.json();
}

function validate(rules) {
  if (!Array.isArray(rules) || !rules.length) throw new Error('expected a non-empty array');
  for (const rule of rules) {
    if (!Array.isArray(rule.include) || !Array.isArray(rule.params)) {
      throw new Error('rule is missing include/params: ' + JSON.stringify(rule).slice(0, 120));
    }
  }
  const params = new Set(rules.flatMap((r) => r.params));
  // A sanity floor: if upstream ever returns something small or unrecognisable, fail
  // loudly here rather than silently shipping a list that cleans nothing.
  if (!params.has('utm_source') || !params.has('gclid') || params.size < 200) {
    throw new Error(`list looks wrong: ${params.size} params`);
  }
  return params.size;
}

(async () => {
  const rules = await load(process.argv[2]);
  const count = validate(rules);
  const stamp = new Date().toISOString().slice(0, 10);
  const body = rules
    .map((r) => '  ' + JSON.stringify({ include: r.include, exclude: r.exclude || [], params: r.params }))
    .join(',\n');

  fs.writeFileSync(OUT, `/**
 * GENERATED FILE — do not edit by hand. Run \`node tools/build-clean-list.js\`.
 *
 * The URL-cleaning rules from Brave's adblock-lists, copied verbatim:
 * ${SOURCE}
 * Retrieved ${stamp}: ${rules.length} rules, ${count} distinct parameters.
 *
 * This file is licensed under the Mozilla Public License 2.0, as its contents are
 * a copy of Brave's list. The rest of HyLink is not covered by that licence.
 * A copy of the MPL is at https://mozilla.org/MPL/2.0/.
 */
(function (root) {
  'use strict';
  root.HyLinkCleanList = {
    source: ${JSON.stringify(SOURCE)},
    retrieved: ${JSON.stringify(stamp)},
    rules: [
${body}
    ]
  };
})(typeof self !== 'undefined' ? self : this);
`);
  console.log(`wrote ${path.relative(process.cwd(), OUT)} — ${rules.length} rules, ${count} params`);
})();
