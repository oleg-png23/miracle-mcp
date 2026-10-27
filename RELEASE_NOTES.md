# Helium 2.9.3 — Safer sessions

- Pair each workspace by copying the access token from the local `release/python/token.txt` file into Connection settings. A previously saved token continues to work if the bridge token is unchanged. The bridge no longer returns its token over HTTP.
- Sensitive results, events and usage data now require authentication. The bridge checks the loopback Host on every request.
- A result stays with its original conversation, including when a tool finishes after switching chats. New ChatGPT conversations can establish their URL when the first prompt is sent.
- Tool calls are bound to the bridge instance and expire while waiting for Studio. Studio MCP can reconnect after an update, and an unavailable process check no longer hides a working connection.
- Code checks are described as best-effort pattern checks, not a sandbox.

Extract **helium-mcp-2.9.3.zip**, keep **plugin/** and **release/** together, reload the extension, run **release/run.bat** and refresh open chat tabs. See INSTALL.md for pairing instructions.
