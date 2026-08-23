# Chrome Web Store submission

Everything the dashboard asks for, ready to paste. Checked against the Web Store
[best practices](https://developer.chrome.com/docs/webstore/best-practices),
[listing requirements](https://developer.chrome.com/docs/webstore/program-policies/listing-requirements)
and [image specs](https://developer.chrome.com/docs/webstore/images).

## Single purpose

> HyLink shows a small menu beside the hyperlink under your pointer, with ways to open
> that link — in the current tab, a new tab, a new window, incognito, or a tiled side or
> stacked window — or to copy its address, with or without tracking parameters.

Everything in the extension serves that one purpose. There is no second feature, no
account, and no network access.

## Store listing copy

**Name:** HyLink — Hover Link Menu
**Summary** (the manifest `description`, 120 of the allowed 132 characters):

> Hover a link in a page's text for a quiet menu: open it in a tab, window, incognito,
> or a tiled side window, or copy it.

**Category:** Workflow & Planning
**Language:** English

**Detailed description:**

> Rest the pointer on a link and three dots appear beside it. Move onto them and they
> open into a row of actions: open the link here, in a new tab, in a new window, in
> incognito, side by side, stacked, copy its address, or copy it clean — with the
> tracking parameters stripped out, the way Brave's "copy clean link" does.
>
> Built to stay out of the way while you read:
>
> • The pointer has to settle. Sweeping across text while reading triggers nothing.
> • Links in navigation bars, headers, footers and sidebars are skipped — the menu is
>   for links in the page's text.
> • What you first see is three dots about one character wide, not a toolbar. The full
>   menu only opens if you move onto them.
> • Scrolling dismisses it. So does Esc, or moving away.
> • It steps around Wikipedia-style hover cards instead of fighting them for the top
>   of the page.
>
> Everything is adjustable: the delay, which actions appear, whether a modifier key is
> required, and a per-site off switch in the toolbar popup.
>
> HyLink makes no network requests. It has no analytics, no account, and no server.
> Your settings sync through your own Chrome profile and nothing else leaves your
> browser.

## Privacy tab

**Does this extension collect user data?** No.

Tick nothing in the data-types list. HyLink reads the hovered link's URL to act on it
and stores your settings in `chrome.storage.sync`; neither is transmitted anywhere, so
neither counts as collection.

**Certifications** — all three apply:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://github.com/abhijitgore/hylink/blob/main/PRIVACY.md

## Permission justifications

Paste each into the matching box. Broad host access always draws review scrutiny, so
the last one matters most.

| Field | Justification |
| --- | --- |
| `storage` | Saves the user's own settings — hover delay, which actions appear, per-site off switches. No browsing data is stored. |
| `system.display` | The "open in side" actions tile two windows across the display the current window is on. The display's work area is needed to size the halves correctly, so the tiles do not land under the taskbar or off-screen. |
| `clipboardWrite` | The "Copy link address" and "Copy clean link" actions write the link's URL to the clipboard. |
| `activeTab` | The toolbar popup shows the current site's hostname and offers a "turn off on this site" switch. `activeTab` is used deliberately in place of the broader `tabs` permission, which would expose the user's browsing history. |
| Host permission (`<all_urls>`) | The extension's only feature is a menu that appears next to a hyperlink, and links exist on every site, so the content script must run everywhere. It reads only the `href` of the link under the pointer plus the page geometry needed to place the menu clear of hover cards. It makes no network requests and sends no data off the device. |
| Remote code | No. All JavaScript is contained in the package; nothing is fetched or evaluated at runtime. |

## Images to produce

`node tools/build-store-shots.js` builds these into `docs/store/`.

| Asset | Size | Status |
| --- | --- | --- |
| Store icon | 128×128 PNG | ✅ `icons/icon128.png` |
| Action bar on an article | 1280×800 | ✅ `docs/store/screenshot-1-actions.png` |
| Resting grip on an article | 1280×800 | ✅ `docs/store/screenshot-2-grip.png` |
| Settings page | 1280×800 | ✅ `docs/store/screenshot-3-settings.png` |
| Small promo tile | 440×280 | ✅ `docs/store/promo-440x280.png` |
| Marquee | 1400×560 | Optional; only needed for featured placement |

Upload order matters — the first screenshot is what most people judge the extension on,
so lead with the expanded action bar, then the resting grip, then the settings page.

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
- [x] Privacy policy contact address published (`abhigore+hylink@gmail.com`)
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
