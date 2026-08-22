# Releasing

Two repos have to move together:

- **abhijitgore/hylink** — the extension. `manifest.json`'s `version` is the source of truth.
- **abhijitgore/homebrew-tap** — `Casks/hylink.rb`, which pins a `version` and a `sha256`
  of the release tarball.

**Nothing fails loudly if they drift.** A stale cask keeps installing the old version,
quietly, while the README promises otherwise. So the release is not finished until step
6 is pushed.

## Steps

1. **Bump** `version` in `manifest.json` (and `homepage_url` if the repo ever moves).
2. **Check** — `node tests/run.js`. It also guards the Web Store constraints: the
   132-character description limit, icon sizes, the permission set, no remote code.
3. **Commit and tag:**

   ```sh
   git commit -am "HyLink X.Y.Z"
   git tag -a vX.Y.Z -m "HyLink X.Y.Z"
   git push origin main --tags
   ```

4. **Release** — `gh release create vX.Y.Z --title "HyLink X.Y.Z" --notes "…"`.
   GitHub builds the source tarball; the cask points at it.
5. **Hash it:**

   ```sh
   curl -sL -o /tmp/hylink.tgz \
     https://github.com/abhijitgore/hylink/archive/refs/tags/vX.Y.Z.tar.gz
   shasum -a 256 /tmp/hylink.tgz
   ```

6. **Bump the cask** in the tap repo — `version` and `sha256` in `Casks/hylink.rb` —
   then commit and push.

   Leave the rest of that file alone. In particular the
   `artifact "hylink-#{version}", target: "~/Library/Application Support/HyLink"`
   stanza is what keeps the install path stable across upgrades; without it every
   upgrade lands in a new versioned directory and Chrome's "Load unpacked" pointer
   breaks. The caveats block explains the one-time load, which Chrome requires because
   it will not enable an extension that did not come from its own store.

## Checking the cask

```sh
brew install --cask abhijitgore/tap/hylink   # tap, download, install
ls ~/Library/Application\ Support/HyLink     # files landed at the stable path
brew uninstall --cask hylink
brew untap abhijitgore/tap
```

Uninstall and untap afterwards: HyLink is normally loaded unpacked from a clone of this
repo, and two copies loaded at once means two menus on every link.

## If the demo animation changed

`docs/demo-light.gif` and `docs/demo-dark.gif` are captures of the options page's own
animation, so a UI change makes them stale. Regenerate with:

```sh
python3 -m venv /tmp/gifenv && /tmp/gifenv/bin/pip install pillow
PYTHON=/tmp/gifenv/bin/python sh tools/build-demo-gif.sh
```

## Chrome Web Store

Not submitted yet. `docs/store-listing.md` holds the listing copy, the permission
justifications, the privacy answers, and what is still outstanding — screenshots, the
440×280 tile, and the contact address in `PRIVACY.md`.
