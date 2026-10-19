# Miracle website

Self-contained, buildless marketing website for the Miracle MCP browser extension.

Serve this directory with a static web server or publish its contents using GitHub Pages. All fonts, images, and scripts are local; no installation or build step is required. The download and setup links point to the public project and its latest release.

For a local preview from the repository root:

```sh
python -m http.server 19739 --bind 127.0.0.1 --directory website
```

Then open http://127.0.0.1:19739. Wallpaper selection is stored only in this browser. No analytics, online fonts, or service requests are made by this website.

The workspace preview is illustrative, rather than a live connection to Roblox Studio. The page works without JavaScript; the landscape picker, copy button, and automatic copyright year are progressive enhancements. Native FAQ disclosures work without scripts. The navigation and main workspace preview use bounded, cached lens maps for real backdrop refraction in Chromium, with CSS fallback and respect for reduced transparency. No optical work runs continuously while idle.

Font license: `assets/fonts/OFL-Inter.txt`. Landscape sources: `assets/bg/PHOTO-SOURCES.md`. Source code follows the root project's MIT license.
