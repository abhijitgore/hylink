/**
 * HyLink content script.
 *
 * Watches for the mouse hovering a hyperlink, then shows a compact action bar
 * next to it. The whole UI lives in a closed shadow root so page CSS can't reach
 * in and our CSS can't leak out.
 */
(function () {
  'use strict';

  const { ACTIONS, DEFAULTS, NAV_SELECTOR, getSettings, normalize, isSiteDisabled,
    looksNavigational, t, actionLabel } = self.HyLinkSettings;
  const { ICONS, svgIcon } = self.HyLinkIcons;

  /**
   * Page overlays (Wikipedia's link previews, for one) can sit at the same maximum
   * z-index and win on DOM order. The top layer beats every z-index, so use a
   * popover when available and keep the plain z-index path as a fallback.
   */
  const SUPPORTS_POPOVER =
    typeof HTMLElement !== 'undefined' &&
    typeof HTMLElement.prototype.showPopover === 'function';

  const SHOW_GAP = 6;      // px between the link and the menu
  const EDGE = 4;          // px kept clear of the viewport edges
  const GRIP_GAP = 3;      // px between the end of the link and the grip
  /**
   * The grip sits right at the link, so travel is short and the timeouts can be
   * tight; the expanded bar is further away and gets a little more grace.
   */
  const HIDE_DELAY_GRIP = 160;
  const HIDE_DELAY_BAR = 260;
  /**
   * Pointer movement beyond this (px) restarts the delay, so the menu only appears
   * once the mouse actually stops moving — sweeping across text while reading never
   * triggers it.
   */
  const REST_RADIUS = 6;
  const LATE_OVERLAY_DELAY = 550;  // ms; catches hover cards that appear after us
  const COVERS_LINK = 100;         // obstruction score for sitting on the link itself
  const OVERLAY_MAX_AREA = 0.6;    // bigger than this share of the viewport = not an overlay
  const SAFE_SCHEMES = new Set(['http:', 'https:', 'ftp:', 'file:']);
  /**
   * How far up from a link we look for a navigational wrapper. Deep enough for
   * the usual nav > ul > li > span nesting, shallow enough that one oddly-named
   * ancestor near <body> can't disable a whole page.
   */
  const NAV_ANCESTOR_LIMIT = 10;

  let settings = { ...DEFAULTS };
  let active = false;      // enabled here (global toggle + site denylist)

  let host = null;         // shadow host element
  let shadow = null;
  let menuEl = null;
  let captionEl = null;

  let currentAnchor = null;    // anchor the open menu belongs to
  let currentUrl = '';
  let expanded = false;        // false = small grip, true = full action bar
  let pendingAnchor = null;    // anchor waiting out the hover delay
  let restPoint = { x: 0, y: 0 };
  let gripBox = null;          // where the grip sat, so the bar can grow out of it
  let cleanRequest = null;     // { url, promise } — cleaned URL, fetched on hover
  let showTimer = 0;
  let hideTimer = 0;
  let recheckTimer = 0;
  let repositionQueued = false;
  let pointerInMenu = false;
  let overlayObserver = null;


  const STYLE = `
    :host { all: initial; }
    .menu {
      position: fixed;
      z-index: 2147483647;
      box-sizing: border-box;
      display: inline-block;
      /* Neutralise the UA popover defaults (inset:0; margin:auto; overflow:auto),
         which would otherwise centre the menu and fight our top/left. */
      inset: auto;
      margin: 0;
      overflow: visible;
      padding: 4px;
      border-radius: 10px;
      background: #ffffff;
      border: 1px solid rgba(15, 23, 42, 0.12);
      box-shadow: 0 6px 22px rgba(15, 23, 42, 0.18), 0 1px 2px rgba(15, 23, 42, 0.10);
      font: 500 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      color: #0f172a;
      opacity: 0;
      transform: translateY(-2px);
      transition: opacity 90ms ease-out, transform 90ms ease-out;
      -webkit-font-smoothing: antialiased;
    }
    .menu.visible { opacity: 1; transform: none; }
    /* Stage 1: three dots in a small frosted capsule. Bare dots read as page
       punctuation and get lost; a solid chip would sit on the sentence. The
       capsule is translucent and blurred, so it separates from any background
       without hiding it, and it fills in solid the moment you reach it. */
    .menu.grip {
      padding: 0; border: 0; border-radius: 999px;
      background: none; box-shadow: none;
    }
    .menu.grip.visible { opacity: 1; }
    .menu.grip .row, .menu.grip .caption { display: none; }
    .menu .dots { display: none; }
    .menu.grip .dots {
      display: flex; align-items: center; justify-content: center; gap: 2.5px;
      width: 22px; height: 15px; cursor: pointer;
      border-radius: 999px;
      background: rgba(255, 255, 255, .62);
      border: 1px solid rgba(79, 70, 229, .3);
      box-shadow: 0 1px 3px rgba(15, 23, 42, .14);
      backdrop-filter: blur(3px) saturate(1.2);
      -webkit-backdrop-filter: blur(3px) saturate(1.2);
      transition: background 110ms ease-out, border-color 110ms ease-out,
                  box-shadow 110ms ease-out, transform 110ms ease-out;
    }
    /* A short pop on arrival: motion is what makes it findable, and it costs
       nothing once it has stopped. */
    .menu.grip.visible .dots { animation: hylink-pop 200ms ease-out; }
    @keyframes hylink-pop {
      from { transform: scale(.55); opacity: .15; }
      to   { transform: none; opacity: 1; }
    }
    .menu.grip.visible:hover .dots {
      background: #4f46e5; border-color: #4f46e5; transform: scale(1.1);
      box-shadow: 0 2px 7px rgba(79, 70, 229, .42);
    }
    .dots i {
      display: block; width: 3px; height: 3px; border-radius: 50%;
      background: #4f46e5;
    }
    .menu.grip.visible:hover .dots i { background: #fff; }
    @media (prefers-reduced-motion: reduce) {
      .menu.grip.visible .dots { animation: none; }
      .menu.grip.visible:hover .dots { transform: none; }
    }
    .row { display: flex; gap: 2px; }
    .btn {
      all: unset;
      box-sizing: border-box;
      width: 30px; height: 28px;
      display: flex; align-items: center; justify-content: center;
      border-radius: 7px;
      cursor: pointer;
      color: #334155;
    }
    .btn:hover, .btn:focus-visible { background: #eef2ff; color: #4338ca; }
    .btn:focus-visible { outline: 2px solid #6366f1; outline-offset: -2px; }
    .btn:active { background: #e0e7ff; }
    .btn svg { display: block; }
    .btn svg :not(.fill) { fill: none; stroke: currentColor; stroke-width: 1.4;
      stroke-linecap: round; stroke-linejoin: round; }
    .btn svg .fill { fill: currentColor; stroke: none; opacity: .28; }
    .caption {
      max-width: 236px;
      margin: 3px 4px 1px;
      overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
      font-size: 11px; color: #64748b;
    }
    .caption.strong { color: #0f172a; }
    .caption.error { color: #b91c1c; }
    @media (prefers-color-scheme: dark) {
      .menu { background: #1e293b; color: #e2e8f0; border-color: rgba(148,163,184,.22);
        box-shadow: 0 6px 22px rgba(0,0,0,.5); }
      .btn { color: #cbd5e1; }
      .btn:hover, .btn:focus-visible { background: #334155; color: #c7d2fe; }
      .btn:active { background: #475569; }
      .caption { color: #94a3b8; }
      .caption.strong { color: #e2e8f0; }
      .caption.error { color: #fca5a5; }
      .menu.grip .dots {
        background: rgba(15, 23, 42, .66);
        border-color: rgba(165, 180, 252, .42);
        box-shadow: 0 1px 3px rgba(0, 0, 0, .45);
      }
      .menu.grip.visible:hover .dots {
        background: #6366f1; border-color: #818cf8;
        box-shadow: 0 2px 7px rgba(99, 102, 241, .5);
      }
      .dots i { background: #a5b4fc; }
      .menu.grip.visible:hover .dots i { background: #fff; }
    }
  `;

  /* ---------------------------------------------------------------- settings */

  async function loadSettings() {
    settings = await getSettings();
    applyActiveState();
  }

  function applyActiveState() {
    const nowActive =
      settings.enabled && !isSiteDisabled(settings.disabledSites, location.hostname);
    active = nowActive;
    if (!active) closeMenu();
    else if (menuEl) rebuildButtons();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    const next = { ...settings };
    for (const [key, { newValue }] of Object.entries(changes)) next[key] = newValue;
    settings = normalize(next);
    applyActiveState();
  });

  /* ------------------------------------------------------------ link parsing */

  /** Returns the usable absolute URL for an anchor, or '' if we should ignore it. */
  function urlFor(anchor) {
    const raw = anchor.href;
    // SVG <a> exposes href as an SVGAnimatedString, not a string.
    const value = typeof raw === 'string' ? raw : (raw && raw.baseVal) || '';
    if (!value) return '';
    let parsed;
    try {
      parsed = new URL(value, document.baseURI);
    } catch (_) {
      return '';
    }
    if (!SAFE_SCHEMES.has(parsed.protocol)) return '';
    // A bare "#" resolves to the current page with nothing else — not a real link.
    if (parsed.href === location.href && !parsed.hash) return '';
    return parsed.href;
  }

  /**
   * True when the link belongs to page chrome — a nav bar, sidebar, header or
   * footer — rather than to the page's text. Semantic markup answers this for
   * most sites; the class/id pass catches the div-soup ones.
   */
  const navCache = new WeakMap();
  function inPageChrome(anchor) {
    const cached = navCache.get(anchor);
    if (cached !== undefined) return cached;

    let verdict = false;
    if (anchor.closest(NAV_SELECTOR)) {
      verdict = true;
    } else {
      let el = anchor;
      for (let depth = 0; el && el !== document.body && depth < NAV_ANCESTOR_LIMIT; depth++) {
        // getAttribute, not .className: on SVG elements that is an SVGAnimatedString.
        const names = (el.getAttribute('class') || '') + ' ' + (el.getAttribute('id') || '');
        if (looksNavigational(names)) { verdict = true; break; }
        el = el.parentElement;
      }
    }
    navCache.set(anchor, verdict);
    return verdict;
  }

  function anchorFrom(node) {
    if (!node || node === host) return null;
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!el || typeof el.closest !== 'function') return null;
    const anchor = el.closest('a[href], area[href]');
    if (!anchor || !urlFor(anchor)) return null;
    return anchor;
  }

  function modifierHeld(e) {
    switch (settings.modifier) {
      case 'ctrl': return e.ctrlKey;
      case 'shift': return e.shiftKey;
      case 'meta': return e.metaKey;
      default: return e.altKey;
    }
  }

  /* --------------------------------------------------------------- menu DOM */

  function ensureMenu() {
    if (menuEl) return;
    host = document.createElement('hylink-root');
    // Zero-size and out of flow, so injecting it can never nudge the page's layout.
    host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;';
    shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = STYLE;

    menuEl = document.createElement('div');
    menuEl.className = 'menu';
    menuEl.setAttribute('role', 'menu');
    menuEl.setAttribute('aria-label', t('menuLabel', 'Link actions'));
    // 'manual' so Chrome never light-dismisses it; we own show/hide entirely.
    if (SUPPORTS_POPOVER) menuEl.setAttribute('popover', 'manual');

    const dots = document.createElement('div');
    dots.className = 'dots';
    dots.setAttribute('aria-label', t('menuLabel', 'Link actions'));
    for (let i = 0; i < 3; i++) dots.appendChild(document.createElement('i'));

    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.role = 'row';

    captionEl = document.createElement('div');
    captionEl.className = 'caption';

    menuEl.append(dots, row, captionEl);
    shadow.append(style, menuEl);
    (document.documentElement || document.body).appendChild(host);

    menuEl.addEventListener('pointerenter', () => {
      pointerInMenu = true;
      cancelHide();
      // Reaching the grip is the signal that the user actually wants the actions.
      if (!expanded) expand();
    });
    menuEl.addEventListener('pointerleave', () => { pointerInMenu = false; scheduleHide(); });
    menuEl.addEventListener('keydown', onMenuKeydown);
    rebuildButtons();
  }

  function rebuildButtons() {
    const row = shadow.querySelector('[data-role="row"]');
    row.textContent = '';
    for (const action of ACTIONS) {
      if (!settings.visibleActions.includes(action.id)) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn';
      btn.dataset.action = action.id;
      const label = actionLabel(action);
      btn.title = label;
      btn.setAttribute('role', 'menuitem');
      btn.setAttribute('aria-label', label);
      btn.appendChild(svgIcon(ICONS[action.id]));
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        run(action.id);
      });
      btn.addEventListener('pointerenter', () => {
        setCaption(label, 'strong');
        if (action.id === 'copyClean') previewClean(btn);
      });
      btn.addEventListener('pointerleave', () => setCaption(shortUrl(currentUrl)));
      btn.addEventListener('focus', () => setCaption(label, 'strong'));
      row.appendChild(btn);
    }
  }

  function setCaption(text, tone) {
    if (!captionEl) return;
    captionEl.textContent = text;
    captionEl.className = 'caption' + (tone ? ' ' + tone : '');
  }

  function shortUrl(url) {
    try {
      const u = new URL(url);
      const tail = (u.pathname + u.search).replace(/\/$/, '');
      return u.host + (tail && tail !== '/' ? tail : '');
    } catch (_) {
      return url;
    }
  }

  /* -------------------------------------------------------------- placement */

  /** The client rect of the hovered link closest to the pointer (links can wrap). */
  function anchorRect(anchor, point) {
    const rects = Array.from(anchor.getClientRects()).filter((r) => r.width && r.height);
    if (!rects.length) return anchor.getBoundingClientRect();
    if (!point) return rects[0];
    let best = rects[0];
    let bestDist = Infinity;
    for (const r of rects) {
      const dx = Math.max(r.left - point.x, 0, point.x - r.right);
      const dy = Math.max(r.top - point.y, 0, point.y - r.bottom);
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) { bestDist = dist; best = r; }
    }
    return best;
  }

  /**
   * Candidate positions around the link, in preference order. The menu never sits on
   * top of the link itself — a covered link is an unclickable link.
   */
  function placements(rect, mw, mh) {
    const middle = rect.top + (rect.height - mh) / 2;
    return [
      { top: rect.bottom + SHOW_GAP,      left: rect.left },          // below, left-aligned
      { top: rect.top - SHOW_GAP - mh,    left: rect.left },          // above, left-aligned
      { top: rect.bottom + SHOW_GAP,      left: rect.right - mw },    // below, right-aligned
      { top: rect.top - SHOW_GAP - mh,    left: rect.right - mw },    // above, right-aligned
      { top: middle,                      left: rect.right + SHOW_GAP },   // right of the link
      { top: middle,                      left: rect.left - SHOW_GAP - mw } // left of the link
    ];
  }

  function clampToViewport(p, mw, mh) {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const left = Math.min(Math.max(p.left, EDGE), Math.max(EDGE, vw - mw - EDGE));
    const top = Math.min(Math.max(p.top, EDGE), Math.max(EDGE, vh - mh - EDGE));
    return { top, left, right: left + mw, bottom: top + mh, width: mw, height: mh };
  }

  function overlaps(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  const OVERLAY = 'overlay';   // a hover card, tooltip, sticky header — step around it
  const CONTENT = 'content';   // ordinary page content — nothing floating here
  const SKIP = 'skip';         // invisible or zero-size layer — look deeper in the stack

  /**
   * Classify whatever the hit test found at one point.
   *
   * `n.contains(anchor)` is the test doing the real work: an overlay never contains
   * the link being hovered, whereas every layout wrapper the link sits inside does.
   */
  function classify(el, anchor) {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    for (let n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      if (n.contains(anchor)) return CONTENT;
      let cs;
      try {
        cs = getComputedStyle(n);
      } catch (_) {
        return CONTENT;
      }
      if (cs.position === 'static') continue;
      const r = n.getBoundingClientRect();
      // Zero-size positioned roots decide nothing — other extensions inject these,
      // and treating one as a verdict would mask the overlay sitting behind it.
      if (!r.width || !r.height) return SKIP;
      // Page-sized positioned elements are layout scaffolding, not overlays.
      if (r.width * r.height > vw * vh * OVERLAY_MAX_AREA) return CONTENT;
      const bg = cs.backgroundColor || '';
      const painted = bg !== 'transparent' && !/rgba\([^)]*,\s*0\s*\)/.test(bg);
      if (painted || cs.boxShadow !== 'none') return OVERLAY;
      return SKIP;   // positioned but unpainted: a click shim, not something to dodge
    }
    return CONTENT;
  }

  function pointIsCovered(x, y, anchor) {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    if (x < 0 || y < 0 || x >= vw || y >= vh) return false;
    let stack;
    try {
      stack = document.elementsFromPoint(x, y);
    } catch (_) {
      return false;
    }
    for (const el of stack) {
      if (el === host) continue;   // our own menu (listed twice: top layer + host box)
      if (el === document.documentElement || el === document.body) return false;
      const verdict = classify(el, anchor);
      if (verdict === OVERLAY) return true;
      if (verdict === CONTENT) return false;
      // SKIP: keep scanning deeper into the stack.
    }
    return false;
  }

  /** How badly a candidate box is obstructed. 0 means clear. */
  function obstruction(box, anchor, linkRect) {
    let score = overlaps(box, linkRect) ? COVERS_LINK : 0;
    const xs = [box.left + 3, (box.left + box.right) / 2, box.right - 3];
    const ys = [box.top + 3, (box.top + box.bottom) / 2, box.bottom - 3];
    for (const x of xs) {
      for (const y of ys) if (pointIsCovered(x, y, anchor)) score++;
    }
    return score;
  }

  /**
   * Growing the bar out of each corner of `from` (the grip). Every one of these
   * contains the grip itself, so the pointer that just arrived there stays inside
   * the bar — trying only one corner strands the pointer whenever that direction
   * happens to be blocked, and the bar dismisses itself the instant it moves.
   */
  function growFrom(from, mw, mh) {
    return [
      { left: from.left, top: from.top },              // down and right
      { left: from.left, top: from.bottom - mh },      // up and right
      { left: from.right - mw, top: from.top },        // down and left
      { left: from.right - mw, top: from.bottom - mh } // up and left
    ];
  }

  /** First unobstructed candidate, or the least obstructed one. */
  function choosePlacement(linkRect, mw, mh, from) {
    const candidates = placements(linkRect, mw, mh).map((p) => clampToViewport(p, mw, mh));
    if (from) {
      candidates.unshift(...growFrom(from, mw, mh).map((p) => clampToViewport(p, mw, mh)));
    }
    let best = candidates[0];
    let bestScore = Infinity;
    for (const box of candidates) {
      const score = obstruction(box, currentAnchor, linkRect);
      if (score === 0) return box;
      if (score < bestScore) { bestScore = score; best = box; }
    }
    return best;
  }

  /**
   * The grip goes just past the end of the link, on its own line. No overlay
   * hit-testing here: it occupies the link's own row, which hover cards rarely
   * cover, and probing on every hover would be work for nothing.
   */
  function gripPlacement(rect, mw, mh) {
    const after = clampToViewport(
      { left: rect.right + GRIP_GAP, top: rect.top + (rect.height - mh) / 2 }, mw, mh);
    if (!overlaps(after, rect)) return after;
    // No room after the link (it runs to the viewport edge) — drop below its end.
    return clampToViewport({ left: rect.right - mw, top: rect.bottom + GRIP_GAP }, mw, mh);
  }

  function currentBox(mw, mh) {
    const top = parseFloat(menuEl.style.top);
    const left = parseFloat(menuEl.style.left);
    if (!Number.isFinite(top) || !Number.isFinite(left)) return null;
    return { top, left, right: left + mw, bottom: top + mh, width: mw, height: mh };
  }

  function position(point, onlyIfBlocked, from) {
    if (!currentAnchor || !menuEl) return;
    const rect = anchorRect(currentAnchor, point);
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;

    // Link scrolled out of view — nothing to anchor to.
    if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) {
      teardown();
      return;
    }

    const { width: mw, height: mh } = menuEl.getBoundingClientRect();

    if (!expanded) {
      gripBox = gripPlacement(rect, mw, mh);
      menuEl.style.top = Math.round(gripBox.top) + 'px';
      menuEl.style.left = Math.round(gripBox.left) + 'px';
      return;
    }

    // Late-overlay rechecks must not shuffle a menu that is doing fine: moving it
    // out from under a pointer on its way over would trip the hide timer.
    if (onlyIfBlocked) {
      const box = currentBox(mw, mh);
      if (box && !obstruction(box, currentAnchor, rect)) return;
    }

    const chosen = choosePlacement(rect, mw, mh, from);
    menuEl.style.top = Math.round(chosen.top) + 'px';
    menuEl.style.left = Math.round(chosen.left) + 'px';
  }

  function queueReposition(onlyIfBlocked) {
    if (!currentAnchor || repositionQueued) return;
    repositionQueued = true;
    requestAnimationFrame(() => {
      repositionQueued = false;
      position(null, onlyIfBlocked === true);
    });
  }

  /**
   * Hover cards often appear a beat *after* the menu is already up — Wikipedia's page
   * previews land around 500 ms, our menu at 400 ms — so watch for one arriving and
   * step out of its way.
   */
  function watchForOverlays() {
    if (!overlayObserver && typeof MutationObserver === 'function' && document.body) {
      overlayObserver = new MutationObserver(() => recheckPlacement());
      overlayObserver.observe(document.body, { childList: true });
    }
    clearTimeout(recheckTimer);
    recheckTimer = setTimeout(recheckPlacement, LATE_OVERLAY_DELAY);
  }

  function recheckPlacement() {
    if (!currentAnchor || pointerInMenu) return;
    queueReposition(true);
  }

  function stopWatchingOverlays() {
    if (overlayObserver) overlayObserver.disconnect();
    overlayObserver = null;
    clearTimeout(recheckTimer);
  }

  /* ------------------------------------------------------- open / close flow */

  function openMenu(anchor, point, startExpanded) {
    const url = urlFor(anchor);
    if (!url) return;
    cancelHide();
    ensureMenu();
    currentAnchor = anchor;
    currentUrl = url;
    expanded = !!startExpanded;
    setCaption(shortUrl(url));
    applyStage();
    // A popover is display:none until shown, so promote it before measuring.
    promote();
    position(point, false);
    // position() tears the menu down if the link is off-screen.
    if (!menuEl) return;
    menuEl.classList.add('visible');
    if (expanded) watchForOverlays();
  }

  function applyStage() {
    if (!menuEl) return;
    menuEl.classList.toggle('grip', !expanded);
    menuEl.classList.toggle('expanded', expanded);
    menuEl.setAttribute('role', expanded ? 'menu' : 'button');
  }

  /** Grow the grip into the full action bar and re-place it at its new size. */
  function expand() {
    if (expanded || !menuEl || !currentAnchor) return;
    expanded = true;
    applyStage();
    // The bar is far bigger than the grip: re-place at the new size, growing out of
    // the grip so the pointer that just arrived stays inside it.
    position(null, false, gripBox);
    if (menuEl) watchForOverlays();
  }

  /** Move the menu into the top layer, above any page overlay. */
  function promote() {
    if (!SUPPORTS_POPOVER || !menuEl) return;
    try {
      // showPopover() throws if it is already open — which it is when the pointer
      // moves straight from one link to the next and we reuse the same element.
      if (!menuEl.matches(':popover-open')) menuEl.showPopover();
    } catch (_) {
      // The UA keeps a popover display:none until it is shown, so a failed
      // showPopover() would leave the menu invisible forever. Dropping the
      // attribute restores plain z-index rendering.
      menuEl.removeAttribute('popover');
    }
  }

  /** Remove the menu UI but leave any pending show timer alone. */
  function teardown() {
    clearTimeout(hideTimer);
    cleanRequest = null;
    stopWatchingOverlays();
    pointerInMenu = false;
    expanded = false;
    currentAnchor = null;
    currentUrl = '';
    if (host && host.isConnected) host.remove();
    host = null; shadow = null; menuEl = null; captionEl = null;
  }

  /** Full stop: drop the menu and abandon any link waiting out the hover delay. */
  function closeMenu() {
    clearTimeout(showTimer);
    pendingAnchor = null;
    teardown();
  }

  function scheduleShow(anchor, e) {
    if (anchor === currentAnchor) { cancelHide(); return; }
    if (anchor === pendingAnchor) return;
    pendingAnchor = anchor;
    restPoint = { x: e.clientX, y: e.clientY };
    armShowTimer(modifierHeld(e));
  }

  function armShowTimer(modifier) {
    clearTimeout(showTimer);
    const anchor = pendingAnchor;
    const point = restPoint;
    // A held modifier is an explicit request, so skip the grip and open the bar.
    const startExpanded = modifier || settings.expandMode === 'immediate';
    showTimer = setTimeout(() => {
      if (pendingAnchor !== anchor || !anchor.isConnected) return;
      pendingAnchor = null;
      openMenu(anchor, point, startExpanded);
    }, settings.hoverDelay);
  }

  /**
   * While the pointer is still travelling, keep pushing the delay out. This is what
   * stops the grip appearing under every link you sweep past while reading.
   */
  function onPointerMove(e) {
    if (!pendingAnchor) return;
    const dx = e.clientX - restPoint.x;
    const dy = e.clientY - restPoint.y;
    if (dx * dx + dy * dy <= REST_RADIUS * REST_RADIUS) return;
    restPoint = { x: e.clientX, y: e.clientY };
    armShowTimer(modifierHeld(e));
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(teardown, expanded ? HIDE_DELAY_BAR : HIDE_DELAY_GRIP);
  }

  function cancelHide() {
    clearTimeout(hideTimer);
  }

  /* ----------------------------------------------------------------- actions */

  /**
   * Ask the worker for the cleaned URL. Fired when the pointer reaches the button, so
   * the answer is already in hand by the time it is clicked and the caption can say
   * what will come off before you commit to it.
   */
  function requestClean(url) {
    if (cleanRequest && cleanRequest.url === url) return cleanRequest.promise;
    const promise = chrome.runtime
      .sendMessage({ type: 'hylink/clean', url })
      .then((res) => (res && res.ok ? res : { url, removed: [] }))
      .catch(() => ({ url, removed: [] }));   // worker asleep or gone: copy it as-is
    cleanRequest = { url, promise };
    return promise;
  }

  /**
   * Chrome's i18n has no plural rules, so each count gets its own message. Two forms
   * is enough for the languages shipped; a language needing more would need its own
   * key rather than a smarter helper here.
   */
  function cleanMessage(prefix, count) {
    if (!count) return t(prefix + 'None', prefix === 'capCleanPreview'
      ? 'Nothing to remove — already clean' : 'Copied — nothing to remove');
    if (count === 1) return t(prefix + 'One', prefix === 'capCleanPreview'
      ? 'Copy without 1 tracker' : 'Copied — 1 tracker removed');
    return t(prefix + 'Many', prefix === 'capCleanPreview'
      ? `Copy without ${count} trackers` : `Copied — ${count} trackers removed`, [String(count)]);
  }

  async function previewClean(btn) {
    const url = currentUrl;
    const res = await requestClean(url);
    // The pointer may have moved on while the worker woke up.
    if (currentUrl !== url || !btn.matches(':hover')) return;
    setCaption(cleanMessage('capCleanPreview', res.removed.length), 'strong');
  }

  async function run(actionId) {
    const url = currentUrl;
    if (!url) return;

    if (actionId === 'open') {
      closeMenu();
      location.href = url;
      return;
    }
    if (actionId === 'copy') {
      const ok = await copyText(url);
      setCaption(ok ? t('capCopied', 'Copied link address') : t('capCopyFailed', 'Could not copy'),
                 ok ? 'strong' : 'error');
      setTimeout(teardown, ok ? 650 : 1400);
      return;
    }
    if (actionId === 'copyClean') {
      const res = await requestClean(url);
      const ok = await copyText(res.url);
      setCaption(ok ? cleanMessage('capCleaned', res.removed.length)
                    : t('capCopyFailed', 'Could not copy'),
                 ok ? 'strong' : 'error');
      setTimeout(teardown, ok ? 900 : 1400);
      return;
    }

    try {
      const res = await chrome.runtime.sendMessage({
        type: 'hylink/action',
        action: actionId,
        url
      });
      if (res && res.ok === false) throw new Error(res.error);
      closeMenu();
    } catch (err) {
      setCaption(String(err?.message || err), 'error');
      setTimeout(teardown, 1600);
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      // Insecure origins and unfocused documents reject the async API.
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;';
      (document.body || document.documentElement).appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (_) {
      return false;
    }
  }

  /* ------------------------------------------------------------------ events */

  function onPointerOver(e) {
    if (!active) return;
    if (e.target === host) { cancelHide(); return; }

    const anchor = anchorFrom(e.target);
    if (anchor) {
      const forced = modifierHeld(e);
      if (settings.requireModifier && !forced) return;
      // Navigation links get nothing unless the modifier says otherwise — that
      // keeps the escape hatch, so the menu is never truly unreachable.
      if (!(settings.skipNavigation && !forced && inPageChrome(anchor))) {
        scheduleShow(anchor, e);
        return;
      }
    }
    // Pointer is over unrelated content.
    clearTimeout(showTimer);
    pendingAnchor = null;
    if (currentAnchor) scheduleHide();
  }

  function onMenuKeydown(e) {
    const buttons = Array.from(shadow.querySelectorAll('.btn'));
    const index = buttons.indexOf(shadow.activeElement);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = (index + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[Math.max(next, 0)].focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu();
    }
  }

  const MODIFIER_KEYS = { alt: 'Alt', ctrl: 'Control', shift: 'Shift', meta: 'Meta' };

  function onKeydown(e) {
    if (e.key === 'Escape' && currentAnchor) { closeMenu(); return; }
    // Pressing the modifier is as clear a signal of intent as reaching the grip.
    if (currentAnchor && !expanded && e.key === MODIFIER_KEYS[settings.modifier]) expand();
  }

  /**
   * Scrolling means reading, not clicking — so get out of the way. Scoped to the
   * document and to scrollers containing the link: `capture` also sees scroll
   * events from unrelated widgets (a carousel elsewhere on the page), which have
   * nothing to do with this menu.
   */
  function onScroll(e) {
    if (!currentAnchor) return;
    const t = e.target;
    if (t === document || t === document.documentElement || t === window ||
        (t && typeof t.contains === 'function' && t.contains(currentAnchor))) {
      closeMenu();
    }
  }

  function onPointerDown(e) {
    if (!currentAnchor) return;
    if (e.target === host) return; // clicks inside the menu are handled by buttons
    closeMenu();
  }

  document.addEventListener('pointerover', onPointerOver, true);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
  window.addEventListener('scroll', onScroll, true);
  // Reposition rather than close: scrolling signals "I'm reading", but a resize —
  // which pages fire spuriously — shouldn't yank the menu out from under anyone.
  window.addEventListener('resize', () => queueReposition(false));
  window.addEventListener('blur', closeMenu);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) closeMenu();
  });

  loadSettings();
})();
