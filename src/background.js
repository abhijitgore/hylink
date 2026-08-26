/**
 * Service worker: the only place with tabs/windows/display privileges.
 * Content scripts send { type: 'hylink/action', action, url } and get back
 * { ok: true } or { ok: false, error }.
 */
importScripts('settings.js', 'tiling.js', 'clean-list.js', 'clean.js');

const { getSettings, t } = self.HyLinkSettings;
const { openTiled } = self.HyLinkTiling;
const { cleanUrl } = self.HyLinkClean;

/** Only these schemes are ever handed to tabs/windows APIs. */
const SAFE_SCHEMES = new Set(['http:', 'https:', 'ftp:', 'file:']);

function assertSafe(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_) {
    throw new Error(t('errBadUrl', 'Not a valid URL'));
  }
  if (!SAFE_SCHEMES.has(parsed.protocol)) {
    throw new Error(t('errScheme', `Refusing to open ${parsed.protocol} link`, [parsed.protocol]));
  }
  return parsed.href;
}

/**
 * Chrome exposes no way for an extension to *create* a split view: `tabs.splitViewId`
 * is read-only and the proposal for a create/unsplit API (w3c/webextensions#967) is
 * still open. Only Chrome's own right-click "Open link in split view" can make one.
 *
 * What we can do is reuse a split view the user already has open — navigate the other
 * pane instead of spawning a window. Returns false if there is no split view to reuse,
 * so the caller can fall back to window tiling.
 */
async function reuseSplitView(url, sender) {
  // splitViewId landed in Chrome 140; older builds simply tile.
  if (chrome.tabs.SPLIT_VIEW_ID_NONE === undefined) return false;
  const senderId = sender?.tab?.id;
  if (senderId === undefined) return false;

  // Re-read the tab: the splitViewId on `sender` can be stale by the time we act.
  const tab = await chrome.tabs.get(senderId);
  const splitViewId = tab.splitViewId;
  if (splitViewId === undefined || splitViewId === chrome.tabs.SPLIT_VIEW_ID_NONE) {
    return false;
  }

  const panes = await chrome.tabs.query({ windowId: tab.windowId, splitViewId });
  const other = panes.find((t) => t.id !== tab.id);
  if (!other) return false;

  await chrome.tabs.update(other.id, { url });
  return true;
}

/**
 * "Allowed in incognito" is a user-only setting on chrome://extensions — an
 * extension cannot grant it to itself, by design. Without it, windows.create({
 * incognito: true }) is rejected, so check first and return something the caption
 * can actually act on.
 *
 * Reuses an open incognito window when there is one rather than piling up new ones.
 */
async function openIncognito(url) {
  let allowed = true;
  try {
    allowed = await chrome.extension.isAllowedIncognitoAccess();
  } catch (_) {
    // Older builds without the check: fall through and let create() decide.
  }
  if (!allowed) {
    throw new Error(t('errIncognito', 'Allow HyLink in incognito first (chrome://extensions)'));
  }

  let windows = [];
  try {
    windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  } catch (_) {
    windows = [];
  }
  const open = windows.filter((w) => w.incognito);
  const target = open.find((w) => w.focused) || open[0];

  if (target) {
    await chrome.tabs.create({ url, windowId: target.id, active: true });
    await chrome.windows.update(target.id, { focused: true });
    return;
  }
  // Still guarded: incognito can be switched off by enterprise policy even when
  // the extension itself is allowed in it.
  await chrome.windows.create({ url, incognito: true, focused: true });
}

async function handle(action, rawUrl, sender) {
  const settings = await getSettings();
  // Cleaning happens after the scheme guard, not before: the guard is what makes the
  // page's URL safe to touch at all. Anything the worker opens is cleaned here, in the
  // one place that already has the rule list — the content script cleans only the two
  // actions that never reach us.
  const safe = assertSafe(rawUrl);
  const url = settings.cleanBeforeAction ? cleanUrl(safe).url : safe;
  const windowId = sender?.tab?.windowId ?? chrome.windows.WINDOW_ID_CURRENT;

  switch (action) {
    case 'newTab': {
      await chrome.tabs.create({
        url,
        active: settings.newTabActive,
        windowId: sender?.tab?.windowId,
        index: sender?.tab ? sender.tab.index + 1 : undefined
      });
      return;
    }
    case 'newWindow':
      await chrome.windows.create({ url, type: 'normal', focused: true });
      return;
    case 'incognito':
      await openIncognito(url);
      return;
    case 'sideRight':
    case 'sideStacked':
      // Chrome offers split views in both orientations (side-by-side, and the newer
      // stacked top/bottom layout), and the API exposes no orientation field — so
      // either action simply fills the sibling pane of whatever split view is already
      // open. The two differ only in how they tile when there is none to reuse.
      try {
        if (await reuseSplitView(url, sender)) return;
      } catch (_) {
        // Any hiccup reading or updating the sibling pane — just tile instead.
      }
      await openTiled(url, action, windowId);
      return;
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

/**
 * First run: open the options page once, so the first thing that happens is an
 * explanation rather than an unexplained menu appearing next to a link. Only on a
 * fresh install — updates stay silent.
 */
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // The rule list lives here rather than in the content script, so the page asks for
  // a cleaned URL instead of carrying 18 kB of rules into every frame.
  if (msg && msg.type === 'hylink/clean') {
    try {
      sendResponse({ ok: true, ...cleanUrl(assertSafe(msg.url)) });
    } catch (err) {
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
    return false;
  }
  if (!msg || msg.type !== 'hylink/action') return false;
  handle(msg.action, msg.url, sender)
    .then(() => sendResponse({ ok: true }))
    .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true; // keep the message channel open for the async response
});
