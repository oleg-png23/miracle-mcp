# Argon website

A self-contained, buildless website for Argon MCP. The landing page explains the local bridge, links to the two interactive app previews, and provides Windows setup and FAQ sections.

From the repository root:

```sh
python -m http.server 19739 --bind 127.0.0.1 --directory website
```

Open http://127.0.0.1:19739. All fonts, images and scripts are local. There are no analytics, external font requests, background animations or browser storage writes on the landing page. Navigation, downloads, previews and native FAQ disclosures work without JavaScript. The small script adds copy-path feedback and the current copyright year. If clipboard access fails, it selects the path for manual copying.

The hero and preview cards are illustrative. Open `preview/welcome.html` or `preview/dashboard.html` to explore the actual interface with clearly labeled sample data. The demo transport never contacts a bridge, reads extension storage or executes Studio tools. Appearance settings and editor drafts use separate preview storage keys.

After changing the runtime UI or landing page, regenerate the published site:

```sh
python scripts/build-site-preview.py
```

The builder copies active runtime assets into `website/preview/`, then replaces `docs/` with the contents of `website/` for GitHub Pages. Treat `docs/` as generated output; edit `website/` instead. The release builder runs this step automatically.

The landing page uses one stylesheet and one small script. Shared app effects remain confined to the app previews. Font licenses are in `assets/fonts/`; the two palette graphics are described in `assets/bg/THEMES.md`; icon sources and licenses are in `assets/icons/`. Source code follows the root project's MIT license.
