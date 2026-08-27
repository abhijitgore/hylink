/**
 * Shared settings contract. Loaded as a plain (non-module) script by the content
 * script, the options page, the popup, and via importScripts() in the service
 * worker, so everything agrees on defaults and storage keys.
 */
(function (root) {
  'use strict';

  /** Every action the hover menu can offer, in its default menu order. */
  const ACTIONS = [
    { id: 'open',        key: 'actionOpen',        label: 'Open link' },
    { id: 'newTab',      key: 'actionNewTab',      label: 'Open in new tab' },
    { id: 'newWindow',   key: 'actionNewWindow',   label: 'Open in new window' },
    { id: 'incognito',   key: 'actionIncognito',   label: 'Open in incognito' },
    { id: 'sideRight',   key: 'actionSideRight',   label: 'Open in side (right)' },
    { id: 'sideStacked', key: 'actionSideStacked', label: 'Open in side (stacked)' },
    { id: 'copy',        key: 'actionCopy',        label: 'Copy link address' },
    { id: 'copyClean',   key: 'actionCopyClean',   label: 'Copy clean link' }
  ];

  /**
   * Localised text, falling back to the English written inline above and in the
   * pages themselves — so a missing catalogue degrades to English rather than to
   * blank buttons, and the tests can run without a `chrome` object at all.
   */
  function t(key, fallback, subs) {
    try {
      return chrome.i18n.getMessage(key, subs) || fallback;
    } catch (_) {
      return fallback;
    }
  }

  /** The menu label for an action, in the user's language. */
  function actionLabel(action) {
    return t(action.key, action.label);
  }

  /** The action with this id, or undefined — callers walk id lists, not ACTIONS. */
  function actionById(id) {
    return ACTIONS.find((action) => action.id === id);
  }

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
     * ms the mouse must *hover* a link, without moving, before the menu appears.
     * The content script restarts this whenever the pointer moves more than a few
     * px, so sweeping across text while reading never triggers it.
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
    /**
     * The menu's order, as ids. Stored in full rather than as a diff from ACTIONS:
     * the whole point is that the code's order stops being authoritative.
     */
    actionOrder: ACTIONS.map((a) => a.id),
    /**
     * Strip tracking parameters from links the menu *opens* — new tab, new window,
     * incognito, either side action, and the current tab. On by default: a link you
     * follow has no use for the campaign tag that came with it.
     *
     * Never the copy buttons. "Copy link address" hands over exactly what is there,
     * and "Copy clean link" is the one that strips, so the two are always a click
     * apart and neither depends on what this is set to.
     */
    cleanBeforeOpen: true,
    /** skip links inside navigation, headers, footers and sidebars */
    skipNavigation: true,
    /** hostnames where the menu never appears */
    disabledSites: []
  };

  /**
   * Keys that used to mean something and no longer do. They are ignored as input and
   * swept out of sync storage on the next read; because `storage.sync.get()` returns
   * only the keys it is asked for, leaving one out of DEFAULTS is already enough to
   * make it inert, and this only stops it sitting there forever.
   */
  const RETIRED = ['visibleActions', 'cleanBeforeAction'];

  async function getSettings() {
    try {
      // `storage.sync.get(DEFAULTS)` only returns keys present in DEFAULTS, so a
      // retired key has to be asked for explicitly for migration to see it at all.
      const asked = { ...DEFAULTS };
      for (const key of RETIRED) asked[key] = null;
      const stored = await chrome.storage.sync.get(asked);
      return normalize(await migrate(stored));
    } catch (_) {
      return normalize({});
    }
  }

  /**
   * One-time conversion of the old opt-in list into the opt-out one, plus the sweep of
   * anything else retired. `cleanBeforeAction` gets no conversion on purpose: it used
   * to mean "clean every action, copy included" and was off by default, so carrying a
   * stored value across would switch the new default off for exactly the people who
   * had already opened the options page once.
   */
  async function migrate(stored) {
    const next = { ...stored };
    const dead = RETIRED.filter((key) => stored[key] !== null && stored[key] !== undefined);
    for (const key of RETIRED) delete next[key];

    const legacy = stored.visibleActions;
    if (Array.isArray(legacy)) {
      next.hiddenActions = LEGACY_ACTIONS.filter((id) => !legacy.includes(id));
    }
    if (!dead.length) return next;

    try {
      if (Array.isArray(legacy)) await chrome.storage.sync.set({ hiddenActions: next.hiddenActions });
      // Without the remove, migration would run again on every read.
      await chrome.storage.sync.remove(dead);
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
      if (value !== undefined && !RETIRED.includes(key)) s[key] = value;
    }

    const ids = ACTIONS.map((a) => a.id);
    const known = new Set(ids);
    s.hiddenActions = Array.isArray(s.hiddenActions)
      ? s.hiddenActions.filter((id) => known.has(id))
      : [];
    // Hiding every action would leave an empty bar; treat that as hiding none.
    if (s.hiddenActions.length >= ids.length) s.hiddenActions = [];

    // A stored order can be stale in three ways: an id that no longer exists, the same
    // id twice, or — the one that matters — an action added since it was saved. That
    // last one is appended rather than dropped, for the same reason hiddenActions is an
    // opt-out list: a new action should turn up, not go missing.
    const seen = new Set();
    const order = [];
    for (const id of Array.isArray(s.actionOrder) ? s.actionOrder : []) {
      if (!known.has(id) || seen.has(id)) continue;
      seen.add(id);
      order.push(id);
    }
    for (const id of ids) if (!seen.has(id)) order.push(id);
    s.actionOrder = order;

    /** Derived, never stored — what the menu actually renders, in the user's order. */
    s.visibleActions = order.filter((id) => !s.hiddenActions.includes(id));

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
    getSettings, migrate, normalize, isSiteDisabled, looksNavigational, t, actionLabel,
    actionById
  };
})(typeof self !== 'undefined' ? self : this);
