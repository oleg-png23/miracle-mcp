// Helium MCP — shared config (extension + Python bridge read the same values)
const MIRACLES_CONFIG = {
  MCP_HOST: "127.0.0.1",
  MCP_PORT: 19731,
  POLL_INTERVAL_MS: 1500
};
try { if (typeof self !== "undefined") self.MIRACLES_CONFIG = MIRACLES_CONFIG; } catch {}
