/**
 * Shared settings contract. Loaded as a plain (non-module) script by the content
 * script, the options page, the popup, and via importScripts() in the service
 * worker, so everything agrees on defaults and storage keys.
 */
(function (root) {
  'use strict';

  /** Every action the hover menu can offer, in menu order. */
  const ACTIONS = [
    { id: 'open',        label: 'Open link' },
    { id: 'newTab',      label: 'Open in new tab' },
    { id: 'newWindow',   label: 'Open in new window' },
    { id: 'incognito',   label: 'Open in incognito' },
    { id: 'sideRight',   label: 'Open in side (right)' },
    { id: 'sideStacked', label: 'Open in side (stacked)' },
    { id: 'copy',        label: 'Copy link address' },
    { id: 'copyClean',   label: 'Copy clean link' }
  ];

  /**
   * The action set as it stood when settings were an opt-in `visibleActions` list.
   * Migration is computed against this, not against ACTIONS, so actions added later
   * are never retroactively hidden from someone who customised their menu.
   */
  const LEGACY_ACTIONS = ['open', 'newTab', 'newWindow', 'sideRight', 'sideStacked', 'copy'];

  /**
   * Page chrome: regions whose links are navigation rather than prose. The
   * semantic half is exact and near-lossless — article text is never inside
   * <nav>/<header>/<footer>/<aside> or one of these roles.
   */
  const NAV_SELECTOR = [
    'nav', 'header', 'footer', 'aside',
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
    '[role="menubar"]', '[role="menu"]', '[role="tablist"]',
    '[role="toolbar"]', '[role="search"]'
  ].join(',');

  /**
   * The div-soup half: class/id names that mean the same thing. Matched on token
   * boundaries, never as substrings — "tabs" must not fire on "table-wrapper",
   * and "nav" must not fire on "navigate-to-content".
   */
  const NAV_TOKEN_RE = /(^|[\s_-])(nav|navbar|navigation|navmenu|menu|menubar|submenu|sidebar|sidenav|toolbar|breadcrumb|breadcrumbs|pagination|paginator|topbar|masthead|header|footer|tabs|tablist|drawer|rail)([\s_-]|$)/i;

  /** True when a class/id string names a navigational region. */
  function looksNavigational(text) {
    const value = String(text || '');
    return value ? NAV_TOKEN_RE.test(value) : false;
  }

  const DEFAULTS = {
    enabled: true,
    /**
     * ms the pointer must *rest* on a link before the menu appears. The content
     * script restarts this whenever the pointer moves more than a few px, so
     * sweeping across text while reading never triggers it.
     */
    hoverDelay: 220,
    /** 'handle' shows a small grip that expands on hover; 'immediate' shows the full bar */
    expandMode: 'handle',
    /** when true the menu only appears while `modifier` is held */
    requireModifier: false,
    /** 'alt' | 'ctrl' | 'shift' | 'meta' */
    modifier: 'alt',
    /** focus the tab created by "Open in new tab" */
    newTabActive: true,
    /** action ids the user has switched off — opt-out, so new actions appear by default */
    hiddenActions: [],
    /** skip links inside navigation, headers, footers and sidebars */
    skipNavigation: true,
    /** hostnames where the menu never appears */
    disabledSites: []
  };

  async function getSettings() {
    try {
      // `storage.sync.get(DEFAULTS)` only returns keys present in DEFAULTS, so the
      // retired key has to be asked for explicitly for migration to see it.
      const stored = await chrome.storage.sync.get({ ...DEFAULTS, visibleActions: null });
      return normalize(await migrate(stored));
    } catch (_) {
      return normalize({});
    }
  }

  /** One-time conversion of the old opt-in list into the opt-out one. */
  async function migrate(stored) {
    const legacy = stored.visibleActions;
    if (!Array.isArray(legacy)) return stored;
    const hiddenActions = LEGACY_ACTIONS.filter((id) => !legacy.includes(id));
    const next = { ...stored, hiddenActions };
    delete next.visibleActions;
    try {
      await chrome.storage.sync.set({ hiddenActions });
      // Without the remove, migration would run again on every read.
      await chrome.storage.sync.remove('visibleActions');
    } catch (_) {
      // A failed write just means we migrate again next time; harmless.
    }
    return next;
  }

  /** Guards against stale, hand-edited, or deleted storage values. */
  function normalize(raw) {
    const s = { ...DEFAULTS };
    for (const [key, value] of Object.entries(raw || {})) {
      // A deleted key arrives as undefined; that must not shadow the default.
      if (value !== undefined && key !== 'visibleActions') s[key] = value;
    }

    const ids = ACTIONS.map((a) => a.id);
    const known = new Set(ids);
    s.hiddenActions = Array.isArray(s.hiddenActions)
      ? s.hiddenActions.filter((id) => known.has(id))
      : [];
    // Hiding every action would leave an empty bar; treat that as hiding none.
    if (s.hiddenActions.length >= ids.length) s.hiddenActions = [];
    /** Derived, never stored — what the menu actually renders. */
    s.visibleActions = ids.filter((id) => !s.hiddenActions.includes(id));

    const delay = Number(s.hoverDelay);
    // Number.isFinite, not `||`: a 0 ms delay is a valid choice, not a missing value.
    s.hoverDelay = clamp(Number.isFinite(delay) ? delay : DEFAULTS.hoverDelay, 0, 3000);

    s.disabledSites = Array.isArray(s.disabledSites)
      ? s.disabledSites.map((h) => String(h).trim().toLowerCase()).filter(Boolean)
      : [];
    if (!['alt', 'ctrl', 'shift', 'meta'].includes(s.modifier)) {
      s.modifier = DEFAULTS.modifier;
    }
    if (!['handle', 'immediate'].includes(s.expandMode)) {
      s.expandMode = DEFAULTS.expandMode;
    }
    return s;
  }

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  /** True when `hostname` is covered by the denylist (exact host or a parent domain). */
  function isSiteDisabled(disabledSites, hostname) {
    const host = String(hostname || '').toLowerCase();
    if (!host) return false;
    return disabledSites.some((entry) => host === entry || host.endsWith('.' + entry));
  }

  root.HyLinkSettings = {
    ACTIONS, LEGACY_ACTIONS, DEFAULTS, NAV_SELECTOR, NAV_TOKEN_RE,
    getSettings, migrate, normalize, isSiteDisabled, looksNavigational
  };
})(typeof self !== 'undefined' ? self : this);
