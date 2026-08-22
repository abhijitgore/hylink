# Hover harness

The unit suite (`node tests/run.js`) covers everything reachable without a DOM.
This page covers what isn't: hover timing, top-layer rendering, and overlay-aware
placement.

```
python3 -m http.server 8000 --directory .    # from the repo root
open http://localhost:8000/tests/harness/
```

**Turn HyLink off for `localhost` in its toolbar popup first.** The installed
extension injects into this page as well, and you would be looking at two menus
drawn on top of each other.

What to check:

| Case | Expected |
| --- | --- |
| Sweep across any link without stopping | Nothing appears. The delay restarts on every few px of movement. |
| 1 — rest on the plain link | A small translucent grip appears just past the end of the link. |
| 1 — move onto the grip | It expands into the full action bar, growing out of the grip so it stays under the pointer. |
| 1 — move away | Grip goes in ~160 ms, expanded bar in ~260 ms. |
| 2 — link with a hover card | Card drops in after the menu; the expanded bar places itself **clear** of the card. |
| 3 — link near the viewport bottom | Bar flips above when there isn't room below. |
| Scroll while showing | Menu closes — scrolling means reading, not clicking. |

Two of these are the regressions that matter:

- **The sweep.** Without the rest gate, a grip flickers under every link you pass
  while reading. `window.__sweepTest('#case1 a')` in the console automates it: it
  returns `{whileMoving: 0, afterSettling: 1}`.
- **Case 2.** It exercises the `MutationObserver` + delayed recheck, and the
  hit-test scan that has to walk past zero-size injected roots (other extensions
  leave these lying around) to find the card behind them.

## Build step

Run `./build.sh` after editing `src/content.js`. It writes `content.harness.js`, a
copy whose custom element is renamed `<hylink-harness-root>`. The installed extension
injects into this page too; the rename is what lets the probes count only the copy
under test, and the page hides any `<hylink-root>` the installed one creates.

## Probes

- `__hoverProbe(selector, { alt })` — hover, settle, report whether a menu appeared.
  Case 4's nav bar and `.left-rail` should report `false`, the prose links `true`,
  and a nav link with `{ alt: true }` `true`.
- `__sweepTest(selector)` — the rest gate. Check the `elapsed` it returns: a
  backgrounded tab clamps `setTimeout` to ~1 s, which stretches the sweep well past
  the hover delay and makes a working rest gate look broken. Only a run whose
  `elapsed` is near 540 ms says anything.

## Headless

`?probe` writes the probe results into `document.title`, so a headless run can read
them with `--dump-dom`:

```
chrome --headless --virtual-time-budget=20000 --dump-dom \
  'http://localhost:8741/tests/harness/index.html?probe'
```

Note that headless currently reports `false` for **every** case, including the ones
that should be true, even though the page reports itself visible and focused — the
menu never opens there. Treat headless as a smoke test for load errors, not as a
verdict on hover behaviour; use a real browser for that.

The options page's demo animation, on the other hand, does render headlessly:

```
chrome --headless --disable-threaded-animation --window-size=700,400 \
  --virtual-time-budget=5000 --screenshot=frame.png \
  'http://localhost:8741/ui/options.html'
```

`--disable-threaded-animation` is required: animations that only touch `opacity` and
`transform` run on the compositor, which does not advance under `--virtual-time-budget`,
so without it the action bar never appears in the capture.
