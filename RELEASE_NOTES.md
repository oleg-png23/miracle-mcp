# Miracle 2.9.0 — Reliable chat tools and bridge recovery

The chat relay now waits for stable replies and keeps reading when a site's final streaming update is missed. Long JSON replies are no longer discarded after an incomplete first read. Fenced JSON, JSON surrounded by prose and the `miracle_tool` spelling alias are supported; only explicit Miracle tool envelopes execute.

- **Watch this chat** attaches after manually pasted instructions and can run the latest assistant tool reply once. User messages and older history are excluded, and your draft is preserved.
- **Last tool result** keeps a result when chat delivery fails. Retry sending it without re-running the tool, copy it, or dismiss it. Stop keeps late results available without posting them automatically.
- **Chat agent** on Home distinguishes Studio connectivity from a running reader, shows paused/incomplete sessions and detects version mismatches. Connection reports omit credentials, chat text, code, arguments and results.
- Duplicate launches reuse one bridge. Windows launch locking, exclusive port binding and an authenticated shutdown route allow verified older bridges to be cleaned up. Unrelated applications are not stopped. `release/stop.bat` closes an idle bridge.
- The Lime Soda dashboard design and motion preferences are retained. Session usage reporting no longer delays tool-result delivery.

## Install or update

Extract **miracle-mcp-2.9.0.zip** completely. Keep **plugin/** and **release/** together. Load or reload **plugin/** through Chrome/Edge's extensions page, run **release/run.bat**, enable Studio MCP and refresh your open chat tabs. Choose **Miracle → Start session**, or **Watch this chat** if instructions were pasted manually. Copying instructions alone does not activate the reader.

Python 3.10+, Windows 10/11 and Roblox Studio with Studio MCP are required. No npm or additional Python packages are needed to use the release. In-page saved tool results are cleared by reloading a chat tab; inspect Studio before repeating an action after a reload.

The website preview uses sample data and cannot run Studio commands. Source, standalone website and wallpaper archives are built from the same revision, with SHA-256 checksums. Local credentials, caches, user data and test fixtures are excluded.
