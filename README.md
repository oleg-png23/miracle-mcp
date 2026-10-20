# Miracle MCP

A local bridge between AI chats and Roblox Studio's built-in MCP server.

The workspace includes a compact glass navigation rail, a welcome page, optimized local landscape wallpapers, an optional Luau editor and usage statistics. The rounded **Miracle** glass button in supported AI chats opens a neutral graphite panel and starts or stops Studio tool sessions. Its button and panel refract the live backdrop in supported Chromium browsers, with frosted fallback, bright rims and animated opening/closing. The optical maps are cached per size and suspended while hidden; the widget makes no requests for visual assets.

[Website](https://oleg-png23.github.io/miracle-mcp/) · [Dashboard preview](https://oleg-png23.github.io/miracle-mcp/preview/dashboard.html) · [Start page preview](https://oleg-png23.github.io/miracle-mcp/preview/welcome.html) · [Download the latest release](https://github.com/oleg-png23/miracle-mcp/releases/latest)

## Requirements

- Windows 10 or 11.
- Python 3.10 or newer.
- Roblox Studio with built-in Studio MCP support.
- Microsoft Edge or Google Chrome for the extension.

Python uses the standard library. Node.js is needed only for development and browser tests.

## Start

1. Open a place in Roblox Studio. In Assistant, select **… → Manage MCP Servers → Enable Studio as MCP Server**.
2. Run `run.bat` from this folder. The launcher starts the bridge and opens the workspace at `http://127.0.0.1:19731/app`.
3. Open `edge://extensions` or `chrome://extensions`, enable Developer mode and choose **Load unpacked**. Select this repository's root folder.
4. Open a supported AI chat and select **Miracle → Start session**. Then describe the change you want to make in Studio.

The bridge creates its access token locally. It does not belong in Studio, an AI chat, or source control. Keep the bridge running while using the extension. After an update, restart the bridge, reload the extension and refresh open chat tabs.

The m✦ logo in the navigation rail opens `/ui/welcome.html`. Installation and the first extension launch open the welcome page. Browser startup or a later launch can show it again after five hours. During the cooldown, toolbar clicks open the workspace and browser startup stays quiet. Existing welcome/workspace tabs are reused.

## Appearance

The new Coast, Alps and Aurora wallpapers are optimized original landscape illustrations, 1672 × 941 pixels, together about 459 KB. The remaining five landscapes use lightweight 1920-pixel derivatives; all eight active backgrounds total about 1.27 MB. The original 4K collection remains in the source repository. Wallpapers and thumbnails are separate files; provenance and actual dimensions are recorded in `assets/bg/PHOTO-SOURCES.md`.

Automatic mode follows local time: Alps in the morning, Coast in the afternoon and Aurora in the evening/night. Selecting a landscape enables manual mode. Turn on **Match time of day** to restore automatic changes.

The desktop rail trails scrolling by at most 16 pixels and settles when scrolling stops. The mobile dock stays fixed. Reduced-motion preferences disable these animations. Tooltips use the browser's top layer so cards cannot cover them.

The dashboard and website also have rotating typewriter headlines with blinking cursors and a **Pause motion** control. Both suspend typing offscreen and in hidden tabs, show complete text when paused or with reduced motion, and keep an accessible static title. The welcome headline types and erases four short two-line phrases with a blinking cursor, reserving its height so the layout stays steady. Screen readers receive a stable title. Pausing motion or enabling reduced motion shows a complete heading; typing also pauses when the heading or tab is hidden. The welcome page reveals its headline, actions and capabilities in sequence, floats the connection card, lights the bridge nodes and animates the connection line when Studio is ready. **Pause motion** stops the ambient animations and remembers the choice. Hidden/offscreen panels pause, and reduced-motion preferences disable the animations. Cards tilt gently toward the cursor and settle when it leaves. The logo remains anchored inside the rail, sections have subtle dividers, and instructions expand smoothly. The workspace uses more horizontal space on wide screens.

**Clear** uses rounded refractive lenses on the main card, rail and welcome panel in Chrome and Edge. Content cards retain their translucent tint and rim without a live filter. Each lens uses at most 65,536 map pixels, a cached optical profile, RGB dispersion and a separate highlight. Only two surfaces run on the dashboard; offscreen lenses suspend their filters. The depth slider changes refraction strength. **Beautify** applies deeper live refraction, RGB dispersion, brighter rims and richer shadows to every visible glass surface. It uses higher-resolution optical maps and more GPU work; offscreen and hidden surfaces still suspend their effects. The choice persists and is also available in the website preview. **Frosted** uses a soft blur, and **Light** disables backdrop effects. The initial choice follows system transparency preferences; explicitly choosing Clear takes precedence. Other browsers use a frosted fallback.

Optics references: [Liquid Glass in the Browser](https://kube.io/blog/liquid-glass-css-svg/), [Apple: Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/), and [SVG displacement maps](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/feDisplacementMap).

## Usage

**Token Transfared** records successful chat-session activations, sites and estimated traffic in each direction. The estimate is one token per four Unicode characters, calculated separately for each transferred message. It covers bridge instructions, tool calls and results, rather than the entire conversation or the AI provider's quota.

Tracking starts when this version is enabled; earlier sessions cannot be reconstructed. Counts survive restarts in `.mcp_cache/usage-stats.json`. The usage tracker stores aggregates, hostnames and event IDs, without storing prompts, code, results or full page URLs.

## Supported chats

Host permissions and content-script matches are listed in `manifest.json`. Edge blocks extensions on `copilot.microsoft.com`, so the Miracle button may be unavailable there.

For Notion, open **Notion AI chat** first. For ClickUp, open **Brain Chat**. Miracle does not use ordinary documents, task descriptions or comment fields as chat composers. These adapters rely on semantic labels and can require updates when the services change their interfaces.

## Local API

- `POST /api/bootstrap`: prepare the local connection.
- `GET /api/status`: bridge, Studio, results and usage status.
- `POST /api/tools/list`: current Studio tool catalog.
- `POST /api/tools/call`: call an advertised tool.
- `POST /api/execute`: optional manual Luau execution.
- `POST /api/usage/event`: authenticated aggregate usage event.

Mutation requests require the local token. The server validates loopback hosts, origins, request sizes and call IDs. Code checks apply on the server as well as in the editor. A successful transport response does not imply a successful Studio tool result; tool errors remain visible to the chat agent.

The default port is `19731`. Optional environment variables:

- `MIRACLES_PYTHON_PATH`: Python executable for the Windows launcher.
- `MIRACLES_STUDIO_MCP_PATH`: override automatic StudioMCP executable discovery.

## Development

Install Node.js 20 or newer, then:

```sh
npm ci
npm test
python -m unittest discover -s python -p "test_*.py"
```

For browser tests, start the isolated Studio simulator in one terminal:

```sh
python scripts/test-fixture.py
```

In another terminal:

```sh
npm run test:ui
npm run test:glass
npm run test:launch
```

UI tests use local synthetic chats and a fake Studio transport. They do not send messages to real AI services or change a real Studio place. Edge must be installed. Set `MIRACLES_QUICK_QA=1` for the smaller host-injection matrix, or `MIRACLES_DASHBOARD_ONLY=1` to run only dashboard and welcome-page checks.

The glass check compares pixels with refraction enabled and zeroed against a checkerboard backdrop, verifies the stable lens interior, depth, material switches, responsive map sizes, offscreen suspension, system transparency, forced colors and the unsupported-engine fallback. Screenshots are saved in `.mcp_cache/qa/`.

`python scripts/build-release.py` creates the extension, standalone website, wallpaper archives and SHA-256 checksums in `.mcp_cache/release/` from an explicit allowlist. The site source is in `website/`; `docs/` is its GitHub Pages publication copy. The archives exclude local tokens, caches, user data, tests and unrelated workspace folders.

## License

Source code: MIT. Third-party fonts, icons and photographs retain their original licenses; see `THIRD_PARTY.md`.
