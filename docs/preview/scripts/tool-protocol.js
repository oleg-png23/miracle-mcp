/* Read explicit Helium envelopes only. No evaluation or guessed tool names. */
(() => {
  'use strict';
  const MAX_TEXT = 1_048_576;
  function parse(text) {
    text = String(text || '');
    const result = {calls: [], hasEnvelope: /["'](?:helium|miracles?)_tool["']\s*:/.test(text), incomplete: false, error: ''};
    if (text.length > MAX_TEXT) { result.error = 'The reply exceeds the 1 MB tool-message limit.'; return result; }
    const candidates = new Set([text.trim()]);
    for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) candidates.add(match[1].trim());
    // Markdown sometimes renders the JSON without a fence, alongside prose.
    // Count braces outside strings so Luau braces/escaped quotes remain intact.
    const starts = /\{\s*"(?:helium|miracles?)_tool"\s*:/g;
    let match;
    while ((match = starts.exec(text)) && candidates.size < 64) {
      let depth = 0, quoted = false, escaped = false, end = -1;
      for (let i = match.index; i < text.length; i++) {
        const char = text[i];
        if (quoted) {
          if (escaped) escaped = false;
          else if (char === '\\') escaped = true;
          else if (char === '"') quoted = false;
        } else if (char === '"') quoted = true;
        else if (char === '{') depth++;
        else if (char === '}' && --depth === 0) { end = i + 1; break; }
      }
      if (end < 0) { result.incomplete = true; break; }
      candidates.add(text.slice(match.index, end));
      starts.lastIndex = end;
    }
    const ids = new Map();
    for (const candidate of candidates) {
      let data;
      try { data = JSON.parse(candidate); } catch { continue; }
      if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
      // Older conversations can keep using either Miracle spelling.
      const keys = ['helium_tool', 'miracles_tool', 'miracle_tool'].filter(key => Object.hasOwn(data, key));
      if (!keys.length) continue;
      if (keys.length !== 1) { result.error = 'Use exactly one tool envelope per JSON object.'; continue; }
      const call = data[keys[0]];
      result.hasEnvelope = true;
      if (!call || typeof call !== 'object' || Array.isArray(call)
          || typeof call.id !== 'string' || !/^[A-Za-z0-9_.:/-]{1,80}$/.test(call.id)
          || typeof call.name !== 'string' || !call.name.trim() || call.name.length > 200
          || !call.arguments || typeof call.arguments !== 'object' || Array.isArray(call.arguments)) {
        result.error = 'Use a tool envelope with a unique id (1–80 letters, numbers, . _ : / -), an advertised name and an arguments object.';
        continue;
      }
      const normalized = {id: call.id, name: call.name, arguments: call.arguments};
      const fingerprint = JSON.stringify(normalized);
      if (ids.has(call.id)) {
        if (ids.get(call.id) !== fingerprint) result.error = 'The reply reuses one tool id with different arguments. Ask for a fresh id.';
        continue;
      }
      ids.set(call.id, fingerprint); result.calls.push(normalized);
    }
    return result;
  }
  globalThis.MiraclesToolProtocol = Object.freeze({parse, maxText: MAX_TEXT});
})();
