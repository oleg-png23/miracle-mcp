/* Shared browser/extension settings, connection diagnostics and bounded requests. */
(() => {
  "use strict";
  const pageURL = new URL(location.href);
  const pageHost = pageURL.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(pageURL.hostname) ? pageURL.host : '127.0.0.1:19731';
  const defaults = { host: pageHost, bridgeToken: "", safeMode: true, pollInterval: 1500, dashboardWallpaper: "lime", dashboardMaterial: window.matchMedia?.('(prefers-reduced-transparency: reduce)').matches ? 'light' : 'clear', dashboardGlassDepth: 68, dashboardWallpaperMode: "manual" };
  function savedObject(key) {
    try { const value = JSON.parse(localStorage.getItem(key) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
    catch { return {}; }
  }
  let memory = {};
  const extensionStore = window.chrome?.storage?.local;
  const storage = {
    async read() {
      if (extensionStore) return { ...defaults, ...await extensionStore.get(Object.keys(defaults).concat(["accent", "accentStrong", "rail", "ambientMotion"])) };
      const legacy = savedObject('miracles.dashboard.settings');
      const saved = savedObject('miracles.settings');
      return { ...defaults, host: localStorage.getItem("mcp_host") || defaults.host,
        bridgeToken: localStorage.getItem("mcp_token") || "", ...legacy, ...saved, ...memory };
    },
    async set(values) {
      if (extensionStore) return extensionStore.set(values);
      const saved = await storage.read();
      localStorage.setItem("miracles.settings", JSON.stringify({ ...saved, ...values }));
      // Keep the launcher's older storage keys in sync during upgrades.
      if ("host" in values) localStorage.setItem("mcp_host", values.host);
      if ("bridgeToken" in values) localStorage.setItem("mcp_token", values.bridgeToken);
      memory = { ...memory, ...values };
    },
    async clear() {
      if (extensionStore) return extensionStore.remove(Object.keys(defaults).concat(["accent", "accentStrong", "rail", "ambientMotion"]));
      localStorage.removeItem("miracles.settings");
      localStorage.removeItem("miracles.dashboard.settings");
      localStorage.removeItem("mcp_host"); localStorage.removeItem("mcp_token"); memory = {};
    },
    get(keys, callback) { storage.read().then(s => callback(s)).catch(e => { report("Could not read browser settings: " + e.message); callback({ ...defaults }); }); }
  };
  function base(raw) {
    const value = (raw || defaults.host).trim();
    let url;
    try { url = new URL(/^https?:\/\//i.test(value) ? value : "http://" + value); }
    catch { throw new Error("Invalid address. Example: 127.0.0.1:19731"); }
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.protocol !== "http:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
      throw new Error("Enter a local HTTP address without a path or password.");
    return url.origin;
  }
  async function request(address, path, body, timeoutMs = 5000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(base(address) + path, { cache: "no-store", signal: controller.signal,
        ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
      const data = await response.json().catch(() => { throw new Error("Invalid bridge response. Check the address and restart run.bat."); });
      if (!response.ok) {
        const detail = data.message || data.error?.message || (typeof data.error === 'string' ? data.error : '') || 'check Studio MCP';
        const message = response.status === 401 ? "The connection expired. Reload the workspace to reconnect."
          : response.status === 403 ? "Request blocked (403): " + (data.pattern || detail)
          : `HTTP ${response.status}: ${detail}`;
        throw new Error(message);
      }
      return data;
    } catch (error) {
      if (error.name === "AbortError") throw new Error(`The bridge did not respond within ${Math.ceil(timeoutMs / 1000)} s. Check run.bat and the connection.`);
      if (error instanceof TypeError) throw new Error("The bridge is offline. Start run.bat and select Check connection.");
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function bootstrap() {
    const runtime = window.chrome?.runtime;
    if (runtime?.id && runtime.sendMessage && extensionStore) {
      await new Promise((resolve, reject) => {
        runtime.sendMessage({ type: "MCP_HEALTH" }, response => {
          const error = runtime.lastError;
          if (error) reject(new Error(error.message));
          else if (response?.authenticated !== true) reject(new Error(response?.message || "Pair the extension with the local workspace first."));
          else resolve(response);
        });
      });
      const values = await storage.read();
      if (!values.bridgeToken) throw new Error("The extension could not save the connection token.");
      return values;
    }
    if (location.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(location.hostname))
      throw new Error("Automatic setup requires the local Argon page.");
    const values = await storage.read();
    if (!values.bridgeToken?.trim()) throw new Error("Copy the token from release/python/token.txt (or python/token.txt in a source checkout) into Connection settings.");
    try { await request(values.host, '/api/auth', {token:values.bridgeToken}); }
    catch (error) {
      if (/connection expired/i.test(error.message)) throw new Error("The token changed. Copy the current token from release/python/token.txt into Connection settings.");
      throw error;
    }
    return values;
  }
  function diagnose(status) {
    const native = status.native_mcp || {};
    const isNative = status.studio_mode === "native_mcp" || Boolean(status.native_mcp);
    const setup = "Open a place → Assistant → … → Manage MCP Servers → Enable Studio as MCP Server.";
    if (isNative) {
      const states = {
        ready: ["Studio MCP connected", "Studio MCP is ready. Start a session in your AI chat."],
        missing: ["Studio MCP unavailable", "Open a place in Roblox Studio and check that your version supports MCP."],
        studio_closed: ["Studio closed", "Open your place in Roblox Studio."],
        mcp_disabled: ["Enable Studio MCP", setup],
        connecting: ["Connecting to Studio MCP", "Roblox Studio is connecting. Please wait."],
        error: ["Studio MCP error", native.message || "Roblox Studio MCP reported an error."]
      };
      const [title, message] = states[native.state] || ["Studio MCP: unknown status", native.message || setup];
      return { state: native.state === "ready" ? "linked" : native.state || "connecting", title, message };
    }
    if (status.studio_linked) return { state: "linked", title: "Studio MCP connected", message: "Start a session in your AI chat and send a task." };
    return { state: "mcp_disabled", title: "Studio MCP disconnected", message: setup };
  }
  function report(message, error = true) {
    const feedback = document.getElementById("actionFeedback");
    if (feedback) { feedback.hidden = false; feedback.textContent = message; feedback.dataset.kind = error ? "error" : "info"; }
    const box = document.getElementById("toasts");
    if (box) {
      const item = document.createElement("div"); item.className = "toast"; item.textContent = message;
      box.appendChild(item); setTimeout(() => item.remove(), 6000);
    }
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const area = document.createElement("textarea"); area.value = text; document.body.appendChild(area); area.select();
      try { if (!document.execCommand("copy")) throw new Error("Copying was blocked. Select the text and press Ctrl+C."); }
      finally { area.remove(); }
    }
  }
  window.MiraclesBridge = { defaults, storage, base, request, bootstrap, diagnose, report, copy };
})();
