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
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from queue import Empty, Queue
from typing import Any, Callable, Optional

try:
    from .studio_mcp import StudioMCP, StudioMCPError, StudioMCPOutcomeUnknown, StudioMCPTimeout
    from .usage_stats import UsageStats
except ImportError:  # direct execution: python python/mcp_server.py
    from studio_mcp import StudioMCP, StudioMCPError, StudioMCPOutcomeUnknown, StudioMCPTimeout
    from usage_stats import UsageStats

VERSION = "2.9.3"
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
TOOL_TIMEOUT = 60.0
MAX_TOOL_JOBS = 8
MAX_CALL_HISTORY = 4096
MAX_CACHED_RESULTS = 128
MAX_CACHED_RESULT_BYTES = 2_000_000
MAX_CACHED_BYTES = 8_000_000
HTTP_TIMEOUT = 10.0
MAX_HTTP_REQUESTS = 32
BLOCKED = [
    (re.compile(r":\s*Kick\s*\("), "Player:Kick"),
    (re.compile(r"BanAsync"), "Players:BanAsync"),
    (re.compile(r"game\s*:\s*Shutdown"), "game:Shutdown"),
    (re.compile(r"\brequire\b"), "require (dynamic module load)"),
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
_CACHED_CALLS: OrderedDict[str, int] = OrderedDict()
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
    if not isinstance(state, str) or state not in {"starting", "watching", "waiting_json", "running", "sending_result", "paused", "stopped"}:
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
        raise StudioMCPOutcomeUnknown("Studio MCP returned a malformed tool result", client, None, pending=False)
    return result


def _call_fingerprint(name: str, arguments: dict) -> str:
    raw = json.dumps({"name": name, "arguments": arguments}, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _trim_call_cache(call_id: str, response: dict) -> tuple[dict, int]:
    """Bound cached bytes, preserving the original response for its first caller.

    The ledger itself is capped on admission. Never evict a call ID and silently
    permit it to execute again; a full ledger requires an idle bridge restart.
    """
    with _DEDUP_LOCK:
        current = _CALLS[call_id]
        original_http = current["http"]
        for key in list(_CACHED_CALLS):
            if key not in _CALLS:
                del _CACHED_CALLS[key]
        _CACHED_CALLS.pop(call_id, None)
        current_size = len(json.dumps(response, ensure_ascii=False).encode("utf-8"))
        if current_size > MAX_CACHED_RESULT_BYTES:
            current["response"] = _error("result_expired", "The tool completed but its result exceeds the replay cache limit. Check Studio; do not execute it again.", completed=True)
            current["http"] = 410
            current["expired"] = True
        else:
            _CACHED_CALLS[call_id] = current_size
        cached_bytes = sum(_CACHED_CALLS.values())
        while len(_CACHED_CALLS) > MAX_CACHED_RESULTS or cached_bytes > MAX_CACHED_BYTES:
            key, size = _CACHED_CALLS.popitem(last=False)
            entry = _CALLS[key]
            entry["response"] = _error("result_expired", "The tool completed but its cached result has expired. Check Studio; do not execute it again.", completed=True)
            entry["http"] = 410
            entry["expired"] = True
            cached_bytes -= size
        return response, original_http


def _error(code: str, message: str, **details) -> dict:
    return {"ok": False, "error": {"code": code, "message": message}, "instance_id": INSTANCE_ID, **details}


def _unconfirmed(call_id: str, *, pending=True) -> dict:
    return _error("outcome_unknown", "This action may already have run. Check its original result before retrying; do not issue a new call ID.",
                  call_id=call_id, outcome_unknown=True, pending=pending)


class ToolJobQueue:
    """One lazy worker with a bounded number of running and queued jobs."""
    def __init__(self, capacity=MAX_TOOL_JOBS):
        self.stopping = threading.Event()
        self._queue = Queue(maxsize=capacity)
        self._slots = threading.BoundedSemaphore(capacity)
        self._lock = threading.Lock()
        self._worker = None

    def submit(self, run, cancel) -> bool:
        with self._lock:
            if self.stopping.is_set() or not self._slots.acquire(blocking=False):
                return False
            self._queue.put_nowait((run, cancel))
            if self._worker is None:
                self._worker = threading.Thread(target=self._run, name="studio-tool-jobs", daemon=True)
                self._worker.start()
            return True

    def _run(self):
        while not self.stopping.is_set():
            try:
                run, cancel = self._queue.get(timeout=0.2)
            except Empty:
                continue
            try:
                cancel() if self.stopping.is_set() else run()
            except Exception as exc:
                log("native", f"Tool worker failed: {exc}")
                cancel()
            finally:
                self._slots.release()

    def close(self):
        with self._lock:
            self.stopping.set()
        while True:
            try:
                _, cancel = self._queue.get_nowait()
            except Empty:
                break
            try:
                cancel()
            finally:
                self._slots.release()
        if self._worker and self._worker is not threading.current_thread():
            self._worker.join(timeout=1)


def _manual_result(entry: dict, response: dict, elapsed: int) -> dict:
    jid = entry["job_id"]
    result = response.get("result", {})
    is_error = bool(result.get("isError"))
    ok = response.get("ok") is True and not is_error
    content = result.get("content") if isinstance(result.get("content"), list) else []
    text_parts = [item.get("text") for item in content if isinstance(item, dict) and isinstance(item.get("text"), str)]
    if not response.get("ok"):
        output = response["error"]["message"]
    elif text_parts:
        output = "\n".join(text_parts)
    else:
        output = json.dumps(result.get("structuredContent", result), ensure_ascii=False)
    row = {"id": jid, "call_id": entry["call_id"], "ok": ok, "output": output[:2000], "elapsed_ms": elapsed, "at": now()}
    if response.get("ok"):
        row["isError"] = is_error
    if response.get("outcome_unknown"):
        row.update(code="outcome_unknown", outcome_unknown=True)
    return row


def _record_manual_result(entry: dict, response: dict, elapsed: int) -> None:
    row = _manual_result(entry, response, elapsed)
    with _STATE_LOCK:
        RESULTS.append(row)
        del RESULTS[:-50]
        QUEUE[:] = [j for j in QUEUE if j["id"] != row["id"]]
    log("native:execute", f"result #{row['id']}: {'OK' if row['ok'] else 'ERR'} {row['output'][:500]}")


def _finish_job(call_id: str, entry: dict, response: dict, http_code: int, started: float, delivery=None) -> None:
    entry["elapsed_ms"] = int((time.monotonic() - started) * 1000)
    if entry.get("job_id") is not None:
        _record_manual_result(entry, response, entry["elapsed_ms"])
    entry["response"], entry["http"] = response, http_code
    original, original_http = _trim_call_cache(call_id, response)
    entry.pop("pending_response", None)
    entry["event"].set()
    if delivery is not None and not entry.get("replied"):
        entry["replied"] = True
        delivery.put_nowait((original, original_http))


def _cancel_tool_job(call_id, entry, delivery):
    if entry["event"].is_set():
        return
    response = (_unconfirmed(call_id, pending=False) if entry.get("started") else
                _error("shutting_down", "The bridge stopped before this tool was sent", not_sent=True))
    _finish_job(call_id, entry, response, 504 if entry.get("started") else 503, time.monotonic(), delivery)


def _run_tool_job(server, call_id: str, entry: dict, name: str, arguments: dict, delivery=None) -> None:
    started = time.monotonic()
    response, http_code = None, 200
    try:
        if server.jobs.stopping.is_set():
            _cancel_tool_job(call_id, entry, delivery)
            return
        remaining = entry["deadline"] - time.monotonic()
        if remaining <= 0:
            raise StudioMCPTimeout("Timed out in the bridge queue; the tool was not sent")
        entry["started"] = True
        result = _native_call(name, arguments, timeout=remaining)
    except StudioMCPOutcomeUnknown as exc:
        entry["pending_response"] = _unconfirmed(call_id, pending=exc.pending)
        if delivery is not None:
            entry["replied"] = True
            delivery.put_nowait((entry["pending_response"], 504))
            delivery = None
        while exc.pending and not server.jobs.stopping.is_set():
            try:
                result = exc.resolve(timeout=0.25)
                break
            except StudioMCPOutcomeUnknown as late:
                exc = late
            except Exception as late:
                response, http_code = _error(getattr(late, "code", "native_call_failed"), str(late)[:1000]), 502
                break
        else:
            response, http_code = _unconfirmed(call_id, pending=False), 504
    except Exception as exc:
        code = getattr(exc, "code", "native_call_failed")
        response = _error(code, str(exc)[:1000], not_sent=isinstance(exc, StudioMCPTimeout))
        http_code = 504 if isinstance(exc, StudioMCPTimeout) else 502
    if response is None:
        if isinstance(result, dict):
            response = {"ok": True, "result": result, "instance_id": INSTANCE_ID}
        else:
            response, http_code = _unconfirmed(call_id, pending=False), 502
    _finish_job(call_id, entry, response, http_code, started, delivery)
    log("native:call", f"{name} {'completed' if response.get('ok') else 'unconfirmed' if response.get('outcome_unknown') else 'failed'} ({call_id})")


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
    server_version = "ArgonMCP/" + VERSION
    APP_ROOT = resolve_app_root()
    STATIC_EXTS = {
        ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
        ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2",
        ".lua": "text/plain; charset=utf-8", ".ico": "image/x-icon",
    }

    def setup(self):
        super().setup()
        self.connection.settimeout(self.server.request_timeout)

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
        if (not _host_loopback(self.headers.get("Host", ""), self.server.server_port)
                or not _trusted_origin(self.headers.get("Origin"), self.server.server_port)):
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
        try:
            self.send_response(code)
            self._cors()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass  # The job/result remains available when a caller disconnects.

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
        deadline = time.monotonic() + self.server.request_timeout
        try:
            chunks, remaining = [], length
            while remaining:
                budget = deadline - time.monotonic()
                if budget <= 0:
                    raise TimeoutError()
                self.connection.settimeout(budget)
                chunk = self.rfile.read1(min(65536, remaining))
                if not chunk:
                    return None, {"code": "invalid_json", "message": "Request body was incomplete"}
                chunks.append(chunk)
                remaining -= len(chunk)
            def reject_constant(_):
                raise ValueError("Non-finite JSON number")
            value = json.loads(b"".join(chunks) or b"{}", parse_constant=reject_constant)
        except TimeoutError:
            return None, {"code": "request_timeout", "message": "Request body did not arrive before its deadline"}
        except (ValueError, OSError, UnicodeDecodeError, RecursionError):
            return None, {"code": "invalid_json", "message": "Request body must be valid JSON"}
        finally:
            self.connection.settimeout(self.server.request_timeout)
        if not isinstance(value, dict):
            return None, {"code": "invalid_json", "message": "Request body must be a JSON object"}
        return value, None

    def _authed(self, body) -> bool:
        try:
            return bool(TOKEN) and isinstance(body, dict) and secrets.compare_digest(str(body.get("token", "")), TOKEN)
        except TypeError:
            return False

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

    def _reply_job(self, call_id, entry, *, manual=False, delivery=None):
        if manual:
            acknowledgement = {"id": entry["job_id"], "call_id": call_id, "instance_id": INSTANCE_ID}
            if entry["event"].is_set():
                response = entry["response"]
                if not response.get("ok"):
                    self._json(response, entry["http"])
                    return
                acknowledgement["completion"] = _manual_result(entry, response, entry["elapsed_ms"])
            self._json(acknowledgement)
            return
        if delivery is not None:
            try:
                response, http_code = delivery.get(timeout=TOOL_TIMEOUT + 1)
                self._json(response, http_code)
                return
            except Empty:
                pass
        elif not entry.get("pending_response"):
            entry["event"].wait(TOOL_TIMEOUT + 1)
        if entry["event"].is_set():
            self._json(entry["response"], entry["http"])
        else:
            self._json(entry.get("pending_response") or _unconfirmed(call_id), 504)

    def _dispatch_tool(self, body, *, manual=False):
        """Manual code and chat tools share admission, idempotency and workers."""
        global NEXT_ID
        call_id = body.get("call_id")
        if manual and call_id is None:
            # Compatibility for older manual clients. The current workspace
            # always supplies a stable ID before its first network request.
            call_id = "manual:" + secrets.token_hex(16)
        if not isinstance(call_id, str) or not call_id or len(call_id) > 128 or not re.fullmatch(r"[\w.:/-]+", call_id):
            self._json(_error("invalid_call_id", "call_id must be 1-128 safe characters"), 400)
            return
        if manual:
            code = body.get("luau", "")
            if not isinstance(code, str):
                self._json(_error("invalid_code", "luau must be a string"), 400)
                return
            if len(code) > MAX_LUAU:
                self._json(_error("code_too_large", f"Code exceeds {MAX_LUAU} characters"), 400)
                return
            if not code.strip():
                self._json(_error("empty_code", "Code is empty"), 400)
                return
            fingerprint = _call_fingerprint("/api/execute", {"luau": code})
        else:
            name, args = body.get("name"), body.get("arguments", {})
            if not isinstance(name, str) or not name or len(name) > 200:
                self._json(_error("invalid_name", "Tool name must be a non-empty string up to 200 characters"), 400)
                return
            if not isinstance(args, dict):
                self._json(_error("invalid_arguments", "arguments must be an object"), 400)
                return
            fingerprint = _call_fingerprint("/api/tools/call:" + name, args)
        with _DEDUP_LOCK:
            prior = _CALLS.get(call_id)
        if prior:
            if prior["fingerprint"] != fingerprint:
                self._json(_error("call_id_conflict", "call_id was already used with different content"), 409)
            else:
                self._reply_job(call_id, prior, manual=manual)
            return
        offline = _tool_offline()
        if offline:
            self._json(offline, 503)
            return
        try:
            catalog = _tool_catalog(refresh=not bool(_NATIVE_TOOLS))
        except Exception as exc:
            self._json(_error("tools_list_failed", str(exc)[:1000]), 502)
            return
        if manual:
            name, arg_name = _code_tool(catalog)
            if not name or not arg_name:
                self._json(_error("unsupported_code_tool", "Studio does not advertise a supported code execution tool"), 400)
                return
            args = {arg_name: code}
        elif not any(tool.get("name") == name for tool in catalog):
            self._json(_error("unknown_tool", "Tool is not in the current Studio MCP tools/list"), 404)
            return
        reason = _safe_code_arguments(args)
        if reason:
            self._json(_error("blocked_by_safe_mode", reason), 403)
            return
        delivery = None if manual else Queue(maxsize=1)
        with _DEDUP_LOCK, _STATE_LOCK:
            entry = _CALLS.get(call_id)
            owner = entry is None
            if entry is not None and entry["fingerprint"] != fingerprint:
                admission_error = (_error("call_id_conflict", "call_id was already used with different content"), 409)
            elif entry is not None:
                admission_error = None
            elif self.server.stopping.is_set():
                admission_error = (_error("shutting_down", "The bridge is stopping. Reconnect before running a tool."), 503)
            elif len(_CALLS) >= MAX_CALL_HISTORY:
                admission_error = (_error("call_history_full", "Call history is full. Restart the idle bridge before starting a new session; old calls cannot replay."), 429)
            else:
                entry = {"fingerprint": fingerprint, "call_id": call_id, "event": threading.Event(), "response": None, "http": 200,
                         "deadline": time.monotonic() + TOOL_TIMEOUT, "created_at": time.time(), "started": False}
                if manual:
                    entry["job_id"] = NEXT_ID
                _CALLS[call_id] = entry
                cancel = lambda: _cancel_tool_job(call_id, entry, delivery)
                if not self.server.jobs.submit(lambda: _run_tool_job(self.server, call_id, entry, name, args, delivery), cancel):
                    del _CALLS[call_id]
                    admission_error = (_error("queue_full", "The Studio tool queue is full. Wait for a result before retrying.", not_sent=True), 429)
                else:
                    admission_error = None
                    if manual:
                        QUEUE.append({"id": NEXT_ID, "ts": time.time(), "src": "api"})
                        NEXT_ID += 1
        if admission_error:
            self._json(*admission_error)
            return
        self._reply_job(call_id, entry, manual=manual, delivery=delivery if owner else None)

    def _status(self, include_details=False):
        with _DEDUP_LOCK, _STATE_LOCK:
            pending = [entry for entry in _CALLS.values() if not entry["event"].is_set()]
            oldest = max((time.time() - entry.get("created_at", time.time()) for entry in pending), default=0)
            queue_count = len(pending)
            recent = RECENT[-15:][::-1]
            results = RESULTS[-50:][::-1]
        native = _status_native()
        if not include_details:
            native = {key: native.get(key) for key in ("bridge", "state", "ready", "studio_running", "tools_count")}
        data = {"online": True, "service": "argon-mcp", "pid": os.getpid(), "version": VERSION, "instance_id": INSTANCE_ID,
                "queue": queue_count, "oldest_pending_s": int(oldest), "stale": oldest > 120,
                "studio_mode": "native_mcp", "studio_linked": native.get("state") == "ready",
                "native_mcp": native, "uptime_s": int(time.time() - START), "port": self.server.server_port,
                "auth": True, "safe": SAFE, "capabilities": ["agent_status", "graceful_shutdown", "single_instance"]}
        if include_details:
            data.update(results=results, recent=recent, allowlist=sorted(ALLOW_ASSETS, key=int),
                        usage=USAGE.snapshot(), agent_sessions=agent_sessions())
        self._json(data)

    def do_GET(self):
        if not _host_loopback(self.headers.get("Host", ""), self.server.server_port):
            self._json({"ok": False, "error": {"code": "untrusted_host", "message": "A loopback Host on this port is required"}}, 403)
            return
        path = urllib.parse.urlparse(self.path).path
        if path in ("/", "/app", "/app/", "/ui", "/ui/", "/ui/index.html", "/ui/launcher.html",
                    "/ui/page.html", "/ui/miracles_true_apple_liquid_glass.html"):
            self.send_response(302)
            self.send_header("Location", "/ui/dashboard.html")
            self.end_headers()
        elif path.startswith("/ui/"):
            self._static(path[4:])
        elif path == "/api/status":
            self._status()
        else:
            self._json({"error": "not found"}, 404)

    def do_POST(self):
        if not _host_loopback(self.headers.get("Host", ""), self.server.server_port):
            self._json({"ok": False, "error": {"code": "untrusted_host", "message": "A loopback Host on this port is required"}}, 403)
            return
        path = urllib.parse.urlparse(self.path).path
        if path in {"/api/poll", "/api/result", "/api/chat"}:
            self._json({"ok": False, "error": {"code": "removed", "message": "This route is no longer supported"}}, 410)
            return
        # Never return credentials over HTTP. An extension with network-header
        # privileges can forge an otherwise trusted Origin.
        if path == "/api/bootstrap":
            self._json({"ok": False, "error": {"code": "pairing_required", "message": "Copy the token from release/python/token.txt (or python/token.txt in a source checkout) into Connection settings."}}, 403)
            return
        if not _trusted_origin(self.headers.get("Origin"), self.server.server_port):
            self._json({"ok": False, "error": {"code": "untrusted_origin", "message": "Origin is not trusted"}}, 403)
            return
        body, body_error = self._body()
        if body_error:
            self._json({"ok": False, "error": body_error}, 408 if body_error["code"] == "request_timeout" else 400)
            return
        if path == "/api/auth":
            if not self._authed(body):
                self._json({"ok": False, "error": {"code": "unauthorized", "message": "Bad or missing bridge token"}}, 401)
                return
            self._json({"ok": True, "instance_id": INSTANCE_ID})
            return
        if path in {"/api/status", "/api/tools/list", "/api/tools/call", "/api/tools/result", "/api/execute", "/api/usage/event",
                    "/api/agent/state", "/api/bridge/shutdown", "/api/ui/claim"} and not self._authed(body):
            self._json({"ok": False, "error": {"code": "unauthorized", "message": "Bad or missing bridge token"}}, 401)
            return
        if path == "/api/status":
            self._status(include_details=True)
            return
        if path in {"/api/tools/call", "/api/tools/result", "/api/execute"} and body.get("instance_id") != INSTANCE_ID:
            self._json({"ok": False, "error": {"code": "instance_changed", "message": "The bridge changed. Reconnect before running a tool."}}, 409)
            return
        if path == "/api/tools/result":
            call_id = body.get("call_id")
            if not isinstance(call_id, str) or not call_id or len(call_id) > 128:
                self._json(_error("invalid_call_id", "A call_id is required"), 400)
                return
            with _DEDUP_LOCK:
                entry = _CALLS.get(call_id)
            if entry is None:
                self._json(_error("unknown_call", "No call with this ID was accepted by this bridge"), 404)
            elif entry["event"].is_set():
                self._json(entry["response"], entry["http"])
            elif entry.get("started"):
                self._json(entry.get("pending_response") or _unconfirmed(call_id), 202)
            else:
                self._json(_error("call_pending", "The original call is queued; do not send a new call ID", pending=True, not_sent=True), 202)
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
                    open_ui = _LAST_UI_OPEN == 0 or time.monotonic() - _LAST_UI_OPEN > 3
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
        if path in {"/api/tools/call", "/api/execute"}:
            self._dispatch_tool(body, manual=path == "/api/execute")
            return
        self._json({"ok": False, "error": {"code": "not_found", "message": "Route not found"}}, 404)


class BridgeServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = os.name != "nt"
    request_timeout = HTTP_TIMEOUT

    def __init__(self, *args, **kwargs):
        self.stopping = threading.Event()
        self.jobs = ToolJobQueue()
        self._request_slots = threading.BoundedSemaphore(MAX_HTTP_REQUESTS)
        super().__init__(*args, **kwargs)

    def process_request(self, request, client_address):
        if not self._request_slots.acquire(blocking=False):
            try:
                request.settimeout(0.1)
                request.sendall(b"HTTP/1.0 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            except OSError:
                pass
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self._request_slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._request_slots.release()

    def server_bind(self):
        # SO_REUSEADDR permits duplicate listeners on Windows. The bridge must
        # exclusively own its port, including launches outside run.bat.
        if os.name == "nt" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

    def server_close(self):
        try:
            _MONITOR_STOP.set()
            self.stopping.set()
            self.jobs.stopping.set()
            with _NATIVE_LOCK:
                client = _NATIVE_CLIENT
            if client is not None:
                client.close()
            self.jobs.close()
            stop_native_client()
        finally:
            super().server_close()


def _load_token(explicit: str = "") -> str:
    if explicit:
        return explicit
    token_path = Path(__file__).with_name("token.txt")
    try:
        previous = token_path.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        previous = ""
    except OSError as exc:
        raise SystemExit(f"Could not read the local bridge token at {token_path}.") from exc
    if previous:
        if os.name != "nt":
            try:
                token_path.chmod(0o600)
            except OSError as exc:
                raise SystemExit(f"Could not protect the local bridge token at {token_path}.") from exc
        return previous
    token = secrets.token_hex(32)
    try:
        token_path.write_text(token, encoding="utf-8")
        if os.name != "nt":
            token_path.chmod(0o600)
    except OSError as exc:
        raise SystemExit(f"Could not save the local bridge token to {token_path}. Make the release folder writable and try again.") from exc
    return token


def existing_bridge(port: int) -> Optional[dict]:
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(f"http://127.0.0.1:{port}/api/status", timeout=2) as response:
            info = json.loads(response.read(MAX_BODY))
        if (isinstance(info, dict) and info.get("online") is True
                and info.get("studio_mode") == "native_mcp"
                and info.get("service", "miracle-mcp") in {"argon-mcp", "helium-mcp", "miracle-mcp"}):
            return info
    except (OSError, ValueError):
        pass
    return None


def main(argv=None):
    global TOKEN, SAFE, ALLOW_ASSETS, START, USAGE
    parser = argparse.ArgumentParser(description="Argon MCP local bridge")
    parser.add_argument("--port", type=int, default=19731)
    parser.add_argument("--token", default="")
    parser.add_argument("--no-safe", action="store_true")
    parser.add_argument("--allow-assets", default="")
    args = parser.parse_args(argv)
    USAGE = UsageStats(Path(__file__).resolve().parents[1] / ".mcp_cache" / "usage-stats.json")
    if USAGE.recovery_message:
        log("usage", USAGE.recovery_message)
    SAFE = not args.no_safe
    ALLOW_ASSETS = {a.strip() for a in args.allow_assets.split(",") if a.strip().isdigit()}
    START = time.time()
    try:
        server = BridgeServer(("127.0.0.1", args.port), H)
    except OSError as exc:
        if exc.errno != errno.EADDRINUSE and getattr(exc, "winerror", None) not in {10048, 10013}:
            raise
        running = existing_bridge(args.port)
        if running and running.get("version") == VERSION and running.get("service") == "argon-mcp":
            print(f"[argon-mcp] reusing v{VERSION} at http://127.0.0.1:{args.port}/app", flush=True)
            return 0
        raise SystemExit(f"Port {args.port} is occupied. Run run.bat to replace the previous bridge; another application will not be stopped.") from None
    # Only the process that owns the port may create credentials. Two
    # simultaneous launches cannot race while writing token.txt.
    TOKEN = _load_token(args.token)
    print(f"[argon-mcp] v{VERSION} native Studio MCP bridge at http://127.0.0.1:{server.server_port}")
    print(f"[argon-mcp] dashboard: http://127.0.0.1:{server.server_port}/app")
    print(f"[argon-mcp] safe mode: {'ON' if SAFE else 'OFF'}")
    start_native_monitor()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
