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
    code = "native_call_failed"


class StudioMCPTimeout(StudioMCPError):
    code = "native_timeout"


class StudioMCPDisconnected(StudioMCPError):
    pass


class StudioMCPOutcomeUnknown(StudioMCPError):
    """A dispatched tool may have changed Studio; never retry it as a new call."""
    code = "outcome_unknown"

    def __init__(self, message, client, request_id, *, pending):
        super().__init__(message)
        self.client, self.request_id, self.pending = client, request_id, pending

    def resolve(self, timeout=0.25):
        return self.client.wait_for_pending(self.request_id, timeout=timeout)


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
        self._writer: Optional[threading.Thread] = None
        self._pending_request: Optional[int] = None
        self._operation_deadline: Optional[float] = None
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
        except (OSError, ValueError):
            pass
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

    def _write_message(self, proc, message: dict, deadline: float) -> None:
        """Pipe writes can block on Windows too; kill only our child on expiry."""
        encoded = json.dumps(message, separators=(",", ":")) + "\n"
        done, errors = threading.Event(), []

        def write():
            try:
                proc.stdin.write(encoded)
                proc.stdin.flush()
            except (OSError, ValueError) as exc:
                errors.append(exc)
            finally:
                done.set()

        if time.monotonic() >= deadline:
            raise StudioMCPTimeout("Timed out before writing to Studio MCP")
        self._writer = threading.Thread(target=write, name="studio-mcp-writer", daemon=True)
        self._writer.start()
        if not done.wait(max(0, deadline - time.monotonic())):
            # Termination releases a writer blocked on a full pipe. Do not try
            # to close its TextIOWrapper while it still owns the stream lock.
            try:
                proc.kill()
            except OSError:
                pass
            self._writer.join(timeout=0.2)
            raise StudioMCPTimeout("Timed out writing to Studio MCP")
        if errors:
            raise StudioMCPDisconnected(f"Could not write to Studio MCP: {errors[0]}")

    def _read_response(self, rid: int, method: str, deadline: float) -> dict:
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise StudioMCPTimeout(f"Timed out waiting for Studio MCP method {method}")
            try:
                response = self._responses.get(timeout=remaining)
            except Empty as exc:
                raise StudioMCPTimeout(f"Timed out waiting for Studio MCP method {method}") from exc
            if response is None:
                raise StudioMCPDisconnected("Studio MCP closed its stdout")
            if response.get("id") != rid:
                continue
            if "error" in response:
                err = response["error"]
                detail = err.get("message", err) if isinstance(err, dict) else err
                raise StudioMCPError(f"Studio MCP {method} failed: {detail}")
            return response.get("result", {})

    def _request(self, method: str, params: dict, timeout: Optional[float] = None) -> dict:
        proc = self.proc
        if proc is None or proc.poll() is not None:
            raise StudioMCPError("Studio MCP process is not running")
        self._id += 1
        rid = self._id
        request = {"jsonrpc": "2.0", "id": rid, "method": method, "params": params}
        deadline = time.monotonic() + (self.timeout if timeout is None else max(0.001, timeout))
        if self._operation_deadline is not None:
            deadline = min(deadline, self._operation_deadline)
        try:
            self._write_message(proc, request, deadline)
        except StudioMCPError as exc:
            if method == "tools/call":
                raise StudioMCPOutcomeUnknown(str(exc), self, rid, pending=False) from exc
            raise
        try:
            return self._read_response(rid, method, deadline)
        except (StudioMCPTimeout, StudioMCPDisconnected) as exc:
            if method == "tools/call":
                pending = isinstance(exc, StudioMCPTimeout)
                self._pending_request = rid if pending else None
                raise StudioMCPOutcomeUnknown(str(exc), self, rid, pending=pending) from exc
            raise

    def wait_for_pending(self, request_id: int, *, timeout: float = 0.25) -> dict:
        """Collect a late response without sending tools/call a second time."""
        deadline = time.monotonic() + timeout
        if not self._lock.acquire(timeout=max(0, timeout)):
            raise StudioMCPOutcomeUnknown("Studio MCP is still busy", self, request_id, pending=True)
        try:
            if self._pending_request != request_id:
                raise StudioMCPOutcomeUnknown("The original Studio result is unavailable", self, request_id, pending=False)
            try:
                result = self._read_response(request_id, "tools/call", deadline)
            except StudioMCPTimeout as exc:
                raise StudioMCPOutcomeUnknown(str(exc), self, request_id, pending=True) from exc
            except StudioMCPDisconnected as exc:
                self._pending_request = None
                self._state, self.last_error = "error", str(exc)
                raise StudioMCPOutcomeUnknown(str(exc), self, request_id, pending=False) from exc
            except StudioMCPError:
                self._pending_request = None
                self._state = "error"
                raise
            self._pending_request = None
            self.last_error = None
            self._state, self._message = "ready", "Roblox Studio MCP is ready"
            return result
        finally:
            self._lock.release()

    def start_if_needed(self) -> dict:
        with self._lock:
            if self._pending_request is not None and self.proc is not None and self.proc.poll() is None:
                return self.status()
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
        deadline = time.monotonic() + self.timeout
        while True:
            params = {"cursor": cursor} if cursor is not None else {}
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise StudioMCPTimeout("Timed out listing Studio MCP tools")
            result = self._request("tools/list", params, timeout=remaining)
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
        deadline = time.monotonic() + self.timeout
        if self._operation_deadline is not None:
            deadline = min(deadline, self._operation_deadline)
        self._write_message(self.proc, {"jsonrpc": "2.0", "method": method}, deadline)

    def status(self) -> dict:
        return {"bridge": "running", "state": self._state, "ready": self._state == "ready",
                "executable": str(self.executable) if self.executable else None,
                "studio_running": self._studio_running, "tools_count": len(self.tools),
                "message": self._message, "error": self.last_error}

    def list_tools(self) -> list[dict]:
        if not self._lock.acquire(timeout=self.timeout):
            raise StudioMCPTimeout("Studio MCP is busy; the tool catalog was not requested")
        try:
            if self._pending_request is not None:
                raise StudioMCPError("A Studio tool has an unconfirmed outcome; check its original result")
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
        finally:
            self._lock.release()

    def call_tool(self, name: str, arguments: Optional[dict] = None, *, timeout: Optional[float] = None) -> dict:
        budget = max(0.001, timeout if timeout is not None else
                     (60.0 if name.lower() in {"run_code", "run_luau", "run_lua"} else self.timeout))
        deadline = time.monotonic() + budget
        if not self._lock.acquire(timeout=budget):
            raise StudioMCPTimeout("Timed out waiting for the Studio MCP call queue; the tool was not sent")
        self._operation_deadline = deadline
        try:
            if self._pending_request is not None:
                raise StudioMCPError("A Studio tool has an unconfirmed outcome; this tool was not sent")
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
                raise StudioMCPTimeout("Timed out waiting for the Studio MCP call queue; the tool was not sent")
            try:
                return self._request("tools/call", {"name": name, "arguments": arguments or {}}, timeout=remaining)
            except StudioMCPOutcomeUnknown as exc:
                self.last_error = str(exc)
                self._state = "outcome_unknown" if exc.pending else "error"
                self._message = "A Studio tool may still be running. Check its original result before retrying."
                raise
            except StudioMCPError as exc:
                self.last_error = str(exc)
                self._state = "error"
                raise
        finally:
            self._operation_deadline = None
            self._lock.release()

    def close(self) -> None:
        # Interrupt I/O before acquiring the call lock. Waiting for that lock
        # first would make forced shutdown depend on an unresponsive child.
        proc = self.proc
        if proc is not None:
            try:
                proc.terminate()
            except (OSError, AttributeError):
                pass
        with self._lock:
            proc, self.proc = self.proc, None
            if proc is not None:
                try:
                    proc.terminate()
                    proc.wait(timeout=1)
                except Exception:
                    try:
                        proc.kill()
                        proc.wait(timeout=1)
                    except Exception:
                        pass
                if self._writer:
                    self._writer.join(timeout=0.2)
                for stream in (getattr(proc, "stdin", None), getattr(proc, "stdout", None), getattr(proc, "stderr", None)):
                    try:
                        if stream and not (stream is getattr(proc, "stdin", None) and self._writer and self._writer.is_alive()):
                            stream.close()
                    except Exception:
                        pass
                for thread in (self._reader, self._stderr):
                    if thread and thread is not threading.current_thread():
                        thread.join(timeout=0.2)
            self.tools = [] if self._state != "ready" else self.tools
            self._pending_request = None
