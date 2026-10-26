#!/usr/bin/env python3
"""Loopback HTTP bridge from the dashboard to Roblox Studio's built-in MCP."""
from __future__ import annotations

import argparse
import errno
import hashlib
import json
import os
import re
import secrets
import socket
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Optional

try:
    from .studio_mcp import StudioMCP, StudioMCPError
    from .usage_stats import UsageStats
except ImportError:  # direct execution: python python/mcp_server.py
    from studio_mcp import StudioMCP, StudioMCPError
    from usage_stats import UsageStats

VERSION = "2.9.0"
INSTANCE_ID = secrets.token_hex(8)
START = time.time()
TOKEN = ""
SAFE = True
ALLOW_ASSETS: set[str] = set()
RECENT: list[dict] = []
RESULTS: list[dict] = []
QUEUE: list[dict] = []
NEXT_ID = 1
MAX_LUAU = 20000
MAX_BODY = 1_048_576
BLOCKED = [
    (re.compile(r":\s*Kick\s*\("), "Player:Kick"),
    (re.compile(r"BanAsync"), "Players:BanAsync"),
    (re.compile(r"game\s*:\s*Shutdown"), "game:Shutdown"),
    (re.compile(r"\brequire\s*\("), "require() (dynamic module load)"),
    (re.compile(r"\bloadstring\b"), "loadstring (nested code load)"),
    (re.compile(r"\b(get|set)fenv\b"), "getfenv/setfenv"),
    (re.compile(r"\bos\s*\."), "os library"),
    (re.compile(r"\bio\s*\."), "io library"),
    (re.compile(r"MarketplaceService\s*:\s*PromptPurchase"), "real-money purchase prompt"),
]
ASSET_RE = re.compile(r"rbxassetid://(\d+)", re.IGNORECASE)

_STATE_LOCK = threading.RLock()
_NATIVE_LOCK = threading.RLock()
_NATIVE_CLIENT = None
_NATIVE_FACTORY: Callable[[], Any] = StudioMCP
_NATIVE_TOOLS: list[dict] = []
_MONITOR_THREAD: Optional[threading.Thread] = None
_MONITOR_STOP = threading.Event()
_DEDUP_LOCK = threading.Lock()
_CALLS: dict[str, dict] = {}
USAGE = UsageStats()
_AGENTS: dict[str, dict] = {}
_LAST_UI_OPEN = 0.0


def agent_sessions() -> list[dict]:
    with _STATE_LOCK:
        return [{**item, "age_s": max(0, int(time.time() - item["updated_at"]))}
                for item in sorted(_AGENTS.values(), key=lambda item: item["updated_at"], reverse=True)[:12]]


