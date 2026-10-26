# Helium 2.9.2 — A new name

Miracle is now **Helium**. The dashboard, welcome page, browser chat widget, extension metadata, icons, website and downloads share the new name and h✦ mark.

- New chats use `helium_tool`. Existing `miracles_tool` and `miracle_tool` messages remain supported, including streamed replies and saved-result recovery.
- Existing settings, drafts and motion preferences retain their storage keys. Reload your existing unpacked extension from the same folder to keep its identity and settings.
- The launcher recognizes verified previous Miracle bridges and retains the shared launch lock. Duplicate launches, graceful replacement and stop.bat continue to work across the rename.
- `HELIUM_PYTHON_PATH` and `HELIUM_STUDIO_MCP_PATH` are the preferred overrides; the old `MIRACLES_` variables remain supported.
- **Solar Flare** and **Lime Soda** remain the only two themes. The v2.9.0 relay fixes, Watch this chat, result recovery and diagnostics are retained.

Extract **helium-mcp-2.9.2.zip**, keep **plugin/** and **release/** together, reload the extension, run **release/run.bat** and refresh open chat tabs. To upgrade an existing extension, replace the files in its current plugin folder before reloading it. Repository and website URLs are unchanged. No extra Python packages or npm installation are needed to use the release.
