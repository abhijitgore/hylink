#!/usr/bin/env node
/**
 * HyLink test suite — no dependencies, run with `node tests/run.js`.
 *
 * The extension's modules are plain scripts that attach to `self`, so each suite
 * loads them into a vm context with a stubbed `chrome` and asserts on the calls
 * they make. Remember to hand the sandbox the real globals the code uses (URL,
 * timers) — a bare context makes `new URL()` throw and silently turns the URL
 * scheme guard into "rejects everything", which passes rejection tests for the
 * wrong reason.
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = (f) => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');

let failures = 0;
let suite = '';
const describe = (name) => { suite = name; console.log('\n' + name); };
const check = (name, cond, extra = '') => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '\n         ' + extra));
  if (!cond) failures++;
};
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want),
        `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

/* ------------------------------------------------------------------ sandbox */

/** settings.js with a real (in-memory) chrome.storage.sync behind it. */
function loadSettingsWith(initial) {
  const store = { ...initial };
  const sb = {
    self: {}, console, URL, setTimeout, clearTimeout,
    chrome: { storage: { sync: {
      get: async (defaults) => {
        const out = {};
        for (const [k, v] of Object.entries(defaults)) out[k] = (k in store) ? store[k] : v;
        return out;
      },
      set: async (obj) => { Object.assign(store, obj); },
      remove: async (key) => { delete store[key]; }
    } } }
  };
  vm.createContext(sb);
  vm.runInContext(src('settings.js'), sb);
  return { api: sb.self.HyLinkSettings, store };
}

function loadPlain(files) {
  // icons.js constructs a DOMParser at load; it is only used when an icon is built.
  const sb = { self: {}, console, URL, setTimeout, clearTimeout, DOMParser: function () {} };
  vm.createContext(sb);
  for (const f of files) vm.runInContext(src(f), sb);
  return sb.self;
}

/** Boots background.js with a stubbed Chrome and records every API call. */
function loadWorker(opts = {}) {
  const log = [];
  const sb = {
    console, URL, setTimeout, clearTimeout,
    importScripts: (...f) => f.forEach((x) => vm.runInContext(src(x), sb)),
    chrome: {
      // Defaults, overlaid with whatever this test stored — `opts.settings` is how a
      // suite boots the worker with a setting already switched on.
      storage: { sync: { get: async (d) => ({ ...d, ...(opts.settings || {}) }) } },
      runtime: {
        onMessage: { addListener: (fn) => { sb.__listener = fn; } },
        onInstalled: { addListener: (fn) => { sb.__onInstalled = fn; } },
        openOptionsPage: () => log.push(['openOptionsPage'])
      },
      extension: {
        isAllowedIncognitoAccess: async () => {
          if (opts.incognitoCheckThrows) throw new Error('unsupported');
          return opts.incognitoAllowed !== false;
        }
      },
      tabs: {
        ...(opts.splitViewSupported === false ? {} : { SPLIT_VIEW_ID_NONE: -1 }),
        create: async (o) => log.push(['tab.create', o]),
        get: async () => { if (opts.getThrows) throw new Error('tab is gone'); return opts.tab; },
        query: async (q) => { log.push(['tabs.query', q]); return opts.panes ?? []; },
        update: async (id, p) => log.push(['tab.update', id, p])
      },
      windows: {
        WINDOW_ID_CURRENT: -2,
        getAll: async () => opts.allWindows ?? [],
        create: async (o) => log.push(['window.create', o]),
        get: async () => opts.window ?? { id: 5, state: 'normal', left: 0, top: 0, width: 1600, height: 900 },
        update: async (id, b) => log.push(['window.update', b])
      },
      system: { display: { getInfo: async () =>
        opts.displays ?? [{ isPrimary: true, workArea: { left: 0, top: 0, width: 1600, height: 900 } }] } }
    }
  };
  sb.self = sb; sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(src('background.js'), sb);
  sb.__log = log;
  sb.send = (action, url, tab = { id: 11, windowId: 5, index: 2 }) =>
    new Promise((r) => sb.__listener({ type: 'hylink/action', action, url }, { tab }, r));
  sb.kinds = () => log.map((e) => e[0]);
  return sb;
}

/* ------------------------------------------------------------------- suites */

