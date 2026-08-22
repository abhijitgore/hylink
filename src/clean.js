/**
 * URL cleaning, modelled on Brave's "Copy clean link".
 *
 * Brave does this in two passes and so do we: a short list of click identifiers that
 * are tracking wherever they appear, plus the site-scoped rules in clean-list.js.
 * Runs in the service worker only — the rule list is 18 kB and has no business being
 * injected into every frame of every page.
 */
(function (root) {
  'use strict';

  const { rules } = root.HyLinkCleanList;

  /**
   * Click identifiers, from Brave's query filter — the one that runs on navigation.
   * They are absent from clean-urls.json because Brave applies both passes to a
   * copied link. https://brave.com/privacy-updates/5-grab-bag/
   */
  const CLICK_IDS = [
    'fbclid', 'gclid', 'msclkid', 'mc_eid', 'dclid', 'twclid', 'yclid',
    'oly_anon_id', 'oly_enc_id', '_openstat', 'vero_conv', 'vero_id', 'wickedid',
    '__s', 'rb_clickid', 's_cid', 'ml_subscriber', 'ml_subscriber_hash',
    'oft_id', 'oft_k', 'oft_lk', 'oft_d', 'oft_c', 'oft_ck', 'oft_ids', 'oft_sk',
    'ss_email_id', 'bsft_uid', 'bsft_clkid', 'vgo_ee', 'igshid'
  ];

  const CLICK_ID_SET = new Set(CLICK_IDS);
  let compiled = null;

  /**
   * A Chrome-style match pattern — `*://*.example.com/path*` — as a pair of tests.
   * The host half understands the leading `*.` (which also matches the bare domain,
   * as Chrome's do); the path half is a plain glob matched against path + query.
   */
  function compilePattern(pattern) {
    const match = /^(\*|https?):\/\/([^/]*)(\/.*)$/.exec(pattern);
    if (!match) return null;
    const [, scheme, hostPattern, pathPattern] = match;

    const schemes = scheme === '*' ? ['http:', 'https:'] : [scheme + ':'];
    const bare = hostPattern.startsWith('*.') ? hostPattern.slice(2) : null;
    const path = new RegExp(
      '^' + pathPattern.split('*').map(escapeRegExp).join('.*') + '$'
    );

    return (url) => {
      if (!schemes.includes(url.protocol)) return false;
      const host = url.hostname;
      if (hostPattern !== '*') {
        if (bare) {
          if (host !== bare && !host.endsWith('.' + bare)) return false;
        } else if (host !== hostPattern) {
          return false;
        }
      }
      return path.test(url.pathname + url.search);
    };
  }

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function compile() {
    if (compiled) return compiled;
    compiled = rules.map((rule) => ({
      include: rule.include.map(compilePattern).filter(Boolean),
      exclude: (rule.exclude || []).map(compilePattern).filter(Boolean),
      params: new Set(rule.params)
    }));
    return compiled;
  }

  /** Every parameter name that should come off this particular URL. */
  function paramsFor(url) {
    const doomed = new Set(CLICK_ID_SET);
    for (const rule of compile()) {
      if (!rule.include.some((test) => test(url))) continue;
      if (rule.exclude.some((test) => test(url))) continue;
      for (const param of rule.params) doomed.add(param);
    }
    return doomed;
  }

  /**
   * Returns `{ url, removed }`. `removed` lists the parameter names taken off, in the
   * order they appeared. The URL is only rewritten if something was actually removed,
   * so a clean link is handed back byte-for-byte rather than re-encoded by the URL
   * parser — copying a link should not quietly change it.
   */
  function cleanUrl(raw) {
    let url;
    try {
      url = new URL(raw);
    } catch (_) {
      return { url: raw, removed: [] };
    }
    // Brave leaves anything that isn't a web page alone, and so do we.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return { url: raw, removed: [] };
    if (!url.search) return { url: raw, removed: [] };

    const doomed = paramsFor(url);
    const kept = [];
    const removed = [];
    for (const pair of url.search.slice(1).split('&')) {
      if (!pair) continue;
      // Compare the raw name: the list carries both `__cft__[0]` and its encoded form.
      const name = pair.split('=')[0];
      if (doomed.has(name)) removed.push(name);
      else kept.push(pair);
    }
    if (!removed.length) return { url: raw, removed: [] };

    const href = url.href;
    const head = href.slice(0, href.indexOf('?'));
    return {
      url: head + (kept.length ? '?' + kept.join('&') : '') + url.hash,
      removed
    };
  }

  root.HyLinkClean = { CLICK_IDS, cleanUrl, compilePattern };
})(typeof self !== 'undefined' ? self : this);
