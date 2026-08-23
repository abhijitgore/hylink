# Releasing

Three things have to move together:

- **abhijitgore/hylink** — the extension. `manifest.json`'s `version` is the source of truth.
- **abhijitgore/homebrew-tap** — `Casks/hylink.rb`, which pins a `version` and a `sha256`
  of the release tarball.
- **The Chrome Web Store** — which only ever sees the zip you upload, not the tag.

**Nothing fails loudly if they drift.** A stale cask keeps installing the old version,
quietly, while the README promises otherwise. A zip built before the last commit ships
old code under a new version number, and the store will not notice — it happened once:
a 1.8.0 zip sat in `dist/` while fourteen of its files changed underneath it. So the
release is not finished until steps 6 and 7 are both done.

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

7. **Build the store zip** — after the tag, never before:

   ```sh
   sh tools/package.sh                      # dist/hylink-X.Y.Z.zip
   unzip -p dist/hylink-X.Y.Z.zip manifest.json | grep '"version"'
   ```

   The second line is the check that matters: the version inside the zip must be the
   one you just tagged. `dist/` is ignored by git and the script deletes any older zip
   of the same version, but it does not delete other versions — remove stale ones so
   there is only one file to upload. Then upload it in the Web Store dashboard. If the
   store already has this version number, it will refuse the upload; bump and repeat
   from step 1 rather than rebuilding under the same number.

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

`docs/store-listing.md` holds the listing copy, the permission justifications, the
privacy answers, and the outstanding items.

The zip (step 7) is an allow-list of `manifest.json`, `LICENSE`, `icons`, `src`, `ui`
and `_locales` — a new top-level directory has to be added to `tools/package.sh` on
purpose rather than shipping because nobody remembered to exclude it.

The listing images are separate from the zip and only need rebuilding when the UI they
show has changed — the options page, the menu, or any visible string:

```sh
node tools/build-store-shots.js  # docs/store/*.png
```

It opens a real Chrome window for about fifteen seconds; that is expected. It fails
loudly if the menu never appears rather than saving a screenshot of a plain page.
