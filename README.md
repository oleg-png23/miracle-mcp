# Miracle MCP

A local bridge between AI chats and Roblox Studio's built-in MCP server.

The workspace includes a compact glass navigation rail, a welcome page, local 4K photographs, an optional Luau editor and usage statistics. The white **Miracle** button in supported AI chats starts and stops Studio tool sessions.

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

The m✦ logo in the navigation rail opens `/ui/welcome.html`. A new extension installation opens the welcome page automatically.

## Appearance

All eight wallpapers are local photographs, 4096 pixels wide without upscaling. Full images and thumbnails are separate files. Sources are recorded in `assets/bg/PHOTO-SOURCES.md`.

Automatic mode follows local time: Ocean in the morning, Coast in the afternoon, Sunset in the evening, Dusk after 20:00 and Aurora after 21:00. Selecting a photograph enables manual mode. Turn on **Match time of day** to restore automatic changes.

The desktop rail trails scrolling by at most 16 pixels and settles when scrolling stops. The mobile dock stays fixed. Reduced-motion preferences disable these animations. Tooltips use the browser's top layer so cards cannot cover them.

Cards tilt gently toward the cursor and settle when it leaves. The rail logo stays still, sections have subtle dividers, and instructions expand smoothly. The workspace uses more horizontal space on wide screens.

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
```

UI tests use local synthetic chats and a fake Studio transport. They do not send messages to real AI services or change a real Studio place. Edge must be installed. Set `MIRACLES_QUICK_QA=1` for the smaller host-injection matrix, or `MIRACLES_DASHBOARD_ONLY=1` to run only dashboard and welcome-page checks.

## License

Source code: MIT. Third-party fonts, icons and photographs retain their original licenses; see `THIRD_PARTY.md`.