def record_agent(body: dict) -> None:
    """Store operational state only, never chat text, arguments or results."""
    client_id, session_id = body.get("client_id"), body.get("session_id")
    if not isinstance(client_id, str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,100}", client_id):
        raise ValueError("A valid chat client id is required")
    if not isinstance(session_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", session_id):
        raise ValueError("A valid session id is required")
    state = body.get("state")
    if state not in {"starting", "watching", "waiting_json", "running", "sending_result", "paused", "stopped"}:
        raise ValueError("Unknown agent state")
    site = body.get("site", "")
    if not isinstance(site, str) or not re.fullmatch(r"[a-zA-Z0-9.-]{1,253}", site):
        raise ValueError("A hostname is required")
    calls = body.get("calls", 0)
    if type(calls) is not int or not 0 <= calls <= 30:
        raise ValueError("Invalid tool call count")
    item = {"session_id": session_id, "site": site.lower(), "state": state, "calls": calls,
            "updated_at": time.time()}
    for field, limit, pattern in [("code", 80, r"[A-Z0-9_]*"), ("tool_name", 200, r"[^\x00-\x1f]*"),
                                  ("client_version", 30, r"[0-9.]*"), ("extension_version", 30, r"[0-9.]*")]:
        value = body.get(field, "")
        if not isinstance(value, str) or len(value) > limit or not re.fullmatch(pattern, value):
            raise ValueError("Invalid agent " + field)
        item[field] = value
    with _STATE_LOCK:
        _AGENTS[client_id] = item
        while len(_AGENTS) > 32:
            del _AGENTS[min(_AGENTS, key=lambda key: _AGENTS[key]["updated_at"])]


def now() -> str:
    return time.strftime("%H:%M:%S")


def log(src: str, text: str) -> None:
    with _STATE_LOCK:
        RECENT.append({"at": now(), "src": src, "text": str(text)[:500]})
        del RECENT[:-50]


def check_safe(code: str):
    if not SAFE:
        return None
    for rx, label in BLOCKED:
        if rx.search(code):
            return label
    if ALLOW_ASSETS:
        ids = set(ASSET_RE.findall(code))
        foreign = sorted(ids - ALLOW_ASSETS, key=int)
        if foreign:
            return "asset id(s) not in allowlist: " + ", ".join(foreign)
    return None


def set_native_client_factory(factory: Optional[Callable[[], Any]] = None) -> None:
    """Inject a fake client in tests; must be called before the client is created."""
    global _NATIVE_FACTORY
    with _NATIVE_LOCK:
        if _NATIVE_CLIENT is not None:
            raise RuntimeError("native client is already initialized")
        _NATIVE_FACTORY = factory or StudioMCP


def get_native_client():
    """Return the lazy process singleton without starting its background worker."""
    global _NATIVE_CLIENT
    with _NATIVE_LOCK:
        if _NATIVE_CLIENT is None:
            _NATIVE_CLIENT = _NATIVE_FACTORY()
        return _NATIVE_CLIENT


def _refresh_native() -> None:
    global _NATIVE_TOOLS
    client = get_native_client()
    try:
        client.start_if_needed()
        status = client.status()
        tools = client.list_tools() if status.get("state") == "ready" else []
        with _NATIVE_LOCK:
            _NATIVE_TOOLS = [x for x in tools if isinstance(x, dict)]
    except Exception as exc:
        log("native", f"Studio MCP monitor: {exc}")
        with _NATIVE_LOCK:
            _NATIVE_TOOLS = []


def _monitor() -> None:
    while not _MONITOR_STOP.is_set():
        _refresh_native()
        _MONITOR_STOP.wait(10.0)


def start_native_monitor() -> None:
    global _MONITOR_THREAD
    with _NATIVE_LOCK:
        if _MONITOR_THREAD and _MONITOR_THREAD.is_alive():
            return
        _MONITOR_STOP.clear()
        _MONITOR_THREAD = threading.Thread(target=_monitor, name="studio-mcp-monitor", daemon=True)
        _MONITOR_THREAD.start()


def stop_native_client() -> None:
    global _NATIVE_CLIENT, _MONITOR_THREAD, _NATIVE_TOOLS
    _MONITOR_STOP.set()
    thread = _MONITOR_THREAD
    if thread and thread is not threading.current_thread():
        thread.join(timeout=1.0)
    with _NATIVE_LOCK:
        client, _NATIVE_CLIENT = _NATIVE_CLIENT, None
        _MONITOR_THREAD = None
        _NATIVE_TOOLS = []
    if client is not None:
        try:
            client.close()
        except Exception:
            pass


def _status_native() -> dict:
    # status() on StudioMCP is a local cached read; the monitor owns probing.
    try:
        return dict(get_native_client().status())
    except Exception as exc:
        return {"bridge": "running", "state": "error", "ready": False,
                "tools_count": 0, "message": str(exc), "error": str(exc)}


def _tool_catalog(refresh: bool = False) -> list[dict]:
    global _NATIVE_TOOLS
    client = get_native_client()
    if refresh:
        status = client.status()
        if status.get("state") == "ready":
            tools = client.list_tools()
            with _NATIVE_LOCK:
                _NATIVE_TOOLS = [x for x in tools if isinstance(x, dict)]
    with _NATIVE_LOCK:
        return list(_NATIVE_TOOLS)


def _tool_offline() -> Optional[dict]:
    status = _status_native()
    if status.get("state") != "ready":
        return {"ok": False, "error": {"code": "native_offline", "message": status.get("message") or
                f"Studio MCP is not ready ({status.get('state', 'unknown')})"}, "native_mcp": status,
                "instance_id": INSTANCE_ID}
    return None


def _safe_code_arguments(value: Any):
    if isinstance(value, dict):
        for key, child in value.items():
            if str(key).lower() in {"code", "source", "script", "luau"} and isinstance(child, str):
                reason = check_safe(child)
                if reason:
                    return reason
            reason = _safe_code_arguments(child)
            if reason:
                return reason
    elif isinstance(value, list):
        for child in value:
            reason = _safe_code_arguments(child)
            if reason:
                return reason
    return None


def _native_call(name: str, arguments: dict, timeout: float = 60.0) -> dict:
    client = get_native_client()
    result = client.call_tool(name, arguments, timeout=timeout)
    if not isinstance(result, dict):
        raise StudioMCPError("Studio MCP returned a malformed tool result")
    return result


def _call_fingerprint(name: str, arguments: dict) -> str:
    raw = json.dumps({"name": name, "arguments": arguments}, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _trim_call_cache(call_id: str, response: dict) -> tuple[dict, int]:
    """Keep 128 full results; small tombstones prevent expired calls from replaying."""
    with _DEDUP_LOCK:
        current = _CALLS[call_id]
        current_size = len(json.dumps(response, ensure_ascii=False).encode("utf-8"))
        if current_size > 2_000_000:
            current["response"] = {"ok": False, "error": {"code": "result_expired", "message": "Result is too large to cache; call_id cannot be replayed"}, "instance_id": INSTANCE_ID}
            current["http"] = 410
            current["expired"] = True
        full_results = [(key, entry) for key, entry in _CALLS.items()
                        if (entry["event"].is_set() or key == call_id) and not entry.get("expired")]
        while len(full_results) > 128:
            _, entry = full_results.pop(0)
            entry["response"] = {"ok": False, "error": {"code": "result_expired", "message": "Cached result has expired; call_id cannot be replayed"}, "instance_id": INSTANCE_ID}
            entry["http"] = 410
            entry["expired"] = True
        return current["response"], current["http"]


def _run_manual_job(jid: int, code: str, tool_name: Optional[str], arg_name: Optional[str]) -> None:
    started = time.perf_counter()
    ok, is_error, output = False, None, ""
    try:
        if not tool_name or not arg_name:
            raise StudioMCPError("Studio MCP does not advertise a code execution tool with a supported source argument")
        result = _native_call(tool_name, {arg_name: code})
        is_error = bool(result.get("isError"))
        ok = not is_error
        content = result.get("content") if isinstance(result.get("content"), list) else []
        text_parts = [item.get("text") for item in content if isinstance(item, dict) and isinstance(item.get("text"), str)]
        if text_parts:
            output = "\n".join(text_parts)
        elif "structuredContent" in result:
            output = json.dumps(result["structuredContent"], ensure_ascii=False)
        else:
            output = json.dumps({k: v for k, v in result.items() if k != "content"}, ensure_ascii=False)
        output = output[:2000]
    except Exception as exc:
        output = str(exc)[:2000]
    elapsed = int((time.perf_counter() - started) * 1000)
    row = {"id": jid, "ok": ok, "output": output, "elapsed_ms": elapsed, "at": now()}
    if is_error is not None:
        row["isError"] = is_error
    with _STATE_LOCK:
        RESULTS.append(row)
        del RESULTS[:-50]
        QUEUE[:] = [j for j in QUEUE if j["id"] != jid]
    log("native:execute", f"result #{jid}: {'OK' if ok else 'ERR'} {output}")


def _code_tool(tools: list[dict]) -> tuple[Optional[str], Optional[str]]:
    names = ("run_code", "execute_luau", "run_luau", "execute_code", "run_script", "execute_script",
             "run_luau_code", "execute_luau_code", "run_lua", "execute_lua")
    fields = ("code", "source", "script", "luau")
    by_name = {str(t.get("name", "")).lower(): t for t in tools}
    ordered = [by_name[name] for name in names if name in by_name]
    ordered.extend(t for key, t in by_name.items() if t not in ordered and
                   ("run" in key or "execute" in key) and any(part in key for part in ("code", "lua", "script")))
    for tool in ordered:
        name = str(tool.get("name", ""))
        schema = tool.get("inputSchema") or tool.get("input_schema") or {}
        props = schema.get("properties", {}) if isinstance(schema, dict) else {}
        required = schema.get("required", []) if isinstance(schema, dict) else []
        field = next((key for key in fields if key in props), None)
        if field and (not required or set(required).issubset({field})):
            return str(tool.get("name")), field
    return None, None


def _host_loopback(host: str, port: int) -> bool:
    try:
        parsed = urllib.parse.urlsplit("//" + host)
        return (parsed.hostname in {"127.0.0.1", "localhost", "::1"} and parsed.port == port
                and not parsed.username and not parsed.password and parsed.path == "")
    except (ValueError, TypeError):
        return False


def _trusted_origin(origin: Optional[str], port: int) -> bool:
    if origin is None:
        return True  # local CLI clients do not send Origin
    if origin == "null":
        return False
    if re.fullmatch(r"chrome-extension://[a-p]{32}", origin):
        return True
    try:
        parsed = urllib.parse.urlsplit(origin)
        return (parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost", "::1"}
                and parsed.port == port and not parsed.username and not parsed.password
                and parsed.path == "" and parsed.query == "" and parsed.fragment == "")
    except (ValueError, TypeError):
        return False


def resolve_app_root(server_file=__file__):
    """Support a source checkout and the sibling plugin/release ZIP layout."""
    runtime = Path(server_file).resolve().parents[1]
    if (runtime / "dashboard.html").is_file():
        return str(runtime)
    plugin = runtime.parent / "plugin"
    if (plugin / "manifest.json").is_file() and (plugin / "dashboard.html").is_file():
        return str(plugin)
    return str(runtime)


class H(BaseHTTPRequestHandler):
    server_version = "MiraclesMCP/" + VERSION
    APP_ROOT = resolve_app_root()
    STATIC_EXTS = {
        ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
        ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2",
        ".lua": "text/plain; charset=utf-8", ".ico": "image/x-icon",
    }

    def log_message(self, *args):
        pass

    def _cors(self):
        origin = self.headers.get("Origin")
        if _trusted_origin(origin, self.server.server_port) and origin is not None:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        if not _trusted_origin(self.headers.get("Origin"), self.server.server_port):
            self.send_response(403)
            self.end_headers()
            return
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _json(self, obj, code=200):
        if isinstance(obj, dict) and isinstance(obj.get("error"), dict):
            obj = dict(obj)
            obj.setdefault("code", obj["error"].get("code", "error"))
            obj.setdefault("message", obj["error"].get("message", "Request failed"))
            obj.setdefault("instance_id", INSTANCE_ID)
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        ctype = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if ctype != "application/json":
            return None, {"code": "content_type", "message": "Content-Type must be application/json"}
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except (TypeError, ValueError):
            return None, {"code": "bad_length", "message": "Invalid Content-Length"}
        if length < 0 or length > MAX_BODY:
            return None, {"code": "body_too_large", "message": "Request body is too large"}
        try:
            value = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, OSError, UnicodeDecodeError):
            return None, {"code": "invalid_json", "message": "Request body must be valid JSON"}
        if not isinstance(value, dict):
            return None, {"code": "invalid_json", "message": "Request body must be a JSON object"}
        return value, None

    def _authed(self, body) -> bool:
        return bool(TOKEN) and isinstance(body, dict) and secrets.compare_digest(str(body.get("token", "")), TOKEN)

    def _file(self, path, ctype):
        try:
            with open(path, "rb") as f:
                body = f.read()
        except OSError:
            self._json({"error": "not found"}, 404)
            return
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _static(self, rel):
        rel = urllib.parse.unquote(rel).replace("\\", "/").lstrip("/")
        root = os.path.abspath(self.APP_ROOT)
        full = os.path.abspath(os.path.join(root, rel))
        if (not rel or rel.startswith(".") or "/." in rel or rel.endswith("/")
                or not full.startswith(root + os.sep)):
            self._json({"error": "not found"}, 404)
            return
        ctype = self.STATIC_EXTS.get(os.path.splitext(full)[1].lower())
        if not ctype:
            self._json({"error": "not found"}, 404)
            return
        self._file(full, ctype)

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path in ("/", "/app", "/app/", "/ui", "/ui/", "/ui/index.html", "/ui/launcher.html",
                    "/ui/page.html", "/ui/miracles_true_apple_liquid_glass.html"):
            self.send_response(302)
            self.send_header("Location", "/ui/dashboard.html")
            self.end_headers()
        elif path.startswith("/ui/"):
            self._static(path[4:])
        elif path == "/api/status":
            with _STATE_LOCK:
                oldest = max((time.time() - j["ts"] for j in QUEUE), default=0)
                queue_count = len(QUEUE)
                recent = RECENT[-15:][::-1]
                results = RESULTS[-50:][::-1]
            native = _status_native()
            self._json({"online": True, "service": "miracle-mcp", "pid": os.getpid(), "version": VERSION, "instance_id": INSTANCE_ID,
                        "queue": queue_count, "oldest_pending_s": int(oldest), "stale": oldest > 120,
                        "studio_mode": "native_mcp", "studio_linked": native.get("state") == "ready",
                        "native_mcp": native, "results": results, "recent": recent,
                        "uptime_s": int(time.time() - START), "port": self.server.server_port,
                        "auth": True, "safe": SAFE, "allowlist": sorted(ALLOW_ASSETS, key=int),
                        "usage": USAGE.snapshot(), "agent_sessions": agent_sessions(),
                        "capabilities": ["agent_status", "graceful_shutdown", "single_instance"]})
        else:
            self._json({"error": "not found"}, 404)

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path in {"/api/poll", "/api/result", "/api/chat"}:
            self._json({"ok": False, "error": {"code": "removed", "message": "This route is no longer supported"}}, 410)
            return
        # Bootstrap is the only endpoint that returns the bridge token.
        if path == "/api/bootstrap":
            if self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
                self._json({"ok": False, "error": {"code": "content_type", "message": "Content-Type must be application/json"}}, 415)
                return
            if not _host_loopback(self.headers.get("Host", ""), self.server.server_port):
                self._json({"ok": False, "error": {"code": "untrusted_host", "message": "Bootstrap requires a loopback Host on this port"}}, 403)
                return
            if not _trusted_origin(self.headers.get("Origin"), self.server.server_port):
                self._json({"ok": False, "error": {"code": "untrusted_origin", "message": "Bootstrap origin is not trusted"}}, 403)
                return
            _, body_error = self._body()
            if body_error:
                self._json({"ok": False, "error": body_error}, 400)
                return
            self._json({"ok": True, "host": f"127.0.0.1:{self.server.server_port}",
                        "bridgeToken": TOKEN, "instance_id": INSTANCE_ID})
            return
        if not _trusted_origin(self.headers.get("Origin"), self.server.server_port):
            self._json({"ok": False, "error": {"code": "untrusted_origin", "message": "Origin is not trusted"}}, 403)
            return
        body, body_error = self._body()
        if body_error:
            self._json({"ok": False, "error": body_error}, 400)
            return
        if path == "/api/auth":
            if not self._authed(body):
                self._json({"ok": False, "error": {"code": "unauthorized", "message": "Bad or missing bridge token"}}, 401)
                return
            self._json({"ok": True, "instance_id": INSTANCE_ID})
            return
        if path in {"/api/tools/list", "/api/tools/call", "/api/execute", "/api/usage/event",
                    "/api/agent/state", "/api/bridge/shutdown", "/api/ui/claim"} and not self._authed(body):
            self._json({"ok": False, "error": {"code": "unauthorized", "message": "Bad or missing bridge token"}}, 401)
            return
        if path == "/api/agent/state":
            try:
                record_agent(body)
            except ValueError as exc:
                self._json({"ok": False, "message": str(exc)}, 400)
                return
            self._json({"ok": True})
            return
        if path in {"/api/bridge/shutdown", "/api/ui/claim"}:
            if body.get("instance_id") != INSTANCE_ID:
                self._json({"ok": False, "error": {"code": "instance_changed", "message": "The bridge changed. Check its status again."}}, 409)
                return
            if path == "/api/ui/claim":
                global _LAST_UI_OPEN
                with _STATE_LOCK:
                    open_ui = time.monotonic() - _LAST_UI_OPEN > 3
                    if open_ui:
                        _LAST_UI_OPEN = time.monotonic()
                self._json({"ok": True, "open_ui": open_ui})
                return
            with _DEDUP_LOCK, _STATE_LOCK:
                busy = bool(QUEUE) or any(not entry["event"].is_set() for entry in _CALLS.values())
                if not busy:
                    self.server.stopping.set()
            if busy:
                self._json({"ok": False, "error": {"code": "bridge_busy", "message": "A Studio tool is still running. Wait for it to finish before replacing the bridge."}}, 409)
                return
            self._json({"ok": True, "instance_id": INSTANCE_ID, "status": "stopping"})
            threading.Thread(target=self.server.shutdown, name="bridge-shutdown", daemon=True).start()
            return
        if path == "/api/usage/event":
            try:
                result = USAGE.record(body)
            except ValueError as exc:
                self._json({"ok": False, "message": str(exc)}, 400)
                return
            except OSError:
                self._json({"ok": False, "message": "Usage statistics could not be saved"}, 503)
                return
            self._json(result)
            return
        if path == "/api/tools/list":
            offline = _tool_offline()
            if offline:
                self._json(offline, 503)
                return
            try:
                tools = _tool_catalog(refresh=True)
            except Exception as exc:
                self._json({"ok": False, "error": {"code": "tools_list_failed", "message": str(exc)}, "instance_id": INSTANCE_ID}, 502)
                return
            self._json({"ok": True, "tools": tools, "instance_id": INSTANCE_ID})
            return
        if path == "/api/tools/call":
            name, args, call_id = body.get("name"), body.get("arguments", {}), body.get("call_id")
            if not isinstance(name, str) or not name or len(name) > 200:
                self._json({"ok": False, "error": {"code": "invalid_name", "message": "Tool name must be a non-empty string up to 200 characters"}}, 400)
                return
            if not isinstance(args, dict):
                self._json({"ok": False, "error": {"code": "invalid_arguments", "message": "arguments must be an object"}}, 400)
                return
            if not isinstance(call_id, str) or not call_id or len(call_id) > 128 or not re.fullmatch(r"[\w.:/-]+", call_id):
                self._json({"ok": False, "error": {"code": "invalid_call_id", "message": "call_id must be 1-128 safe characters"}}, 400)
                return
            fingerprint = _call_fingerprint(name, args)
            with _DEDUP_LOCK:
                prior = _CALLS.get(call_id)
                if prior and prior["fingerprint"] != fingerprint:
                    self._json({"ok": False, "error": {"code": "call_id_conflict", "message": "call_id was already used with different content"}}, 409)
                    return
            if prior:
                if not prior["event"].wait(65.0):
                    self._json({"ok": False, "error": {"code": "call_timeout", "message": "The original call is still running"}}, 504)
                    return
                self._json(prior["response"], prior["http"])
                return
            offline = _tool_offline()
            if offline:
                self._json(offline, 503)
                return
            try:
                catalog = _tool_catalog(refresh=not bool(_NATIVE_TOOLS))
            except Exception:
                catalog = []
            tool = next((x for x in catalog if x.get("name") == name), None)
            if tool is None:
                self._json({"ok": False, "error": {"code": "unknown_tool", "message": "Tool is not in the current Studio MCP tools/list"}}, 404)
                return
            reason = _safe_code_arguments(args)
            if reason:
                self._json({"ok": False, "error": {"code": "blocked_by_safe_mode", "message": reason}}, 403)
                return
            owner = False
            with _DEDUP_LOCK:
                entry = _CALLS.get(call_id)
                if entry and entry["fingerprint"] != fingerprint:
                    self._json({"ok": False, "error": {"code": "call_id_conflict", "message": "call_id was already used with different content"}}, 409)
                    return
                if entry is None:
                    if self.server.stopping.is_set():
                        self._json({"ok": False, "error": {"code": "shutting_down", "message": "The bridge is stopping. Start a new session after reconnecting."}}, 503)
                        return
                    entry = {"fingerprint": fingerprint, "event": threading.Event(), "response": None, "http": 200}
                    _CALLS[call_id] = entry
                    owner = True
            if not owner:
                if not entry["event"].wait(65.0):
                    self._json({"ok": False, "error": {"code": "call_timeout", "message": "The original call is still running"}}, 504)
                    return
                self._json(entry["response"], entry["http"])
                return
            try:
                result = _native_call(name, args, timeout=60.0)
                response, http_code = {"ok": True, "result": result, "instance_id": INSTANCE_ID}, 200
                log("native:call", f"{name} completed ({call_id})")
            except Exception as exc:
                timed_out = "timed out" in str(exc).lower()
                response = {"ok": False, "error": {"code": "native_timeout" if timed_out else "native_call_failed",
                                                       "message": str(exc)[:1000]}, "instance_id": INSTANCE_ID}
                http_code = 504 if timed_out else 502
                log("native:call", f"{name} failed ({call_id}): {exc}")
            entry["response"], entry["http"] = response, http_code
            response, http_code = _trim_call_cache(call_id, response)
            entry["event"].set()
            self._json(response, http_code)
            return
        if path == "/api/execute":
            code = body.get("luau", "")
            if not isinstance(code, str):
                self._json({"ok": False, "error": {"code": "invalid_code", "message": "luau must be a string"}}, 400)
                return
            if len(code) > MAX_LUAU:
                self._json({"ok": False, "error": {"code": "code_too_large", "message": f"Code exceeds {MAX_LUAU} characters"}}, 400)
                return
            if not code.strip():
                self._json({"ok": False, "error": {"code": "empty_code", "message": "Code is empty"}}, 400)
                return
            reason = check_safe(code)
            if reason:
                self._json({"ok": False, "error": {"code": "blocked_by_safe_mode", "message": reason}}, 403)
                return
            offline = _tool_offline()
            if offline:
                self._json(offline, 503)
                return
            try:
                catalog = _tool_catalog(refresh=not bool(_NATIVE_TOOLS))
                tool_name, arg_name = _code_tool(catalog)
            except Exception:
                tool_name, arg_name = None, None
            global NEXT_ID
            with _STATE_LOCK:
                if self.server.stopping.is_set():
                    self._json({"ok": False, "error": {"code": "shutting_down", "message": "The bridge is stopping. Reconnect before running code."}}, 503)
                    return
                jid = NEXT_ID
                NEXT_ID += 1
                QUEUE.append({"id": jid, "ts": time.time(), "src": "api"})
            worker = threading.Thread(target=_run_manual_job, args=(jid, code, tool_name, arg_name), daemon=True)
            worker.start()
            self._json({"id": jid, "instance_id": INSTANCE_ID})
            return
        self._json({"ok": False, "error": {"code": "not_found", "message": "Route not found"}}, 404)


class BridgeServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = os.name != "nt"

    def __init__(self, *args, **kwargs):
        self.stopping = threading.Event()
        super().__init__(*args, **kwargs)

    def server_bind(self):
        # SO_REUSEADDR permits duplicate listeners on Windows. The bridge must
        # exclusively own its port, including launches outside run.bat.
        if os.name == "nt" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

    def server_close(self):
        try:
            stop_native_client()
        finally:
            super().server_close()


def _load_token(explicit: str = "") -> str:
    if explicit:
        return explicit
    token_path = Path(__file__).with_name("token.txt")
    try:
        previous = token_path.read_text(encoding="utf-8").strip()
        if previous:
            return previous
    except OSError:
        pass
    token = secrets.token_hex(32)
    try:
        token_path.write_text(token, encoding="utf-8")
    except OSError:
        pass
    return token


def existing_bridge(port: int) -> Optional[dict]:
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(f"http://127.0.0.1:{port}/api/status", timeout=2) as response:
            info = json.loads(response.read(MAX_BODY))
        if (isinstance(info, dict) and info.get("online") is True
                and info.get("studio_mode") == "native_mcp"
                and info.get("service", "miracle-mcp") == "miracle-mcp"):
            return info
    except (OSError, ValueError):
        pass
    return None


def main(argv=None):
    global TOKEN, SAFE, ALLOW_ASSETS, START, USAGE
    parser = argparse.ArgumentParser(description="Miracles MCP local bridge")
    parser.add_argument("--port", type=int, default=19731)
    parser.add_argument("--token", default="")
    parser.add_argument("--no-safe", action="store_true")
    parser.add_argument("--allow-assets", default="")
    args = parser.parse_args(argv)
    USAGE = UsageStats(Path(__file__).resolve().parents[1] / ".mcp_cache" / "usage-stats.json")
    SAFE = not args.no_safe
    ALLOW_ASSETS = {a.strip() for a in args.allow_assets.split(",") if a.strip().isdigit()}
    START = time.time()
    try:
        server = BridgeServer(("127.0.0.1", args.port), H)
    except OSError as exc:
        if exc.errno != errno.EADDRINUSE and getattr(exc, "winerror", None) not in {10048, 10013}:
            raise
        running = existing_bridge(args.port)
        if running and running.get("version") == VERSION:
            print(f"[miracles-mcp] reusing v{VERSION} at http://127.0.0.1:{args.port}/app", flush=True)
            return 0
        raise SystemExit(f"Port {args.port} is occupied. Run run.bat to replace a previous Miracle bridge; another application will not be stopped.") from None
    # Only the process that owns the port may create credentials. Two
    # simultaneous launches cannot race while writing token.txt.
    TOKEN = _load_token(args.token)
    print(f"[miracles-mcp] v{VERSION} native Studio MCP bridge at http://127.0.0.1:{server.server_port}")
    print(f"[miracles-mcp] dashboard: http://127.0.0.1:{server.server_port}/app")
    print(f"[miracles-mcp] safe mode: {'ON' if SAFE else 'OFF'}")
    start_native_monitor()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