(async () => {
  const { normalize, isSiteDisabled, looksNavigational, NAV_SELECTOR, DEFAULTS, ACTIONS } =
    loadPlain(['settings.js']).HyLinkSettings;
  const ACTION_IDS = ACTIONS.map((a) => a.id);
  const { halves, openTiled } = loadPlain(['settings.js', 'tiling.js']).HyLinkTiling;

  describe('settings normalization');
  eq('empty storage yields defaults, plus the derived visible list',
     normalize({}), { ...DEFAULTS, visibleActions: ACTION_IDS });
  eq('a 0 ms delay is a real choice, not a missing value', normalize({ hoverDelay: 0 }).hoverDelay, 0);
  eq('a deleted key falls back to its default',
     normalize({ hoverDelay: undefined }).hoverDelay, DEFAULTS.hoverDelay);
  eq('non-numeric delay falls back', normalize({ hoverDelay: 'abc' }).hoverDelay, DEFAULTS.hoverDelay);
  eq('delay clamped to range', [normalize({ hoverDelay: -5 }).hoverDelay, normalize({ hoverDelay: 1e9 }).hoverDelay], [0, 3000]);
  eq('the retired visibleActions key is ignored as input',
     normalize({ visibleActions: ['open'] }).visibleActions, ACTION_IDS);
  eq('visible list is derived from hiddenActions',
     normalize({ hiddenActions: ['copy'] }).visibleActions, ACTION_IDS.filter((i) => i !== 'copy'));
  eq('unknown modifier falls back', normalize({ modifier: 'hyper' }).modifier, 'alt');
  eq('cleaning every action is opt-in', DEFAULTS.cleanBeforeAction, false);
  eq('the cleaning switch round-trips',
     normalize({ cleanBeforeAction: true }).cleanBeforeAction, true);

  describe('the menu order is the user\'s');
  {
    const reversed = [...ACTION_IDS].reverse();
    eq('a stored order is kept as-is', normalize({ actionOrder: reversed }).actionOrder, reversed);
    eq('and the visible list follows it, not the code order',
       normalize({ actionOrder: reversed }).visibleActions, reversed);
    eq('hidden actions drop out of the visible list but keep their place in the order',
       normalize({ actionOrder: reversed, hiddenActions: ['copy'] }).visibleActions,
       reversed.filter((id) => id !== 'copy'));
    eq('an id that no longer exists is dropped',
       normalize({ actionOrder: ['copy', 'telepathy', 'open'] }).actionOrder.slice(0, 2),
       ['copy', 'open']);
    eq('a duplicate is collapsed rather than shown twice',
       normalize({ actionOrder: ['copy', 'copy', 'open'] }).actionOrder.filter((id) => id === 'copy'),
       ['copy']);
    // The point of appending rather than dropping: an action added in a later version
    // has to turn up in the menu of someone who saved an order before it existed.
    eq('an action the stored order never heard of is appended',
       normalize({ actionOrder: ['copy'] }).actionOrder,
       ['copy', ...ACTION_IDS.filter((id) => id !== 'copy')]);
    eq('nonsense in the key falls back to the default order',
       normalize({ actionOrder: 'copy,open' }).actionOrder, ACTION_IDS);
    eq('every action is still accounted for',
       normalize({ actionOrder: ['copy'] }).actionOrder.length, ACTION_IDS.length);
  }

  describe('the flipped copy button');
  {
    const { actionLabel, actionById } = loadPlain(['settings.js']).HyLinkSettings;
    const copyClean = actionById('copyClean');
    // No `chrome` in the sandbox, so t() falls through to the English written inline —
    // which is exactly the fallback path a missing catalogue would take.
    eq('is the clean one while cleaning is off',
       actionLabel(copyClean, normalize({})), 'Copy clean link');
    eq('and the way back to the original while it is on',
       actionLabel(copyClean, normalize({ cleanBeforeAction: true })), 'Copy original link');
    eq('no other action changes label',
       ACTIONS.filter((a) => a.id !== 'copyClean')
         .filter((a) => actionLabel(a, normalize({ cleanBeforeAction: true })) !== actionLabel(a)),
       []);
    eq('and a caller with no settings gets the plain label',
       actionLabel(copyClean), 'Copy clean link');
    eq('actionById knows every action', ACTION_IDS.filter((id) => !actionById(id)), []);
    eq('and nothing else', actionById('telepathy'), undefined);
  }
  eq('hostnames trimmed and lowercased', normalize({ disabledSites: [' Mail.Google.COM ', ''] }).disabledSites, ['mail.google.com']);

  describe('navigational class/id tokens');
  for (const name of ['nav', 'site-nav', 'main_menu', 'navbar-brand', 'sidebar',
                      'c-header__inner', 'global-footer', 'breadcrumb-list',
                      'left-rail', 'nav site-nav', 'primary-navigation', 'tabs']) {
    eq('nav: ' + name, looksNavigational(name), true);
  }
  // Substring matching is what makes a denylist like this quietly unusable —
  // "table" is not "tabs", and "navigate-to-content" is body copy.
  for (const name of ['table-wrapper', 'navigate-to-content', 'menuish',
                      'article-body', 'post-content', 'headers-included',
                      'renavigation', 'entry-title', ''] ) {
    eq('not nav: ' + (name || '(empty)'), looksNavigational(name), false);
  }
  eq('non-string input is safe', looksNavigational(null), false);
  eq('semantic selector covers the landmark elements',
     ['nav', 'header', 'footer', 'aside', '[role="navigation"]'].every((sel) => NAV_SELECTOR.includes(sel)),
     true);
  eq('navigation is skipped by default', DEFAULTS.skipNavigation, true);
  eq('the toggle round-trips', normalize({ skipNavigation: false }).skipNavigation, false);

  describe('web store constraints');
  {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    eq('manifest v3', manifest.manifest_version, 3);
    // The store truncates past this, so it is a hard limit, not a style note.
    check('description within 132 characters', manifest.description.length <= 132,
          `${manifest.description.length} characters`);
    check('name within 45 characters', manifest.name.length <= 45, `${manifest.name.length}`);
    check('short_name within 12 characters', manifest.short_name.length <= 12,
          `${manifest.short_name.length}`);
    eq('icons at every size Chrome asks for',
       Object.keys(manifest.icons).sort(), ['128', '16', '32', '48']);
    // Every permission here is a line on the install consent screen, so the set is
    // pinned. `tabs` would add a browsing-history warning; `clipboardWrite` would add
    // "Modify data you copy and paste" and is not needed — the copy happens in the
    // content script inside the click's own user activation, which is already allowed.
    eq('permissions stay minimal — no `tabs`, no `clipboardWrite`',
       manifest.permissions.sort(),
       ['activeTab', 'storage', 'system.display']);
    check('no host_permissions beyond the content script',
          manifest.host_permissions === undefined);
    // Remote code is a rejection, and unload handlers cost pages the back/forward cache.
    const code = ['background.js', 'content.js', 'settings.js', 'tiling.js'].map(src).join('\n') +
      fs.readFileSync(path.join(ROOT, 'ui', 'options.js'), 'utf8') +
      fs.readFileSync(path.join(ROOT, 'ui', 'popup.js'), 'utf8');
    check('no eval or Function constructor', !/\beval\(|new Function\(/.test(code));
    check('no remotely loaded script', !/https?:\/\/[^\s'"]+\.js/.test(code));
    // The README and PRIVACY.md both promise HyLink sends nothing anywhere. That is a
    // promise about code, so it is checked like one — a single fetch() added later
    // would make the privacy policy false without anything else noticing.
    const NETWORK = /\bfetch\(|XMLHttpRequest|\bWebSocket\b|sendBeacon|EventSource|navigator\.sendBeacon/;
    check('sends nothing anywhere — no network API in shipped code',
          !NETWORK.test(code), (code.match(NETWORK) || [])[0]);
    check('no unload handlers', !/\b(on)?(before)?unload\b/.test(code));
    for (const page of ['ui/options.html', 'ui/popup.html']) {
      const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
      check(`${page} has no inline script`, !/<script(?![^>]*\ssrc=)[^>]*>/.test(html));
    }
  }

  describe('published contact address');
  {
    /**
     * The repo is public, so every Markdown file in it is scrapeable — the raw view
     * at raw.githubusercontent.com included. GitHub's renderer defeats every clever
     * way of hiding an address: it strips <script> and style attributes, and it
     * decodes HTML entities and then turns the result back into a live mailto link.
     * Writing the address out in words is the only thing that survives, so the only
     * way to keep it that way is to assert nothing has put a bare one back.
     */
    const BARE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
    // A GitHub noreply alias is public by design and cannot receive mail, so it is
    // not an address a harvester gains anything from.
    const HARMLESS = /@users\.noreply\.github\.com$/;

    const markdown = [];
    (function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.md')) markdown.push(full);
      }
    })(ROOT);

    check('found the Markdown to scan', markdown.length > 0, `${markdown.length} files`);
    for (const file of markdown) {
      const found = (fs.readFileSync(file, 'utf8').match(BARE_EMAIL) || [])
        .filter((address) => !HARMLESS.test(address));
      check(`no harvestable address in ${path.relative(ROOT, file)}`,
            found.length === 0, found.join(', '));
    }

    // The point is to make the address hard to scrape, not to lose it.
    const privacy = fs.readFileSync(path.join(ROOT, 'PRIVACY.md'), 'utf8');
    check('PRIVACY.md still names a contact',
          /\[at\]/.test(privacy) && /\[dot\]/.test(privacy));
  }

  describe('shared icon set');
  {
    const { ICONS } = loadPlain(['icons.js']).HyLinkIcons;
    // The options page draws its demo from this same set, so a missing icon would show
    // up as a hole in the onboarding as well as in the menu.
    eq('every action has an icon', ACTION_IDS.filter((id) => !ICONS[id]), []);
    eq('and no icon is left over', Object.keys(ICONS).filter((id) => !ACTION_IDS.includes(id)), []);
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    eq('the content script loads it before content.js',
       manifest.content_scripts[0].js, ['src/settings.js', 'src/icons.js', 'src/content.js']);
    check('so does the options page',
          fs.readFileSync(path.join(ROOT, 'ui', 'options.html'), 'utf8').includes('src/icons.js'));

    // The README's icon column used to be emoji standing in for the real thing, which
    // is a table that goes quietly wrong. These are generated from ICONS above, so the
    // check is that the checked-in files still carry that exact markup.
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    const stale = ACTION_IDS.filter((id) => {
      const file = path.join(ROOT, 'docs', 'icons', id + '.svg');
      return !fs.existsSync(file) || !fs.readFileSync(file, 'utf8').includes(ICONS[id]);
    });
    eq('docs/icons is in step with the icon set (node tools/build-readme-icons.js)', stale, []);
    eq('and the README shows every one of them',
       ACTION_IDS.filter((id) => !readme.includes(`docs/icons/${id}.svg`)), []);
  }

  describe('clean link');
  {
    const { cleanUrl, CLICK_IDS } = loadPlain(['clean-list.js', 'clean.js']).HyLinkClean;
    const clean = (u) => cleanUrl(u).url;
    const removed = (u) => cleanUrl(u).removed;

    eq('strips the utm family',
       clean('https://example.com/a?utm_source=x&utm_medium=y&id=7'),
       'https://example.com/a?id=7');
    eq('strips click identifiers anywhere',
       clean('https://example.com/?fbclid=abc&gclid=def&q=cats'),
       'https://example.com/?q=cats');
    eq('drops the ? when nothing survives',
       clean('https://example.com/page?utm_source=x'), 'https://example.com/page');
    eq('keeps the fragment',
       clean('https://example.com/p?fbclid=1&x=2#section'), 'https://example.com/p?x=2#section');
    eq('reports what came off', removed('https://example.com/?utm_source=x&fbclid=y&keep=1'),
       ['utm_source', 'fbclid']);

    // Site-scoped rules from Brave's list.
    eq('site rule: youtube si', clean('https://www.youtube.com/watch?v=abc&si=xyz'),
       'https://www.youtube.com/watch?v=abc');
    // Brave's amazon rule takes ref_, tag, qid and th among others; psc is not on it.
    eq('site rule: amazon', clean('https://www.amazon.com/dp/B01?ref_=hp&th=1&psc=1'),
       'https://www.amazon.com/dp/B01?psc=1');
    eq('site rule applies to subdomains too',
       clean('https://open.spotify.com/track/1?si=abc'), 'https://open.spotify.com/track/1');
    eq('a site rule does not leak to other sites',
       clean('https://example.com/track/1?si=abc'), 'https://example.com/track/1?si=abc');
    // youtube's rule is scoped to /watch; the same param elsewhere on the site stays.
    eq('site rules respect their path scope',
       clean('https://www.youtube.com/feed/subscriptions?si=abc'),
       'https://www.youtube.com/feed/subscriptions?si=abc');

    // Leave alone.
    eq('an already-clean URL is returned byte-for-byte',
       clean('https://example.com/a?b=%20+c&d=e'), 'https://example.com/a?b=%20+c&d=e');
    eq('no query, no change', clean('https://example.com/a'), 'https://example.com/a');
    eq('non-web schemes are untouched',
       clean('ftp://example.com/f?utm_source=x'), 'ftp://example.com/f?utm_source=x');
    eq('unparseable input is handed back', clean('not a url'), 'not a url');
    eq('a value that looks like a tracker name is kept',
       clean('https://example.com/?q=utm_source'), 'https://example.com/?q=utm_source');
    eq('matching is case-sensitive, like the list',
       clean('https://example.com/?UTM_SOURCE=x'), 'https://example.com/?UTM_SOURCE=x');
    eq('repeated trackers all go',
       clean('https://example.com/?utm_source=a&utm_source=b&k=1'), 'https://example.com/?k=1');
    eq('a bare tracker key with no value still goes',
       clean('https://example.com/?fbclid&k=1'), 'https://example.com/?k=1');

    check('the click-id list carries the well-known ones',
          ['fbclid', 'gclid', 'msclkid', 'igshid'].every((id) => CLICK_IDS.includes(id)));
  }

  describe('clean list data');
  {
    const list = loadPlain(['clean-list.js']).HyLinkCleanList;
    check('rules were generated from Brave\'s list', /adblock-lists/.test(list.source));
    check('there are rules to apply', list.rules.length > 10, String(list.rules.length));
    const params = new Set(list.rules.flatMap((r) => r.params));
    check('including the parameters everyone knows',
          ['utm_source', 'utm_campaign', 'gclid'].every((p) => params.has(p)));
    check('every rule has an include pattern',
          list.rules.every((r) => Array.isArray(r.include) && r.include.length));
  }

  describe('locales');
  {
    const dir = path.join(ROOT, '_locales');
    const locales = fs.readdirSync(dir).sort();
    const en = JSON.parse(fs.readFileSync(path.join(dir, 'en', 'messages.json'), 'utf8'));
    const enKeys = Object.keys(en).sort();

    eq('the locales that ship', locales,
       ['de', 'en', 'es', 'fr', 'hi', 'id', 'ja', 'pt_BR', 'ru', 'tr']);
    eq('manifest declares the fallback',
       JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).default_locale, 'en');

    for (const locale of locales) {
      const messages = JSON.parse(fs.readFileSync(path.join(dir, locale, 'messages.json'), 'utf8'));
      eq(`${locale}: same keys as en`, Object.keys(messages).sort(), enKeys);
      // A placeholder that goes missing in translation renders as a literal $count$.
      const bad = enKeys.filter((key) => {
        const wanted = Object.keys(en[key].placeholders || {});
        const got = Object.keys(messages[key].placeholders || {});
        if (JSON.stringify(wanted) !== JSON.stringify(got)) return true;
        return wanted.some((name) => !messages[key].message.includes('$' + name + '$'));
      });
      eq(`${locale}: placeholders intact`, bad, []);
      check(`${locale}: nothing empty`,
            Object.values(messages).every((m) => m.message && m.message.trim()));
    }

    // The pages keep their English inline as a fallback; if someone edits one and not
    // the other they drift apart silently, so tie them together here.
    const strip = (text) => text.replace(/\s+/g, ' ').trim();
    for (const page of ['ui/options.html', 'ui/popup.html']) {
      const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
      const used = [...html.matchAll(/data-i18n(?:-title|-placeholder)?="([^"]+)"/g)].map((m) => m[1]);
      eq(`${page}: every key exists`, used.filter((key) => !(key in en)), []);
      const mismatched = [...html.matchAll(/data-i18n="([^"]+)"[^>]*>([^<]*)</g)]
        .filter(([, key, text]) => strip(text) !== strip(en[key].message))
        .map(([, key]) => key);
      eq(`${page}: inline English matches the catalogue`, mismatched, []);
    }
  }

  describe('first run');
  {
    let sb = loadWorker();
    sb.__onInstalled({ reason: 'install' });
    eq('a fresh install opens the options page once', sb.kinds(), ['openOptionsPage']);

    sb = loadWorker();
    sb.__onInstalled({ reason: 'update' });
    eq('an update stays silent', sb.kinds(), []);
  }

  describe('site denylist');
  eq('exact host', isSiteDisabled(['example.com'], 'example.com'), true);
  eq('subdomain', isSiteDisabled(['example.com'], 'docs.example.com'), true);
  eq('no bare-suffix false positive', isSiteDisabled(['example.com'], 'notexample.com'), false);
  eq('unrelated host', isSiteDisabled(['example.com'], 'example.org'), false);
  eq('empty hostname', isSiteDisabled(['example.com'], ''), false);

  describe('window tiling geometry');
  eq('even split', halves({ left: 0, top: 0, width: 1600, height: 900 }, 'sideRight'),
     [{ left: 0, top: 0, width: 800, height: 900 }, { left: 800, top: 0, width: 800, height: 900 }]);
  eq('odd width loses no pixel', halves({ left: 100, top: 25, width: 1601, height: 900 }, 'sideRight'),
     [{ left: 100, top: 25, width: 800, height: 900 }, { left: 900, top: 25, width: 801, height: 900 }]);
  eq('odd height loses no pixel', halves({ left: 0, top: 25, width: 1600, height: 901 }, 'sideStacked'),
     [{ left: 0, top: 25, width: 1600, height: 450 }, { left: 0, top: 475, width: 1600, height: 451 }]);

  describe('tiling against a maximized window on a second display');
  {
    const sb = loadWorker({
      tab: { id: 11, windowId: 5, splitViewId: -1 },
      window: { id: 7, state: 'maximized', left: 2000, top: 100, width: 1000, height: 700 },
      displays: [{ isPrimary: true,  workArea: { left: 0,    top: 25, width: 1440, height: 875 } },
                 { isPrimary: false, workArea: { left: 1440, top: 0,  width: 1920, height: 1040 } }]
    });
    await sb.send('sideRight', 'https://example.com');
    eq('restores to normal first, with no bounds in that call', sb.__log[0], ['window.update', { state: 'normal' }]);
    eq('uses the work area of the display holding the window', sb.__log[1][1], { left: 1440, top: 0, width: 960, height: 1040 });
    eq('new window takes the right half', sb.__log[2][1].left, 2400);
  }

  describe('URL scheme guard');
  {
    const sb = loadWorker({ tab: { id: 11, windowId: 5, splitViewId: -1 } });
    for (const bad of ['javascript:alert(1)', 'data:text/html,<h1>x', 'chrome://settings', 'vbscript:x', 'blob:https://x/y']) {
      const r = await sb.send('newTab', bad);
      check('rejects ' + bad.slice(0, 24), r.ok === false && /Refusing/.test(r.error), JSON.stringify(r));
    }
    check('rejects a malformed URL', (await sb.send('newTab', 'not a url')).ok === false);
    check('rejects an unknown action', (await sb.send('teleport', 'https://example.com')).ok === false);
    // Acceptance cases matter: a guard that rejects everything would pass the above.
    check('allows https:', (await sb.send('newWindow', 'https://example.com')).ok === true);
    check('allows http:', (await sb.send('newWindow', 'http://example.com')).ok === true);
    check('allows file:', (await sb.send('newWindow', 'file:///Users/x/a.html')).ok === true);
  }

  describe('new tab placement');
  {
    const sb = loadWorker({ tab: { id: 11, windowId: 5, splitViewId: -1 } });
    const r = await sb.send('newTab', 'https://example.com/a');
    const [, opts] = sb.__log.find((e) => e[0] === 'tab.create');
    check('opens directly after the current tab, in the same window and focused',
          r.ok === true && opts.index === 3 && opts.windowId === 5 && opts.active === true,
          JSON.stringify(opts));
  }

  describe('cleaning before every action');
  {
    const DIRTY = 'https://example.com/a?utm_source=news&id=7&fbclid=xyz';
    const CLEAN = 'https://example.com/a?id=7';
    const tab = { id: 11, windowId: 5, splitViewId: -1 };

    // Both halves on purpose: a worker that mangled every URL would pass the "cleaned"
    // assertion on its own, exactly the way the scheme guard once passed for rejecting
    // everything (tasks/lessons.md).
    let sb = loadWorker({ tab, settings: { cleanBeforeAction: true } });
    await sb.send('newTab', DIRTY);
    eq('a new tab gets the stripped URL', sb.__log.find((e) => e[0] === 'tab.create')[1].url, CLEAN);
    await sb.send('newWindow', DIRTY);
    eq('so does a new window', sb.__log.find((e) => e[0] === 'window.create')[1].url, CLEAN);

    sb = loadWorker({ tab, settings: { cleanBeforeAction: false } });
    await sb.send('newTab', DIRTY);
    eq('switched off, the URL is passed through untouched',
       sb.__log.find((e) => e[0] === 'tab.create')[1].url, DIRTY);
    await sb.send('newWindow', DIRTY);
    eq('for every action, not just the tab one',
       sb.__log.find((e) => e[0] === 'window.create')[1].url, DIRTY);

    // Cleaning happens after the scheme guard, not instead of it.
    sb = loadWorker({ tab, settings: { cleanBeforeAction: true } });
    const bad = await sb.send('newTab', 'javascript:alert(1)');
    check('the scheme guard still runs first', bad.ok === false, JSON.stringify(bad));
    sb = loadWorker({ tab, settings: { cleanBeforeAction: true } });
    await sb.send('newTab', 'https://example.com/a');
    eq('a URL with nothing to remove is not re-encoded',
       sb.__log.find((e) => e[0] === 'tab.create')[1].url, 'https://example.com/a');
  }

  describe('split view: reuse an existing one, otherwise tile');
  // 1. Tab is in a split view -> navigate the sibling pane, no new window.
  let sb = loadWorker({ tab: { id: 11, windowId: 5, splitViewId: 77 },
                         panes: [{ id: 11 }, { id: 12 }] });
  let r = await sb.send('sideRight', 'https://example.com');
  check('in split view -> updates sibling pane, creates no window',
    r.ok === true && !sb.kinds().includes('window.create') &&
    // assertSafe normalises through new URL().href, hence the trailing slash.
    sb.__log.some(e => e[0] === 'tab.update' && e[1] === 12 && e[2].url === 'https://example.com/'),
    JSON.stringify(sb.__log));
  check('queries by windowId + splitViewId',
    sb.__log.some(e => e[0] === 'tabs.query' && e[1].splitViewId === 77 && e[1].windowId === 5),
    JSON.stringify(sb.__log));

  // 2. Not in a split view -> tile.
  sb = loadWorker({ tab: { id: 11, windowId: 5, splitViewId: -1 } });
  r = await sb.send('sideRight', 'https://example.com');
  check('not in split view -> tiles windows',
    r.ok === true && sb.kinds().includes('window.create') && !sb.kinds().includes('tab.update'),
    JSON.stringify(sb.kinds()));

  // 3. Split view reports only one pane -> tile rather than doing nothing.
  sb = loadWorker({ tab: { id: 11, windowId: 5, splitViewId: 77 }, panes: [{ id: 11 }] });
  r = await sb.send('sideRight', 'https://example.com');
  check('split view with no sibling -> falls back to tiling',
    r.ok === true && sb.kinds().includes('window.create') && !sb.kinds().includes('tab.update'),
    JSON.stringify(sb.kinds()));

  // 4. Pre-Chrome-140 (no SPLIT_VIEW_ID_NONE constant) -> tile.
  sb = loadWorker({ splitViewSupported: false, tab: { id: 11, windowId: 5 } });
  r = await sb.send('sideRight', 'https://example.com');
  check('no split-view API -> tiles windows',
    r.ok === true && sb.kinds().includes('window.create'), JSON.stringify(sb.kinds()));

  // 5. tabs.get throwing must not break the action.
  sb = loadWorker({ getThrows: true, tab: null });
  r = await sb.send('sideRight', 'https://example.com');
  check('tabs.get failure -> still tiles, still reports ok',
    r.ok === true && sb.kinds().includes('window.create'), JSON.stringify(r));

  // 6. Stacked reuses a split view too — Chrome has a stacked layout, and the API
  //    exposes no orientation, so both side actions fill the sibling pane.
  sb = loadWorker({ tab: { id: 11, windowId: 5, splitViewId: 77 },
                     panes: [{ id: 11 }, { id: 12 }] });
  r = await sb.send('sideStacked', 'https://example.com');
  check('stacked also reuses an existing split view',
    r.ok === true && !sb.kinds().includes('window.create') &&
    sb.__log.some(e => e[0] === 'tab.update' && e[1] === 12),
    JSON.stringify(sb.__log));

  // 6b. ...but still tiles top/bottom when there is no split view.
  sb = loadWorker({ tab: { id: 11, windowId: 5, splitViewId: -1 } });
  r = await sb.send('sideStacked', 'https://example.com');
  check('stacked with no split view tiles top/bottom',
    r.ok === true && sb.__log[0][1].height === 450 && sb.__log[1][1].top === 450,
    JSON.stringify(sb.__log));

  // 7. Scheme guard still runs before any split-view work.
  sb = loadWorker({ tab: { id: 11, windowId: 5, splitViewId: 77 },
                     panes: [{ id: 11 }, { id: 12 }] });
  r = await sb.send('sideRight', 'javascript:alert(1)');
  check('rejects javascript: before touching the sibling pane',
    r.ok === false && sb.__log.length === 0, JSON.stringify([r, sb.__log]));

  describe('settings migration: opt-in visibleActions -> opt-out hiddenActions');
  {
    const ALL = ['open','newTab','newWindow','sideRight','sideStacked','copy'];
    // Someone who never customised must still get actions added in later versions.
    let { api, store } = loadSettingsWith({ visibleActions: ALL });
    let s1 = await api.getSettings();
    eq('untouched legacy menu hides nothing', s1.hiddenActions, []);
    check('a newly added action becomes visible', s1.visibleActions.includes('incognito'),
          JSON.stringify(s1.visibleActions));
    check('legacy key is deleted, so migration cannot repeat', !('visibleActions' in store),
          JSON.stringify(Object.keys(store)));

    // A customised menu keeps its choices, and still gains the new action.
    ({ api, store } = loadSettingsWith({ visibleActions: ALL.filter((a) => a !== 'copy') }));
    s1 = await api.getSettings();
    eq('deselected action stays hidden', s1.hiddenActions, ['copy']);
    check('new action still appears alongside it', s1.visibleActions.includes('incognito'));
    check('copy is not in the visible list', !s1.visibleActions.includes('copy'));

    // Idempotence: a second read must not re-derive anything.
    ({ api, store } = loadSettingsWith({ visibleActions: ['open'] }));
    await api.getSettings();
    const second = await api.getSettings();
    eq('second read is stable', second.hiddenActions, ['newTab','newWindow','sideRight','sideStacked','copy']);

    ({ api } = loadSettingsWith({ hiddenActions: ['copy'] }));
    eq('already-migrated settings pass through', (await api.getSettings()).hiddenActions, ['copy']);

    const { api: allHidden } = loadSettingsWith({ hiddenActions: api ? undefined : undefined });
    const everything = allHidden.ACTIONS.map((a) => a.id);
    eq('hiding every action is treated as hiding none',
       allHidden.normalize({ hiddenActions: everything }).hiddenActions, []);
    eq('unknown ids in hiddenActions are dropped',
       allHidden.normalize({ hiddenActions: ['copy', 'bogus'] }).hiddenActions, ['copy']);
    eq('expandMode falls back when unrecognised',
       allHidden.normalize({ expandMode: 'sideways' }).expandMode, 'handle');
  }

  describe('open in incognito');
  {
    // An incognito window is already open: put the link in it rather than making another.
    let sb = loadWorker({ tab: { id: 11, windowId: 5 },
      allWindows: [{ id: 5, incognito: false, focused: true }, { id: 9, incognito: true }] });
    let r = await sb.send('incognito', 'https://example.com');
    check('reuses an open incognito window',
      r.ok === true && !sb.kinds().includes('window.create') &&
      sb.__log.some(e => e[0] === 'tab.create' && e[1].windowId === 9) &&
      sb.__log.some(e => e[0] === 'window.update' && e[1].focused === true),
      JSON.stringify(sb.__log));

    sb = loadWorker({ tab: { id: 11, windowId: 5 },
      allWindows: [{ id: 5, incognito: true, focused: true }, { id: 9, incognito: true }] });
    await sb.send('incognito', 'https://example.com');
    check('prefers the focused incognito window',
      sb.__log.some(e => e[0] === 'tab.create' && e[1].windowId === 5), JSON.stringify(sb.__log));

    // None open: create one.
    sb = loadWorker({ tab: { id: 11, windowId: 5 }, allWindows: [{ id: 5, incognito: false }] });
    r = await sb.send('incognito', 'https://example.com');
    check('creates an incognito window when none is open',
      r.ok === true && sb.__log.some(e => e[0] === 'window.create' && e[1].incognito === true),
      JSON.stringify(sb.__log));

    // Not allowed in incognito: say so, and don't attempt anything.
    sb = loadWorker({ incognitoAllowed: false, tab: { id: 11, windowId: 5 } });
    r = await sb.send('incognito', 'https://example.com');
    check('explains how to fix it when not allowed in incognito',
      r.ok === false && /chrome:\/\/extensions/.test(r.error) && sb.__log.length === 0,
      JSON.stringify([r, sb.__log]));

    // Check unavailable: fall through and let create() decide rather than refusing.
    sb = loadWorker({ incognitoCheckThrows: true, tab: { id: 11, windowId: 5 }, allWindows: [] });
    r = await sb.send('incognito', 'https://example.com');
    check('falls through when the permission check is unavailable',
      r.ok === true && sb.__log.some(e => e[0] === 'window.create'), JSON.stringify([r, sb.__log]));

    sb = loadWorker({ tab: { id: 11, windowId: 5 } });
    check('scheme guard still applies to incognito',
      (await sb.send('incognito', 'javascript:alert(1)')).ok === false);
  }

  console.log(failures ? `\n${failures} FAILING\n` : '\nAll assertions passed.\n');
  process.exitCode = failures ? 1 : 0;
})();
