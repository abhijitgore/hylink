# HyLink — hover link menu for Chrome

Hover the mouse over a hyperlink in a page's text, and the ways to open it come to you.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/demo-dark.gif">
  <img src="docs/demo-light.gif" alt="The mouse hovers over a link; three dots appear beside it; moving onto them opens a row of actions." width="533">
</picture>

## Why this exists

I got tired of right-clicking every link I wanted to open somewhere other than where I
was — right-click, hunt down the menu item, repeat, dozens of times a day. The whole
design goal is *reach*: the actions appear right where the pointer already is, one
short move away, and they get out of the way again the moment it is clear I did not
want them.

## Install

Not on the Chrome Web Store yet — `docs/store-listing.md` tracks what is left before
submission. Until then, clone it:

```
git clone https://github.com/abhijitgore/hylink.git
```

Chrome cannot enable an extension that did not come from its own store, so load it once:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the cloned folder.
4. Reload any tabs that were already open — content scripts only attach on load.

To use the **Open in incognito** action, also tick **Allow in incognito** for HyLink
on `chrome://extensions` — Chrome does not let an extension grant itself that, by
design. Until you do, the action says so in its menu caption rather than failing
silently.

### With Homebrew instead

```
brew install --cask abhijitgore/tap/hylink
```

That puts the extension in `~/Library/Application Support/HyLink`; point
**Load unpacked** there in the same four steps. The path stays the same across
upgrades, so loading is a one-time step — later `brew upgrade` runs land under the
same folder and a **Reload** on `chrome://extensions` picks them up.
`brew uninstall --cask hylink` takes it away again.

If you were already loading HyLink from a clone, remove that one from
`chrome://extensions` first — two copies loaded at once means two menus on every link.

## What is in the menu

Move onto the dots and they expand into the action bar:

