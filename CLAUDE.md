# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

HyLink is a Chrome MV3 extension: hovering a link in a page's body text shows a small
menu of ways to open or copy it. See `README.md` for what it does from a user's side.

## Commands

There is no build step and no dependencies. Files are loaded as-is by Chrome, and the
test suite runs on a bare Node.

```sh
node tests/run.js                # the whole suite (195 assertions), exit 1 on failure
sh tests/harness/build.sh        # required before using the manual browser harness
node tools/build-clean-list.js   # regenerate src/clean-list.js from Brave's rules
sh tools/package.sh              # dist/hylink-<version>.zip — the Web Store upload
node tools/build-store-shots.js  # docs/store/*.png — the listing images
node tools/build-readme-icons.js # docs/icons/*.svg — the README's icon column
```

**There is no way to run a single test.** `tests/run.js` has no filter flag; every suite
runs every time. It is fast and dependency-free, so the practical move is to run it all
and grep the output for a suite name (`describe('window tiling geometry')` and friends).

**Loading it in Chrome:** `chrome://extensions` → Developer mode → Load unpacked → the
repo root. After pressing **Reload** there, also reload any open tabs — content scripts
only attach at page load, so an un-reloaded tab keeps running the previous code and will
happily make a change look like it did nothing.

The manual harness at `tests/harness/` covers what a unit test cannot: hover timing,
top-layer rendering, dodging hover cards, and the navigation denylist. It loads a
generated `content.harness.js` (gitignored) in which the custom element is renamed, so
the installed extension's menu can be told apart from the one under test — rerun
`build.sh` after touching `src/content.js` or the harness measures stale code.

## Architecture

### Classic scripts on `self`, not ES modules

Every file in `src/` is an IIFE that hangs an object off `self` — `self.HyLinkSettings`,
`self.HyLinkIcons`, `self.HyLinkClean`, `self.HyLinkTiling` — and consumers destructure
from it. This is deliberate and load-bearing: the same file has to work in three
different loaders. `src/settings.js` and `src/icons.js` are listed in the manifest's
content-script `js` array, pulled into extension pages with `<script src>`, *and*
`importScripts()`-ed by the service worker. Declaring the worker as a module would make
`importScripts` unavailable, so nothing here is a module.

The consequence lands on the tests: they load each file into a `vm` context with a
stubbed `chrome` and a fake `importScripts`, which is what `loadPlain`, `loadWorker` and
`loadSettingsWith` in `tests/run.js` exist for. The header comment there records the trap
— a bare vm context has no `URL`, so `new URL()` throws, which silently turns the URL
scheme guard into "rejects everything" and makes rejection tests pass for the wrong
reason. Hand the sandbox the real globals the code uses.

### The privilege split

The content script never touches `chrome.tabs` or `chrome.windows`. It posts
`{ type: 'hylink/action', action, url }` or `{ type: 'hylink/clean', url }` to the
service worker, which re-validates the scheme through `assertSafe()` before calling any
privileged API — the page is untrusted input, so the check happens on the worker's side
of the boundary rather than being taken on trust from the sender.

Cleaning also lives in the worker for a second reason: the rule list is several hundred
entries, and keeping it there means it is never injected into every page you visit.

`activeTab` is used instead of `tabs` on purpose. `tabs` would add a "read your browsing
history" install warning for no functional gain — do not reach for it.

### The menu is a closed shadow root in the top layer

`src/content.js` appends a `<hylink-root>` host to `documentElement` and attaches a
**closed** shadow root; the menu inside is a Popover, so page overlays cannot cover it.
Two things follow. Nothing outside the content script can inspect the menu — automation
can only detect the host element's presence, which is what `tools/build-store-shots.js`
polls for. And the menu actively steps out of the way of hover cards by hit-testing six
candidate positions around the link, rechecking when an overlay shows up *after* the menu
(Wikipedia's arrives ~100 ms late).

### English lives in two places, on purpose

Every user-visible string exists both inline in `ui/*.html` and in
`_locales/en/messages.json`. `ui/i18n.js` overwrites the inline copy at runtime from the
catalogue; the inline text is the fallback that keeps the page readable if that never
runs. **Changing a UI string therefore means changing the HTML and all ten catalogues.**
Tests enforce this: inline English must match `en`, and every locale must carry exactly
`en`'s keys and preserve its `$placeholders$`. Chrome's i18n has no plural rules, so
count-dependent messages need separate one/many keys.

The manifest's `name` and `description` stay English deliberately — they are store copy,
translated in the Web Store dashboard rather than from `_locales/`.

### Generated and third-party files

`src/clean-list.js` is **generated** — regenerate it with `tools/build-clean-list.js`
rather than editing by hand. It is a verbatim copy of Brave's rules and carries their
**MPL-2.0** (see `NOTICE.md`); everything else in the repo is MIT.

`docs/icons/*.svg` are generated from `src/icons.js` by `tools/build-readme-icons.js`,
so the README's action table shows the menu's real icons rather than emoji standing in
for them. A test fails if they fall behind the icon set. They are not shipped — `docs/`
is not in `tools/package.sh`'s allow-list.

`icons/*.png` are generated too, from `tools/icons/icon.svg` via `sh tools/icons/build.sh`
— edit the SVG, not the PNGs. The same script emits `docs/store/store-icon-128.png`,
which is deliberately *not* the same image: toolbar icons fill their box, while the Web
Store wants 96×96 of artwork inside a 128×128 canvas.

## Constraints worth knowing before you change things

- **The Web Store constraints are tested, not just documented.** `tests/run.js` fails the
  build on a `description` over 132 characters, a changed permission set, missing icon
  sizes, remote code, inline scripts, `unload` handlers, or a harvestable email address
  appearing in any Markdown file.
- **`chrome.tabs.splitViewId` is read-only.** No extension API can create a Chrome split
  view ([w3c/webextensions#967](https://github.com/w3c/webextensions/issues/967) is still
  open), so the "open in side" actions reuse an existing split view if there is one and
  otherwise tile two real windows. Do not describe this as a real split view.
- **`--load-extension` no longer works.** Chrome deprecated it in 137 and ignores it
  outright by 151, headed and headless alike. `tools/build-store-shots.js` uses the
  `Extensions.loadUnpacked` CDP command instead, which is gated on
  `--remote-debugging-pipe` rather than a port — and it must drive a *headed* window,
  because a headless page reports `visibilityState: "hidden"` and never composites the
  top layer, so the menu photographs as nothing at all.
- **A release moves three things together** — the repo, the Homebrew cask, and the Web
  Store zip — and nothing fails loudly when they drift. Follow `RELEASING.md`; it exists
  because a stale zip shipped once already.
- `tasks/lessons.md` records mistakes made in this repo and how to avoid repeating them.
  Worth reading before non-trivial work.
