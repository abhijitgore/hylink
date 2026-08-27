# Chrome Web Store submission

Everything the dashboard asks for, ready to paste. Checked against the Web Store
[best practices](https://developer.chrome.com/docs/webstore/best-practices),
[listing requirements](https://developer.chrome.com/docs/webstore/program-policies/listing-requirements)
and [image specs](https://developer.chrome.com/docs/webstore/images).

## Single purpose

> HyLink shows a small menu beside the link under the mouse, with ways to open that
> link — in the current tab, a new tab, a new window, incognito, or side by side or
> stacked with the current page — or to copy it, with or without tracking parameters.
> Links it opens have tracking parameters removed by default; that can be switched off
> in the options.

Everything in the extension serves that one purpose. No second feature, no account, no
network access.

## Store listing copy

**Name:** HyLink — Hover Link Menu
**Summary** (the manifest `description`, 131 of the allowed 132 characters):

> Every link you copy is mostly tracking garbage. Hover a link: clean copy, new tab,
> window, incognito, split screen. No right-click.

**Category:** Workflow & Planning
**Language:** English

**Detailed description:**

> You know how the links you copy are mostly tracking garbage? HyLink fixes that —
> hover a link, one click, clean copy. It also does new tab, new window, incognito and
> split screen without a right-click. Free, and it phones home to no one.
>
> Hover the mouse over a link to reveal a small three-dot menu beside it. Move the
> cursor onto the menu and it expands into eight ways to interact with that link: open
> it in the current tab, a new tab, a new window, or incognito; open it side by side or
> stacked with the current page; copy the link; or copy a clean link with the tracking
> parameters removed, the way Brave does it.
>
> Links you open are cleaned by default — a link you are following has no use for the
> campaign tag that came with it — and you can switch that off in the options. The copy
> buttons never change: "Copy link address" hands over the link exactly as it is, and
> "Copy clean link" is the one that strips it.
>
> Designed to stay out of your way while you read:
>
> • You need to hover the mouse over the link to activate it. Moving across text while
>   reading won't trigger anything.
> • It's only shown for links in paragraphs and body text. It is not shown for
>   elements like navigation bars, headers, footers and sidebars.
> • What appears first is just three dots, about one character wide. The full menu
>   only opens when you move the cursor onto them.
> • Press Esc, scroll, or move the mouse away to dismiss it.
> • It moves out of the way of hover cards like Wikipedia's link previews instead of
>   covering them.
>
> Everything is configurable: the hover delay, which actions appear and in what order,
> whether links you open get cleaned, whether a modifier key must be held, and a
> per-site off switch in the toolbar popup.
>
> About the "read and change all your data on all websites" warning: Chrome shows
> that to every extension that runs on every site, and links exist on every page, so
> a hover menu has no narrower permission to ask for. What HyLink reads is the address
> of the link under your pointer, and the tag and class names around it so it can tell
> a nav bar from an article. It never reads page text, form fields, passwords, cookies
> or history.
>
> HyLink makes no network requests and has no analytics, no account, and no server.
> Your settings sync through your own Chrome profile, and nothing else leaves your
> browser.

## Privacy tab

**Does this extension collect user data?** No.

Tick nothing in the data-types list. HyLink reads the hovered link's URL to act on it
and stores settings in `chrome.storage.sync`. Neither is transmitted anywhere, so
neither counts as collection.

**Certifications** — all three apply:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://github.com/abhijitgore/hylink/blob/main/PRIVACY.md

## Permission justifications

Paste each into the matching box. Broad host access gets the most review scrutiny, so
the `<all_urls>` one matters most.

| Field | Justification |
| --- | --- |
| `storage` | Saves the user's settings — hover delay, which actions appear, per-site off switches. No browsing data is stored. |
| `system.display` | The "open in side" actions place two windows side by side on the current display. The display's work area is needed to size them so neither lands under the taskbar or off-screen. |
| `activeTab` | The toolbar popup shows the current site's hostname and offers a "turn off on this site" switch. Used instead of the broader `tabs` permission, which would expose browsing history. |
| Host permission (`<all_urls>`) | The extension's only feature is a menu beside a hovered link, and links exist on every site, so the content script has to run everywhere. It reads only the `href` of the hovered link and the page geometry needed to place the menu clear of hover cards. No network requests; no data leaves the device. |
| Remote code | No. All JavaScript ships in the package; nothing is fetched or evaluated at runtime. |

## Images to produce

`node tools/build-store-shots.js` builds these into `docs/store/`.

| Asset | Size | Status |
| --- | --- | --- |
| Store icon | 128×128 PNG | ✅ `docs/store/store-icon-128.png` — 96×96 of artwork with 16px transparent padding, which is what the store asks for. `icons/icon128.png` fills its box instead, which is right for the toolbar and wrong here. |
| Action bar on an article | 1280×800 | ✅ `docs/store/screenshot-1-actions.png` |
| The grip on an article | 1280×800 | ✅ `docs/store/screenshot-2-grip.png` |
| Settings page | 1280×800 | ✅ `docs/store/screenshot-3-settings.png` |
| Small promo tile | 440×280 | ✅ `docs/store/promo-440x280.png` |
| Marquee | 1400×560 | Optional; only needed for featured placement |

Upload order matters — the first screenshot is what most people judge the extension on,
so lead with the expanded action bar, then the grip on its own, then the settings page.

### Two things the script has to work around

**Chrome no longer accepts `--load-extension`.** It was deprecated in 137 and by 151 is
ignored outright, headless and headed alike; `--enable-unsafe-extension-debugging` does
not bring it back. The replacement is the DevTools command `Extensions.loadUnpacked`,
which is gated on `--remote-debugging-pipe` rather than `--remote-debugging-port` — so
the script talks to Chrome over the pipe on fd 3/4 instead of a WebSocket.

**The capture cannot be headless.** A headless page reports `visibilityState: "hidden"`
and never composites the top layer. The menu is a popover, so it gets built in the DOM
exactly as it should be and then photographs as nothing at all — the page looks
untouched. The script therefore drives a real window, which appears for about fifteen
seconds while it runs. It also reuses that window's one tab rather than opening new
ones: a tab created over CDP starts backgrounded, and a backgrounded page has its timers
clamped to roughly a second, which is slower than the hover being captured.

The article at `tools/shots/article.html` is written for this. Using a real news site
would put someone else's masthead and copy in the listing images.

Everything is rendered at 2× and resampled to 1280×800, because rendering straight at
1280×800 gives thin, undersampled text.

## Pre-submission checklist

- [x] Manifest V3
- [x] `description` within 132 characters
- [x] `short_name` set (≤12 characters)
- [x] Icons at 16/32/48/128
- [x] No remote code, no `eval`, no inline scripts, no `innerHTML`
- [x] No `unload`/`beforeunload` handlers, so pages stay eligible for the back/forward cache
- [x] Permissions minimised — `tabs` deliberately not requested
- [x] First-run onboarding (options page opens once on install)
- [x] Automated tests (`node tests/run.js`)
- [x] `homepage_url` in the manifest — https://github.com/abhijitgore/hylink
- [x] Privacy policy hosted at a public URL
- [x] Privacy policy contact address published (in `PRIVACY.md`, written unharvestably)
- [x] Screenshots and the 440×280 tile (`node tools/build-store-shots.js`)
- [ ] Developer account verified, with a published contact email
- [ ] Trader / non-trader declared in the dashboard — non-trader, for a free extension
      with no commercial activity. The EU's Digital Services Act made this mandatory;
      declaring trader would require publishing a physical address.
- [ ] `dist/hylink-<version>.zip` built with `sh tools/package.sh`

## Known review risks

**Broad host access.** `<all_urls>` cannot be avoided for a hover menu that works on
any site, but it is the single biggest reason a review takes longer. The justification
above is written to be specific about what is read and what is not. If review pushes
back, the fallback is `optional_host_permissions` plus `chrome.scripting`, activating
per site on request — a noticeably worse experience, but an available concession.

**A bundled third-party list.** `src/clean-list.js` is a verbatim copy of Brave's
URL-cleaning rules and carries their Mozilla Public License 2.0, marked in the file's
header. It is data, not remote code — nothing is fetched at runtime — but the licence
belongs in whatever notice the listing or repo carries.

**Listing not translated.** The extension UI ships in ten languages (`_locales/`), but
the manifest's name and description stay English on purpose and the store listing has
no translations yet — those are entered per-language in the developer dashboard. Not a
policy problem, just a reach limit on discovery.
