"""Small stdio MCP client for Roblox Studio's built-in StudioMCP executable.

This module only discovers and launches Roblox's own executable. It does not
install Studio components or change user settings.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from queue import Queue, Empty
from typing import Any, Callable, Optional


ENV_OVERRIDE = "ZS_STUDIO_MCP_PATH"
PROTOCOL_VERSION = "2024-11-05"


def _candidate_roots() -> list[Path]:
    roots = []
    for key in ("LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"):
        value = os.environ.get(key)
        if value:
            roots.append(Path(value) / "Roblox" / "Versions")
    return roots


def find_studio_mcp() -> Optional[Path]:
    """Return the newest installed StudioMCP binary, or None."""
    override = (os.environ.get("ARGON_STUDIO_MCP_PATH")
                or os.environ.get("HELIUM_STUDIO_MCP_PATH")
                or os.environ.get("MIRACLES_STUDIO_MCP_PATH") or os.environ.get(ENV_OVERRIDE))
    if override:
        path = Path(os.path.expandvars(os.path.expanduser(override)))
        if path.is_file():
            return path
        if path.is_dir():
            candidate = path / "Contents" / "MacOS" / "StudioMCP" if sys.platform == "darwin" else path / "StudioMCP.exe"
            if candidate.is_file():
                return candidate
    candidates: list[Path] = []
    if sys.platform == "darwin":
        home = Path.home()
        for app in (Path("/Applications/RobloxStudio.app"), home / "Applications/RobloxStudio.app",
                    Path("/Applications/Roblox.app"), home / "Applications/Roblox.app",
                    Path("/Applications/RobloxStudioBeta.app"), home / "Applications/RobloxStudioBeta.app"):
            macos = app / "Contents" / "MacOS"
            mcp = macos / "StudioMCP"
            if mcp.is_file() and any((macos / name).is_file() for name in ("RobloxStudio", "RobloxStudioBeta", "Roblox")):
                candidates.append(mcp)
    else:
        for root in _candidate_roots():
            try:
                paired, orphans = [], []
                for version in root.iterdir():
                    mcp = version / "StudioMCP.exe"
                    if not mcp.is_file():
                        continue
                    (paired if any((version / name).is_file() for name in ("RobloxStudioBeta.exe", "RobloxStudio.exe")) else orphans).append(mcp)
                candidates.extend(paired or orphans)
            except OSError:
                continue
    existing = [p for p in candidates if p.is_file()]
    return max(existing, key=lambda p: p.stat().st_mtime, default=None)


def studio_is_running() -> Optional[bool]:
    """Best-effort process check. None means the platform check failed."""
    try:
        if sys.platform == "win32":
            no_window = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
            out = subprocess.run(["tasklist", "/FI", "IMAGENAME eq RobloxStudioBeta.exe", "/FO", "CSV", "/NH"],
                                 capture_output=True, text=True, timeout=2, check=False,
                                 creationflags=no_window).stdout.lower()
            if "robloxstudiobeta.exe" in out:
                return True
            out2 = subprocess.run(["tasklist", "/FI", "IMAGENAME eq RobloxStudio.exe", "/FO", "CSV", "/NH"],
                                  capture_output=True, text=True, timeout=2, check=False,
                                  creationflags=no_window).stdout.lower()
            return "robloxstudio.exe" in out2
        out = subprocess.run(["pgrep", "-f", "RobloxStudio"], capture_output=True, text=True, timeout=2, check=False)
        return out.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return None


class StudioMCPError(RuntimeError):
    pass


class StudioMCP:
    """Synchronous MCP client. status() returns a stable state and details."""

    def __init__(self, executable: Optional[os.PathLike | str] = None, *, command=None, timeout: float = 8.0,
                 process_factory: Callable[..., Any] = subprocess.Popen):
        self.command = list(command) if command else None
        self.executable = Path(executable) if executable and not command else None
        self._auto_discover = not executable and not command
        self.timeout = max(0.1, float(timeout))
        self._popen = process_factory
        self.proc = None
        self.tools: list[dict] = []
        self.last_error: Optional[str] = None
        self._id = 0
        self._lock = threading.RLock()
        self._responses: Queue = Queue()
        self._reader: Optional[threading.Thread] = None
        self._stderr: Optional[threading.Thread] = None
        self._state = "connecting"
        self._message = "Studio MCP connection has not been started"
        self._studio_running: Optional[bool] = None

    def _read_stdout(self, proc, responses):
        try:
            for line in iter(proc.stdout.readline, ""):
                try:
                    message = json.loads(line)
                except (ValueError, TypeError):
                    continue
                if isinstance(message, dict):
                    responses.put(message)
        finally:
            responses.put(None)

    @staticmethod
    def _drain_stderr(stream):
        if stream:
            try:
                for _ in iter(stream.readline, ""):
                    pass
            except Exception:
                pass

    def _request(self, method: str, params: dict, timeout: Optional[float] = None) -> dict:
        proc = self.proc
        if proc is None or proc.poll() is not None:
            raise StudioMCPError("Studio MCP process is not running")
        self._id += 1
        rid = self._id
        request = {"jsonrpc": "2.0", "id": rid, "method": method, "params": params}
        try:
            proc.stdin.write(json.dumps(request, separators=(",", ":")) + "\n")
            proc.stdin.flush()
        except (OSError, BrokenPipeError) as exc:
            raise StudioMCPError(f"Could not write to Studio MCP: {exc}") from exc
        deadline = time.monotonic() + (self.timeout if timeout is None else max(0.1, timeout))
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise StudioMCPError(f"Timed out waiting for Studio MCP method {method}")
            try:
                response = self._responses.get(timeout=remaining)
            except Empty as exc:
                raise StudioMCPError(f"Timed out waiting for Studio MCP method {method}") from exc
            if response is None:
                raise StudioMCPError("Studio MCP closed its stdout")
            if response.get("id") != rid:
                continue
            if "error" in response:
                err = response["error"]
                raise StudioMCPError(f"Studio MCP {method} failed: {err.get('message', err)}")
            return response.get("result", {})

    def start_if_needed(self) -> dict:
        with self._lock:
            if self.proc is not None and self.proc.poll() is None:
                if self._state != "error":
                    try:
                        self._refresh_tools()
                        return self.status()
                    except StudioMCPError as exc:
                        self.last_error = str(exc)
                        self._state = "error"
                        self._message = self.last_error
                self.close()
            exe = self.executable
            if self._auto_discover and (exe is None or not exe.is_file()):
                exe = find_studio_mcp()
            if not self.command and (not exe or not Path(exe).is_file()):
                self._state = "missing"
                self.last_error = "Roblox Studio MCP executable not found (set ARGON_STUDIO_MCP_PATH to its path)"
                self._message = self.last_error
                return self.status()
            self.executable = Path(exe) if exe else None
            try:
                popen_options = {}
                if sys.platform == "win32":
                    popen_options["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
                command = self.command or [str(exe)]
                self.proc = self._popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace", bufsize=1,
                                        **popen_options)
            except OSError as exc:
                self.proc = None
                self.last_error = f"Could not start Studio MCP: {exc}"
                self._state = "error"
                self._message = self.last_error
                return self.status()
            self._responses = Queue()
            responses = self._responses
            self._reader = threading.Thread(target=self._read_stdout, args=(self.proc, responses), daemon=True)
            self._reader.start()
            self._stderr = threading.Thread(target=self._drain_stderr, args=(self.proc.stderr,), daemon=True)
            self._stderr.start()
            try:
                self._request("initialize", {"protocolVersion": PROTOCOL_VERSION, "capabilities": {},
                                              "clientInfo": {"name": "argon-mcp", "version": "1.0"}})
                self._notify("notifications/initialized")
                self._refresh_tools()
            except (StudioMCPError, OSError, ValueError) as exc:
                self.last_error = str(exc)
                self._studio_running = studio_is_running()
                self._state = "studio_closed" if self._studio_running is False else "mcp_disabled"
                self._message = self.last_error
                self.close()
            return self.status()

    def _refresh_tools(self) -> None:
        self.tools = self._list_all_tools()
        self.last_error = None
        self._studio_running = None if self.command else studio_is_running()
        if self.command:
            self._state = "ready" if self.tools else "mcp_disabled"
        elif self.tools and self._studio_running is not False:
            self._state = "ready"
        else:
            self._state = "studio_closed" if self._studio_running is False else "mcp_disabled"
            if self._studio_running is False:
                self.tools = []
        self._message = ("Roblox Studio MCP is ready" if self._state == "ready" else
                         "Roblox Studio is not running" if self._studio_running is False else
                         "Studio MCP returned no tools; Studio process status is unavailable" if self._studio_running is None else
                         "Roblox Studio is open, but MCP is disabled or no place is available")

    def _list_all_tools(self) -> list[dict]:
        """Fetch every page advertised by tools/list, preserving tool objects as-is."""
        tools: list[dict] = []
        cursor = None
        seen_cursors = set()
        while True:
            params = {"cursor": cursor} if cursor is not None else {}
            result = self._request("tools/list", params)
            if not isinstance(result, dict) or not isinstance(result.get("tools", []), list):
                raise StudioMCPError("Studio MCP tools/list returned a malformed tools catalog")
            tools.extend(result.get("tools", []))
            next_cursor = result.get("nextCursor")
            if next_cursor is None:
                return tools
            if not isinstance(next_cursor, str) or not next_cursor or next_cursor in seen_cursors:
                raise StudioMCPError("Studio MCP tools/list returned an invalid or repeated nextCursor")
            seen_cursors.add(next_cursor)
            cursor = next_cursor

    def _notify(self, method: str) -> None:
        if self.proc is None:
            return
        self.proc.stdin.write(json.dumps({"jsonrpc": "2.0", "method": method}, separators=(",", ":")) + "\n")
        self.proc.stdin.flush()

    def status(self) -> dict:
        return {"bridge": "running", "state": self._state, "ready": self._state == "ready",
                "executable": str(self.executable) if self.executable else None,
                "studio_running": self._studio_running, "tools_count": len(self.tools),
                "message": self._message, "error": self.last_error}

    def list_tools(self) -> list[dict]:
        with self._lock:
            if self._state == "error":
                self.close()
            if self.proc is None or self.proc.poll() is not None:
                self.start_if_needed()
            elif self._state != "ready":
                try:
                    self._refresh_tools()
                except StudioMCPError as exc:
                    self.last_error = str(exc)
            if self._state == "ready":
                try:
                    self.tools = self._list_all_tools()
                except StudioMCPError as exc:
                    self.last_error = str(exc)
                    self._state = "error"
            return list(self.tools)

    def call_tool(self, name: str, arguments: Optional[dict] = None, *, timeout: Optional[float] = None) -> dict:
        budget = max(0.1, timeout if timeout is not None else
                     (60.0 if name.lower() in {"run_code", "run_luau", "run_lua"} else self.timeout))
        deadline = time.monotonic() + budget
        if not self._lock.acquire(timeout=budget):
            raise StudioMCPError("Timed out waiting for the Studio MCP call queue; the tool was not sent")
        try:
            if self._state == "error":
                self.close()
            if self.proc is None or self.proc.poll() is not None:
                self.start_if_needed()
            elif self._state != "ready":
                try:
                    self._refresh_tools()
                except StudioMCPError as exc:
                    self.last_error = str(exc)
            if self._state != "ready":
                raise StudioMCPError(self.last_error or f"Studio MCP is not ready ({self._state})")
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise StudioMCPError("Timed out waiting for the Studio MCP call queue; the tool was not sent")
            try:
                return self._request("tools/call", {"name": name, "arguments": arguments or {}}, timeout=remaining)
            except StudioMCPError as exc:
                self.last_error = str(exc)
                self._state = "error"
                raise
        finally:
            self._lock.release()

    def close(self) -> None:
        with self._lock:
            proc, self.proc = self.proc, None
            if proc is not None:
                try:
                    proc.terminate()
                    proc.wait(timeout=1)
                except Exception:
                    try:
                        proc.kill()
                    except Exception:
                        pass
                for stream in (getattr(proc, "stdin", None), getattr(proc, "stdout", None), getattr(proc, "stderr", None)):
                    try:
                        if stream:
                            stream.close()
                    except Exception:
                        pass
                for thread in (self._reader, self._stderr):
                    if thread and thread is not threading.current_thread():
                        thread.join(timeout=0.2)
            self.tools = [] if self._state != "ready" else self.tools