| Icon | Action | What it does |
| --- | --- | --- |
| → | **Open link** | Navigates the current tab to the link. |
| ⊞ | **Open in new tab** | New tab right after the current one. |
| ↗ | **Open in new window** | A fresh, normally-sized window. |
| 🕵 | **Open in incognito** | Reuses an open incognito window, or makes one. Needs *Allow in incognito* — see [Install](#install). |
| ▐ | **Open in side (right)** | If the tab is **already in a Chrome split view**, navigates the other pane. Otherwise snaps the current window to the **left half** of the display and opens the link in a new window on the **right half**. |
| ▄ | **Open in side (stacked)** | Same split-view reuse; otherwise snaps the current window to the **top half** and opens the link in a new window on the **bottom half**. |
| 📋 | **Copy link address** | Copies the resolved absolute URL to the clipboard. |
| ✨ | **Copy clean link** | Copies the URL with tracking parameters stripped, the way Brave's *Copy clean link* does. Hovering the button shows how many will come off before you click. |

## How "open in side" works

**It is not Chrome's real Split View, and it cannot be yet.** Chrome 140 added Split
View, but the extension API for it is read-only: `tabs.splitViewId` lets an extension
*detect* a split view and nothing more. The proposal for a create API
([w3c/webextensions#967](https://github.com/w3c/webextensions/issues/967)) was opened
in March 2026 and is still open; for now only Chrome's own right-click →
**Open link in split view** makes one. The moment that API ships, this becomes a small
change. Until then, HyLink does the two things it actually can:

1. **Reuse an existing split view.** If the link's tab is already one pane of a split
   view, *either* side action navigates the other pane — no new window. Chrome offers
   split views both side-by-side and stacked, and the API exposes no orientation, so
   both actions simply fill the sibling pane of whatever layout you already have; they
   differ only in how they tile when there is no split view. Detecting one needs
   **Chrome 140+**; on older Chrome this step is skipped.
2. **Otherwise, tile real windows.** Most sites refuse to render inside an iframe
   (`X-Frame-Options` / CSP `frame-ancestors`), which rules out side-panel and
   injected-pane approaches, so HyLink uses `chrome.windows` plus
   `chrome.system.display`. It restores the current window out of
   maximized/fullscreen first, because Chrome ignores bounds while a window is
   maximized and rejects `state` combined with bounds in a single update call; it
   measures the **work area** of the display the window sits on, so the tiles never
   slide under the macOS Dock/menu bar or the Windows taskbar; and if the display API
   is unavailable it falls back to the current window's own bounds. The result looks
   similar to a split view but behaves differently — a second window, not a pane.

## Staying out of the way

A full toolbar popping up over every link you pass would make a page unreadable, so
nothing appears until you actually show interest:

1. **The mouse has to hover, not just pass through.** Any movement of more than a few
   pixels restarts the hover delay, so sweeping across text while reading never
   triggers anything.
2. **Then you get three dots** in a small frosted capsule, sitting just past the end of
   the link. It is about one character wide, translucent and blurred rather than solid,
   so the text underneath still shows through, and it fades out ~160 ms after you move
   away. It fills in solid the moment the pointer reaches it.
3. **Only when you move onto the capsule** does the bar open, growing out of it so it
   stays under your pointer. Holding the modifier key skips straight to it.

**Navigation links get nothing at all.** Links inside `<nav>`, `<header>`, `<footer>`,
`<aside>`, or an element with a navigational role — plus div-soup equivalents named
`sidebar`, `navbar`, `breadcrumbs`, `toolbar` and friends — are page chrome, not
reading material, and a hover menu there is pure noise. Hold the modifier key to get
the menu on one anyway, or untick **Skip navigation, headers and sidebars** in options.
Class and id names are matched on token boundaries, so `table-wrapper` is not `tabs`.

Scrolling closes the menu outright — if you're scrolling, you're reading, not clicking.
Prefer the old behaviour? Set **Show the full menu right away** in options.

## Settings

The options page opens once on install and leads with a looping animation of the whole
interaction — the mouse hovers, dots appear, dots open into the bar. It is drawn in
CSS rather than recorded, using the real icon set, so it stays sharp on any display,
follows your colour scheme, and cannot fall out of date with the menu. With
`prefers-reduced-motion` it holds the final frame as a still.

Click the HyLink toolbar icon for a quick on/off switch and a "disable on this site"
toggle, or open **All settings…** for:

- **Grip or full menu** on hover.
- **Skip navigation, headers and sidebars** (on by default).
- **Hover delay** (default 220 ms) before the grip appears.
- **Modifier gating** — optionally require Alt/Ctrl/Shift/Cmd to be held.
- **Which of the eight actions** appear in the bar.
- **Foreground vs background** new tabs.
- **Disabled sites** — one hostname per line; an entry also covers its subdomains.

Press <kbd>Esc</kbd>, click elsewhere, scroll, or move the pointer away to dismiss it.

## Languages

The menu, popup and options page follow Chrome's language setting:

| | | |
| --- | --- | --- |
| English (`en`) | Español (`es`) | Português do Brasil (`pt_BR`) |
| Русский (`ru`) | हिन्दी (`hi`) | Français (`fr`) |
| Deutsch (`de`) | 日本語 (`ja`) | Bahasa Indonesia (`id`) |
| Türkçe (`tr`) | | |

Anything else falls back to English, and so does any string a catalogue happens to be
missing — `default_locale` is `en`. The regional variants resolve on their own:
`en_GB`, `es_419`, `pt_PT` and friends land on the closest catalogue.

Only the extension's own UI is translated. The Chrome Web Store listing is not, and
the manifest's name and description are deliberately left in English — those are store
copy, translated in the developer dashboard rather than from `_locales/`.

The nine non-English catalogues in `_locales/` were not written by native speakers, so
corrections are welcome; `node tests/run.js` checks that every catalogue has exactly
the same keys as `en` and keeps its `$placeholders$`.

## Clean links

**Copy clean link** removes tracking parameters before the URL reaches your clipboard —
`utm_*`, `fbclid`, `gclid`, `si`, Amazon's `ref_`, and several hundred more — so what
you paste into a message is the page, not a record of how you got there.

The rules are Brave's, copied verbatim from
[brave/adblock-lists](https://github.com/brave/adblock-lists/blob/master/brave-lists/clean-urls.json)
into `src/clean-list.js`, plus the click identifiers from Brave's navigation-time query
filter, which that list leaves out because Brave applies both passes to a copied link.
Refresh them with:

```
node tools/build-clean-list.js          # or pass a local path
```

Two things it deliberately will not do: touch anything that isn't `http`/`https`, and
re-encode a URL that had nothing to remove — a link you copy comes back byte-for-byte
unless something actually came off. Site-scoped rules stay scoped, so YouTube's `si`
comes off a `/watch` link and nothing else.

`src/clean-list.js` carries Brave's Mozilla Public License 2.0, noted in its header and
in [NOTICE.md](NOTICE.md); the rest of HyLink is MIT, see [LICENSE](LICENSE). Cleaning runs in the service worker, so the
rule list never gets injected into the pages you visit.

## Layout

```
manifest.json
src/settings.js     shared defaults, storage helpers, denylist matching
src/icons.js        the menu's icon set, shared with the options page
_locales/           ten UI translations; `en` is the fallback
ui/i18n.js          fills the pages from _locales, keeping the English as a fallback
src/clean.js        tracking-parameter removal (worker only)
src/clean-list.js   GENERATED — Brave's rules, MPL-2.0; see tools/build-clean-list.js
src/content.js      hover detection + top-layer shadow-DOM menu (all frames)
src/tiling.js       display work-area math and window placement
src/background.js   service worker; split-view reuse, tabs/windows privileges
ui/                 options page and toolbar popup
tests/run.js        `node tests/run.js` — 169 assertions, no dependencies
tools/              regenerates the clean-link rules from Brave's list
tests/harness/      manual page for hover timing and overlay-dodging
icons/
```

## Tests

```
node tests/run.js
```

Loads each module into a vm context with a stubbed `chrome` and asserts on the API
calls it makes: settings normalization, denylist matching, tiling geometry against a
maximized window on a secondary display, the URL scheme guard (rejections *and*
acceptances), tab placement, and every split-view fallback path.

`tests/harness/` is a page for the parts that need a real browser — hover timing,
top-layer rendering, stepping around a hover card, and the navigation denylist against
a real nav bar and sidebar. Run `tests/harness/build.sh` first. See its README.

## Publishing

[RELEASING.md](RELEASING.md) is the release checklist — the important part being that
the [Homebrew tap](https://github.com/abhijitgore/homebrew-tap) pins a version and a
tarball checksum, so a new tag here is not finished until the cask there is bumped.
Nothing errors if they drift; `brew install` just keeps serving the old version.

`docs/store-listing.md` holds everything the Chrome Web Store dashboard asks for —
single-purpose statement, listing copy, permission justifications, privacy answers.
The screenshots and the 440×280 promo tile live in `docs/store/`, and `PRIVACY.md`,
the privacy policy, is hosted at a public URL.

`node tests/run.js` guards the mechanical parts: manifest version, the 132-character
description limit, icon sizes, the permission set, the absence of remote code, inline
scripts and `unload` handlers, and that no Markdown file has picked up a harvestable
email address.

## Notes and limits

- **Permissions**: `storage`, `system.display`, `clipboardWrite`, `activeTab`. The
  broad `tabs` permission is deliberately *not* requested — everything HyLink does
  works without it, and it would add a "read your browsing history" install warning.
- Only `http`, `https`, `ftp` and `file` links get a menu; `javascript:` and bare
  `#` links are ignored, and the service worker re-validates the scheme before
  touching any tabs/windows API.
- `file://` links need **Allow access to file URLs** enabled for HyLink on
  `chrome://extensions` — without it Chrome rejects the tab/window and the reason
  appears in the menu caption.
- **Open link** assigns `location.href`, so on a single-page app it performs a full
  navigation rather than a client-side route change.
- The menu cannot appear on `chrome://` pages, the Chrome Web Store, or other
  extensions' pages — Chrome blocks content scripts there.
- Copying uses the async clipboard API, falling back to a hidden textarea on
  insecure (`http`) origins.
- The menu renders in the browser's **top layer** (Popover API) so page overlays —
  Wikipedia's link previews, for instance — cannot cover it, and it also *steps out
  of their way*: it hit-tests six candidate positions around the link and picks one
  clear of any hover card, tooltip or sticky header, rechecking when an overlay
  arrives after the menu (Wikipedia's lands ~100 ms later). On a browser without
  popover support it falls back to a maximum `z-index`.
