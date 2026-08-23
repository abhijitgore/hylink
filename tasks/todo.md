# HyLink — hover link menu Chrome extension

## Goal
Hovering a hyperlink shows a compact floating menu with 6 actions:
1. Open link (same tab)
2. Open in new tab
3. Open in new window
4. Open in side — right  (current window -> left half, new window -> right half)
5. Open in side — stacked (current window -> top half, new window -> bottom half)
6. Copy link address

## Decisions
- MV3. Tiled real Chrome windows for "side" modes (user-chosen; iframe approaches
  are blocked by X-Frame-Options/CSP on most sites).
- Content script owns hover detection + menu UI in a closed Shadow DOM so page CSS
  can never leak in and our CSS can never leak out.
- Service worker owns all tabs/windows/system.display work.
- Options page for delay, modifier-key gating, per-action visibility, site denylist.

## Plan
- [x] manifest.json (MV3, permissions: storage, system.display, clipboardWrite, activeTab
      — dropped `tabs`, added `activeTab` for the popup's per-site toggle)
- [x] src/content.js  — hover tracking, shadow-DOM menu, positioning, keyboard nav
- [x] ~~src/content.css~~ — folded into content.js as a shadow-root <style>, so no
      web_accessible_resources / fetch round-trip is needed
- [x] src/background.js — action router: newTab/newWindow/sideRight/sideStacked
- [x] src/tiling.js  — display work-area math, un-maximize, place windows
- [x] src/settings.js — shared defaults + storage helpers
- [x] options.html/js  — settings UI
- [x] popup.html/js    — on/off toggle + "disable on this site"
- [x] icons
- [x] README with load-unpacked instructions
- [x] Verify: static checks + unit tests (34 assertions) — see Review
- [ ] Verify: load unpacked in Chrome, exercise all 6 actions (needs a human; not done)

## Review

Built as an MV3 extension, 12 files. Content script detects hover and renders the
action bar in a **closed shadow root**; the service worker is the only holder of
tabs/windows/display privileges and re-validates every URL scheme before acting.

**"Open in side" implementation** — `src/tiling.js`. Chrome has no split-view API and
most sites block iframing, so it tiles real windows: restore out of maximized first
(Chrome ignores bounds while maximized and rejects `state` + bounds in one update
call), pick the display whose *workArea* contains the window centre so tiles don't
slide under the Dock/taskbar, then `windows.update` the current window and
`windows.create` the new one.

**Permissions kept minimal**: `storage`, `system.display`, `clipboardWrite`,
`activeTab`. Deliberately no `tabs` permission — `tabs.create`, `windows.*` and
`sender.tab` all work without it, and it would add a "read your browsing history"
install warning.

### Bugs found and fixed during verification
1. `teardown()` vs `closeMenu()` — the hide timer originally cleared the *pending
   show* timer too, so moving the pointer directly from one link to another killed
   the second link's menu before it could appear. Split into UI-only teardown and
   full stop.
2. `chrome.windows.update` was being passed `state: 'normal'` together with bounds
   in one call, which Chrome rejects. Now two sequential calls.
3. `normalize()` let a deleted storage key (`newValue: undefined`) shadow the
   default via object spread.
4. `Number(x) || DEFAULT` discarded a legitimate `0 ms` hover delay, which the
   options slider explicitly allows. Now `Number.isFinite`.
5. `openMenu()` could deref a null `menuEl` when `position()` tore the menu down
   for an off-screen link.
6. SVG icons built via `DOMParser` instead of `innerHTML`, so pages enforcing
   `require-trusted-types-for 'script'` don't reject them.
7. Shadow host made zero-size and `position: fixed` so injecting it can't nudge
   page layout.

### Verification performed
- `node --check` on all 6 JS files; manifest/HTML/id/action-id cross-reference checks.
- 8 assertions on tiling math (odd-width splits, multi-display selection, work-area
  vs bounds, un-maximize ordering, display-API fallback).
- 13 assertions on settings normalization and denylist matching (subdomain match,
  no `notexample.com` false positive).
- 13 assertions driving the real service-worker message handler with stubbed Chrome
  APIs (tab index/window placement, scheme rejection for javascript:/data:/chrome://
  /vbscript:/blob:, unknown-action rejection, both tiling modes).

**Not verified**: loading unpacked in a live Chrome. The browser tooling available
here cannot install an unpacked extension, so real hover UX, clipboard behaviour and
on-screen window tiling are unconfirmed. See README for load-unpacked steps.


---

## Round 2 — reported bugs

- [x] **(1) Use Chrome's native split view** — *not possible; closest achievable shipped.*
      `tabs.splitViewId` (Chrome 140+) is read-only: extensions can detect a split view
      but cannot create or leave one. The create/unsplit API proposal
      (w3c/webextensions#967, opened March 2026) is still unimplemented, and Chrome's
      docs list no split-view parameter on `tabs.create`/`tabs.update`.
      **Shipped instead:** if the tab is already in a split view, "Open in side (right)"
      navigates the sibling pane via `tabs.query({windowId, splitViewId})` +
      `tabs.update`. Any failure — no sibling, pre-140 Chrome, `tabs.get` throwing —
      falls back to window tiling. "Stacked" always tiles, since Chrome's split view is
      side-by-side only.
- [x] **(2) Page overlays covering the menu** — the menu now renders in the browser's
      top layer via `popover="manual"` + `showPopover()`, which beats any z-index
      regardless of DOM order. Wikipedia's preview card sat at the same maximum
      z-index and won on document order; top layer removes that race entirely.
      Guarded with `:popover-open` (showPopover throws if already open, which happens
      on link-to-link moves that reuse the element). If showPopover fails for any
      other reason the code removes the `popover` attribute — without that the UA's
      `[popover]:not(:popover-open){display:none}` rule would leave the menu
      permanently invisible instead of falling back to the z-index path.
- [x] **(3) Copy icon read as overlapping windows** — replaced the two-sheets glyph
      with a clipboard, visually verified against the other five at 5.5x in a browser.

### Round 2 verification
- 8 new assertions on the split-view branch: sibling updated when in a split view,
  query shape, tiling fallback for not-in-split / no-sibling / pre-140 / `tabs.get`
  throwing, stacked never reusing a split view, and the scheme guard still running
  before any pane is touched.
- Icons rendered in real Chrome from the shipped `ICONS`/`STYLE` source (light + dark,
  actual size and 5.5x) and inspected.
- **Still not verified live:** popover behaviour on a real page, and the split-view
  reuse path, which needs an actual Chrome split view.

- [x] Consolidated all suites into `tests/run.js` (39 assertions, `node tests/run.js`,
      no dependencies).


---

## Round 3 — follow-ups

- [x] **Stacked split view.** Chrome is rolling out a stacked (top/bottom) split
      layout alongside side-by-side, so the round-2 "right variant only" rule was
      wrong. Both side actions now reuse an existing split view; the API still
      exposes no orientation and still cannot *create* one, so they differ only in
      their tiling fallback.
- [x] **Menu now avoids overlays instead of just covering them.** Six candidate
      positions around the link (below/above × left/right-aligned, then right/left of
      it), each hit-tested at nine points; the first clear one wins, and covering the
      link itself is heavily penalised. A `MutationObserver` on `<body>` plus a 550 ms
      recheck catches hover cards that appear after the menu, and repositioning is
      suppressed while the pointer is inside the menu or when the current spot is
      still clear — moving it out from under an approaching pointer would trip the
      hide timer.

### Bug found by building the live harness
The first implementation detected nothing. Instrumenting in a real browser showed
`elementsFromPoint` returning `hylink-root > hylink-root > div.preview > ...`: the
user has HyLink installed, so its content script was injecting a *second*, zero-size
host into the harness page. The scan took its verdict from the first stack entry, so
that invisible 0×0 element masked the card behind it and reported "clear".

Fixed by classifying each stack entry as overlay / content / skip and walking past
skips. This is not just a harness artefact — zero-size injected roots are common
(other extensions, analytics, a11y widgets), and any one of them would have defeated
overlay detection on a real page.

### Round 3 verification
- Driven live in Chrome via `tests/harness/`: menu below an unobstructed link; menu
  moving **above** when a Wikipedia-style card drops in 100 ms later; link near the
  viewport bottom. The dodge was confirmed *with* the installed extension's zero-size
  host still in the hit-test stack.
- Unit suite extended to 40 assertions, all passing.
- **Still not verified:** split-view reuse, which needs a real Chrome split view.

---

## Round 4 — incognito, and getting out of the reader's way

- [x] **Open in incognito.** Reuses an already-open incognito window (preferring the
      focused one) rather than piling up new ones; creates one otherwise.
      `chrome.extension.isAllowedIncognitoAccess()` is checked first, because Chrome
      rejects `windows.create({incognito:true})` unless the user has ticked "Allow in
      incognito" — which an extension cannot grant itself. When it isn't allowed, the
      caption says how to fix it instead of failing silently. The create call stays
      wrapped anyway for the enterprise-policy case.
- [x] **Two-stage disclosure instead of a bare auto-close.** A 200 ms timeout would
      just make the full bar flicker at readers. Intent is read in three steps:
      the pointer must *settle* (any movement > 6 px restarts the delay, so reading
      sweeps trigger nothing); then three dots appear — transparent, no panel, ~17 px
      wide, past the end of the link; only moving onto them opens the bar. Dismissal
      dropped to 160 ms for the dots, 260 ms for the bar. Scrolling closes outright.
- [x] **`hiddenActions` replaces `visibleActions`.** Opt-out storage means actions
      added in future versions appear by default. Migration is computed against the
      *legacy* action set, so a user who had customised their menu keeps their choices
      and still gets incognito; the retired key is deleted so it cannot re-run.

### Bugs found by driving the harness
1. **The grip covered the text after the link.** The first version was a filled chip —
   better than the full bar, but still sitting on top of the sentence. Replaced with
   three bare dots with contrast rings: no background, no border, no shadow.
2. **Expanding next to an overlay dismissed the menu instantly.** The bar grew only
   down-right out of the grip; when the hover card blocked that, placement fell back
   to a link-relative candidate *above* the link — leaving the pointer stranded
   outside the bar, which then hid itself. Fixed by generating all four corner
   growths from the grip, so every preferred candidate still contains the pointer.
3. **Closing on `resize` was wrong.** It made verification flaky, which prompted a
   re-think: scrolling means "I'm reading", but pages fire resize spuriously and
   dismissing the menu mid-use is exactly the annoyance this round set out to fix.
   Resize now repositions.

### Round 4 verification
- Rest gate measured in a real browser: 540 ms of pointer movement across a link
  produces nothing (`whileMoving: 0`); it appears once the pointer settles.
- Grip and expansion screenshotted; expansion geometry asserted programmatically by
  hit-test scanning for the host — expanded, clear of the hover card, clear of the
  link, and still under the pointer.
- Unit suite 40 → 57 assertions (migration, incognito branches), all passing.
- **Still not verified:** split-view reuse, and incognito itself, which needs the
  "Allow in incognito" tick.

## Round 5 — nav denylist + a grip you can actually see

- [x] `settings.js`: `NAV_SELECTOR`, `NAV_TOKEN_RE`, `looksNavigational()`, `skipNavigation` default
- [x] `content.js`: `inPageChrome(anchor)` with a WeakMap cache; gate in `onPointerOver`; modifier forces through
- [x] `content.js`: grip restyle — translucent capsule, entrance animation, solid indigo on hover
- [x] `ui/options.*`: "Skip navigation, headers and sidebars" toggle
- [x] tests for the token regex (positive *and* negative) + the new default
- [x] verify in a real page, bump to 1.4.0, README

### Review

**Denylist.** `NAV_SELECTOR` (semantic landmarks and roles) plus `NAV_TOKEN_RE`
(class/id names, matched on token boundaries) live in `settings.js`; `inPageChrome()`
in `content.js` checks `closest(NAV_SELECTOR)` first and then walks up to 10 ancestors
reading `class`/`id`, memoised per anchor in a `WeakMap`. Holding the modifier bypasses
it, so the menu is never truly unreachable, and `skipNavigation` turns it off entirely.

Verified in Chrome against the harness's new Case 4 — a semantic `<nav>` bar and a
div-soup `.left-rail`:

    { prose: true, topbar: false, rail: false, forced-with-alt: true }

and confirmed with a real mouse: hovering "Docs" in the bar leaves the page untouched,
hovering the prose link produces the capsule, moving onto it opens the full bar.

**Grip.** Bare dots were the wrong read — they looked like punctuation. Now a 22×15
capsule: `rgba(255,255,255,.62)` with a `backdrop-filter: blur(3px)`, a hairline indigo
border, a 200 ms scale-in, and a solid indigo fill on hover with the dots knocked out
white. Translucent and blurred rather than opaque, so the text underneath still reads.
`prefers-reduced-motion` drops the animation.

**Two harness problems found and fixed.** The installed extension injects into the
harness page, so probes counting `hylink-root` counted *its* menu and every case
"passed"; `build.sh` now emits a renamed copy and the page hides the installed one.
And `__sweepTest` looked like a regression until it was made to report elapsed time —
8590 ms for a nominally 540 ms sweep, because a backgrounded tab clamps `setTimeout`.
See `lessons.md`.

82 assertions pass. Version 1.4.0.

## Round 6 — Chrome Web Store best practices

- [x] Audit against developer.chrome.com/docs/webstore/best-practices
- [x] **Blocker found:** `description` was 169 characters against a 132 limit — rewritten to 120
- [x] `short_name` added
- [x] First-run onboarding: options page opens once on install, with a "How it works" section
- [x] `PRIVACY.md` (no data collected, no network requests)
- [x] `docs/store-listing.md` — listing copy, permission justifications, privacy answers, asset checklist
- [x] 14 new assertions guarding the mechanical store constraints + 2 for first-run behaviour

### Review

Already compliant before this round: MV3, no remote code, no `eval`, no inline scripts,
no `innerHTML`, no `unload` handlers (so pages keep their back/forward cache), minimal
permissions with `tabs` deliberately not requested, and no `web_accessible_resources`.

The one real blocker was the manifest description at 169 characters. The store caps it
at 132 and shows it both in the listing and on `chrome://extensions`, so it would have
been truncated mid-sentence. There is now a test for it.

Left for the user because they cannot be produced from here: screenshots, the 440×280
promo tile, a hosted privacy-policy URL, `homepage_url`, and a verified developer
account. `<all_urls>` remains the main review risk; the justification in
`docs/store-listing.md` is written to address it directly, with optional host
permissions named as the fallback if review pushes back.

96 assertions pass. Version 1.5.0.

## Round 7 — an animated demo in the onboarding

- [x] Extract the icon set to `src/icons.js`, shared by the content script and options page
- [x] CSS-drawn looping demo in the options page: settle → grip → bar, anchored to the link
- [x] `prefers-reduced-motion` holds the final frame as a still
- [x] Drift guards: every action has an icon, load order asserted in both places
- [x] Verified by headless screenshots at three points in the loop

### Review

A GIF was the obvious reading of "animated image", but it is the wrong asset here: a
binary blob in the package, fixed resolution, one colour scheme, and stale the moment
the menu changes. The demo is CSS instead — a few hundred bytes, crisp at any DPI,
theme-aware, and it draws the *real* icons, imported from the same module the menu uses.
`prefers-reduced-motion` collapses it to the static image, which is the fallback the
request asked for anyway.

Positioning is anchored to the link element (`left: calc(100% + 3px)`) rather than to
pixel offsets, so nothing drifts when the font renders differently.

Two things the rendering caught, both in `lessons.md`: a lone `background` keyframe
animates across the *whole* loop (the grip was a coloured blob for four seconds), and
compositor-only animations don't advance under `--virtual-time-budget`, which made the
action bar look broken in headless captures until `--disable-threaded-animation`.

Not verified: the content script's own hover path after the icon move. The Chrome
extension bridge dropped mid-round and the headless harness reports every probe false
even when the page is visible and focused, so it says nothing either way. The icon
module itself *is* verified in a real render — the options demo builds all seven icons
through the same `svgIcon` — and the load order is asserted in tests, but a hover on a
real page is still worth a glance.

100 assertions pass. Version 1.6.0.

## Round 8 — Copy clean link

- [x] `tools/build-clean-list.js` — regenerates `src/clean-list.js` from Brave's published rules
- [x] `src/clean.js` — match-pattern compiler + parameter removal, worker-side only
- [x] `copyClean` action, icon, and a hover preview of how many trackers will come off
- [x] 23 assertions covering the cleaning rules, including what must *not* be touched

### Review

Brave does this in two passes and so does HyLink: the click identifiers its navigation
filter strips (`fbclid`, `msclkid`, `mc_eid`…) plus the site-scoped rules in
`clean-urls.json`. The second list omits the first, because Brave applies both to a
copied link — bundling only the JSON would have missed `fbclid`, which is the one
everybody expects.

The rule list is 18 kB, so it lives in the service worker and the page asks for a
cleaned URL over a message. To keep the clipboard write inside the click's user
activation, the request goes out when the pointer *reaches* the button, not when it is
clicked — which also lets the caption say "Copy without 3 trackers" before you commit.

Two deliberate restraints: nothing but `http`/`https` is touched, and a URL with
nothing to remove is returned byte-for-byte rather than round-tripped through the URL
parser, so copying never silently re-encodes a link.

`src/clean-list.js` is a verbatim copy of Brave's list and carries their MPL-2.0, noted
in its header and in `docs/store-listing.md`. Nothing is fetched at runtime; refreshing
the list is a deliberate `node tools/build-clean-list.js`.

Verified against real URLs — NYT (3 removed), x.com `s`/`t` (2), Instagram `igsh` (1),
Google `ei`/`ved` (3), YouTube `si` kept `t=43` (1), Wikipedia untouched.

Verified in a real browser end to end: hovering the button captioned "Copy without 2
trackers", and clicking it wrote `https://example.com/article?id=7` to the clipboard —
`utm_source` and `fbclid` gone, `id=7` kept. Harness case 5 covers this.

123 assertions pass. Version 1.7.0.

## Round 9 — published, with a demo and a brew install

- [x] Public repo at github.com/abhijitgore/hylink, MIT, Brave's list noted in NOTICE.md
- [x] README: motivation, an honest caveat about "open in side", install at the top
- [x] Animated demo GIF in both colour schemes, generated from the shipped animation
- [x] Homebrew tap at github.com/abhijitgore/homebrew-tap, verified by installing it

### Review

The GIF is the options page's own CSS animation captured headlessly, not a separate
recording, so it cannot drift from what ships — `tools/build-demo-gif.sh` plus
`tools/assemble-gif.py` regenerate both themes. GitHub's `<picture>` swaps them with
the reader's theme. 32 frames, ~200 kB each after Pillow merges the still stretches
and keeps their durations.

Homebrew cannot install a Chrome extension outright — Chrome refuses to enable
anything that did not come from its own store — so the cask stages the files to a
*stable* path (`~/Library/Application Support/HyLink`) using an `artifact ... target:`
stanza rather than the default versioned Caskroom directory. That way "Load unpacked"
stays valid across upgrades instead of breaking on every new version. Verified by
actually running `brew install --cask abhijitgore/tap/hylink`: tapped, downloaded,
moved into place, manifest reads 1.7.1.

## Round 10 — ten languages

- [x] `_locales/` for en, es, pt_BR, ru, hi, fr, de, ja, id, tr (65 strings each)
- [x] `ui/i18n.js` fills the pages; English stays inline as the fallback
- [x] `t()` / `actionLabel()` in settings.js, used by the content script and worker
- [x] 37 assertions: key parity, placeholder parity, and inline-English-vs-catalogue drift

### Review

Locales chosen from a coverage estimate (see the chat notes): weighted for *desktop*
Chrome users, since extensions do not run on mobile, these ten reach roughly 75% of the
addressable market. `zh_CN` was dropped — mainland China cannot reach the Web Store, so
it scored below `id` and `tr`.

Only UI strings are localised. The manifest name and description stay English: they are
store-listing copy, translated in the developer dashboard, and the user asked
explicitly not to add store strings here.

Two design points worth keeping: the English text stays inline in the HTML rather than
being blanked and filled, so a broken catalogue degrades to English instead of an empty
page — and a test ties the inline copy to `_locales/en` so the two cannot drift. The
demo's middle line wraps a link, so it uses a `$link$` placeholder and rebuilds the two
halves around the existing element, which lets translators move the words.

Verified by rendering the options page headlessly against the real catalogues for de,
ja and tr — including the rebuilt demo line and the localised action-bar caption.

159 assertions pass. Version 1.8.0.
