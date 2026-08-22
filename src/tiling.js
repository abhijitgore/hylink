/**
 * Window tiling. Chrome has no split-view API, so "open in side" means: shrink the
 * window the link came from onto one half of its display's work area, and create a
 * second real browser window on the other half.
 */
(function (root) {
  'use strict';

  /**
   * Resolve the usable rectangle for the display that `win` mostly sits on.
   * Uses workArea (excludes Dock / taskbar / menu bar), and falls back to the
   * window's own bounds if the display API is unavailable.
   */
  async function workAreaFor(win) {
    const fallback = {
      left: win.left ?? 0,
      top: win.top ?? 0,
      width: win.width ?? 1280,
      height: win.height ?? 800
    };
    let displays;
    try {
      displays = await chrome.system.display.getInfo();
    } catch (_) {
      return fallback;
    }
    if (!Array.isArray(displays) || !displays.length) return fallback;

    const cx = fallback.left + fallback.width / 2;
    const cy = fallback.top + fallback.height / 2;
    const containing = displays.find((d) => {
      const a = d.workArea;
      return cx >= a.left && cx < a.left + a.width && cy >= a.top && cy < a.top + a.height;
    });
    const chosen = containing || displays.find((d) => d.isPrimary) || displays[0];
    return { ...chosen.workArea };
  }

  /** Split a rectangle into the [existing window, new window] halves for a mode. */
  function halves(area, mode) {
    if (mode === 'sideStacked') {
      const top = Math.floor(area.height / 2);
      return [
        { left: area.left, top: area.top, width: area.width, height: top },
        { left: area.left, top: area.top + top, width: area.width, height: area.height - top }
      ];
    }
    const leftW = Math.floor(area.width / 2);
    return [
      { left: area.left, top: area.top, width: leftW, height: area.height },
      { left: area.left + leftW, top: area.top, width: area.width - leftW, height: area.height }
    ];
  }

  /**
   * @param {string} url
   * @param {'sideRight'|'sideStacked'} mode
   * @param {number} windowId window the link was hovered in
   */
  async function openTiled(url, mode, windowId) {
    let current = await chrome.windows.get(windowId);

    // Bounds are ignored while a window is maximized or fullscreen, and Chrome
    // rejects `state` combined with bounds — so restore first, then measure.
    if (current.state && current.state !== 'normal') {
      await chrome.windows.update(current.id, { state: 'normal' });
      current = await chrome.windows.get(current.id);
    }

    const area = await workAreaFor(current);
    const [keep, fresh] = halves(area, mode);

    // `state` must not be combined with bounds in one update call.
    await chrome.windows.update(current.id, keep);
    await chrome.windows.create({ url, type: 'normal', focused: true, ...fresh });
  }

  root.HyLinkTiling = { openTiled, halves, workAreaFor };
})(typeof self !== 'undefined' ? self : this);
