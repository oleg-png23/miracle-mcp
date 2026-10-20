# Miracle website

Self-contained, buildless marketing website for the Miracle MCP browser extension.

Serve this directory with a static web server or publish its contents using GitHub Pages. All fonts, images, and scripts are local; no installation or build step is required. The download and setup links point to the public project and its latest release.

For a local preview from the repository root:

```sh
python -m http.server 19739 --bind 127.0.0.1 --directory website
```

Then open http://127.0.0.1:19739. Wallpaper selection is stored only in this browser. No analytics, online fonts, or service requests are made by this website.

The workspace preview is illustrative, rather than a live connection to Roblox Studio. The page works without JavaScript; the landscape picker, copy button, and automatic copyright year are progressive enhancements. Native FAQ disclosures work without scripts. The navigation and main workspace preview use bounded, cached lens maps for real backdrop refraction in Chromium, with CSS fallback and respect for reduced transparency. No optical work runs continuously while idle.

The landing page has its own pill theme and all-screen motion controller. Scroll entrances, the service strip and ambient hero effects also run on touch devices. Pointer tilt is limited to non-optical cards; glass containers stay stationary. Pause motion, reduced motion and hidden/offscreen state stop the effects. The setup section explains the two-folder ZIP and links to INSTALL.md.

Scroll entrances are prepared before a block reaches the screen and run once with a short translation and fade. Touch and narrow layouts have no entrance stagger or overshoot. Touch press feedback waits for a completed tap; native swipes cancel it. Ambient effects pause offscreen without resetting their timelines. Scroll navigation caches section geometry until layout changes and updates only the progress indicator, avoiding page-wide inherited style changes on every scroll frame.

Font license: `assets/fonts/OFL-Inter.txt`. Landscape sources: `assets/bg/PHOTO-SOURCES.md`. Source code follows the root project's MIT license.

## Interactive app previews

Open `preview/welcome.html` or `preview/dashboard.html` to explore the real app interface with clearly labeled sample data. The demo transport never contacts a bridge, reads extension storage, or executes Studio tools. Appearance settings and editor drafts use separate preview storage keys.

After changing the runtime UI or demo client, regenerate the published pages:

```sh
python scripts/build-site-preview.py
```

This copies only active wallpapers, styles, fonts, icons and required scripts into `website/preview/`, then synchronizes `website/` to `docs/` for GitHub Pages. The release builder runs it automatically.
