# HyLink privacy policy

_Last updated: 22 August 2026_

**HyLink does not collect, transmit, or sell any data.**

## What HyLink handles, and where it stays

| Data | Why | Where it goes |
| --- | --- | --- |
| The URL of the link you hover | To show the menu and to carry out the action you pick | Stays in your browser. It is passed from the page to HyLink's own service worker and handed to Chrome's tab/window APIs, or to your clipboard if you pick **Copy link address**. It is never written to disk and never sent anywhere. |
| Your settings (delay, which actions appear, disabled sites) | To remember how you like the menu to behave | `chrome.storage.sync`, which syncs through your own Chrome profile. Google's sync carries it between your signed-in devices; HyLink has no server and no access to it outside your browser. |

**Copy clean link** strips tracking parameters using a list bundled inside the
extension. The URL is examined on your machine and nothing about it is sent anywhere.

## What HyLink does not do

- No analytics, telemetry, crash reporting, or usage statistics.
- No network requests of any kind. The extension contains no remote code and loads
  nothing from outside the installed package.
- No reading, storing, or transmitting of page content, form data, credentials,
  cookies, or browsing history.
- No accounts, no sign-in, no advertising, no third-party services.

HyLink's content script runs on every site because the menu has to be able to appear
next to a link on any page you visit. It reads only the `href` of the link under your
pointer, plus enough page geometry to place the menu where it will not cover a hover
card. Nothing it reads leaves your machine.

## Permissions

| Permission | Used for |
| --- | --- |
| `storage` | Saving your settings. |
| `system.display` | The work area of the display your window is on, so the tiled "open in side" actions can size the two halves correctly. |
| `clipboardWrite` | The **Copy link address** and **Copy clean link** actions. |
| `activeTab` | The toolbar popup shows the current site's hostname and offers a per-site off switch. This is deliberately used instead of the broader `tabs` permission, which would expose your browsing history. |
| Access to all sites | Injecting the content script that shows the menu. |

## Contact

Questions about this policy: <abhigore+hylink@gmail.com>. Bugs and feature requests are
better filed as [issues](https://github.com/abhijitgore/hylink/issues), where the
conversation stays public and searchable.
