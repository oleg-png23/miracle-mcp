import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
spec = importlib.util.spec_from_file_location("bridge_under_test", Path(__file__).with_name("mcp_server.py"))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class FakeNativeClient:
    def __init__(self, state="ready"):
        self.state = state
        self.calls = []
        self.closed = False
        self.delay = 0
        self.tools = [
            {"name": "run_code", "description": "Run Luau", "inputSchema": {
                "type": "object", "properties": {"code": {"type": "string"}}, "required": ["code"]}},
            {"name": "echo", "description": "Echo test", "inputSchema": {"type": "object", "properties": {}}},
        ]

    def status(self):
        ready = self.state == "ready"
        return {"bridge": "running", "state": self.state, "ready": ready,
                "tools_count": len(self.tools) if ready else 0, "message": "fake native status", "error": None}

    def start_if_needed(self):
        return self.status()

    def list_tools(self):
        return self.tools if self.state == "ready" else []

    def call_tool(self, name, arguments=None, *, timeout=None):
        self.calls.append((name, arguments, timeout))
        if self.delay:
            time.sleep(self.delay)
        if name == "echo" and (arguments or {}).get("fail"):
            return {"content": [{"type": "text", "text": "tool failed"}], "isError": True}
        return {"content": [{"type": "text", "text": json.dumps(arguments or {})}], "isError": False}

    def close(self):
        self.closed = True


class BridgeFlowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        bridge.TOKEN = "test-token-secret"
        bridge.SAFE = True
        bridge.ALLOW_ASSETS = set()
        cls.native = FakeNativeClient()
        bridge.set_native_client_factory(lambda: cls.native)
        cls.server = bridge.BridgeServer(("127.0.0.1", 0), bridge.H)
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"
        cls.worker = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.worker.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.worker.join()

    def setUp(self):
        with bridge._DEDUP_LOCK:
            bridge._CALLS.clear()
        with bridge._STATE_LOCK:
            bridge.QUEUE.clear()
            bridge.RESULTS.clear()
            bridge.RECENT.clear()
            bridge._AGENTS.clear()
        with bridge._NATIVE_LOCK:
            bridge._NATIVE_TOOLS.clear()
        self.native.calls.clear()
        self.native.state = "ready"

    def request(self, path, payload=None, *, origin=None, token=True, content_type="application/json", host=None):
        data = json.dumps(payload if payload is not None else {}).encode()
        headers = {"Content-Type": content_type}
        if token and isinstance(payload, dict) and path != "/api/bootstrap":
            payload = dict(payload)
            payload.setdefault("token", bridge.TOKEN)
            if path in {"/api/tools/call", "/api/execute"}:
                payload.setdefault("instance_id", bridge.INSTANCE_ID)
            data = json.dumps(payload).encode()
        if origin is not None:
            headers["Origin"] = origin
        if host:
            headers["Host"] = host
        req = urllib.request.Request(self.url + path, data=data, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=3) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read())

    def test_bootstrap_never_returns_the_token_even_for_a_spoofed_loopback_origin(self):
        for origin in (None, self.url, "null", "https://evil.example", "http://127.0.0.1:1", "http://localhost.evil:123",
                       "chrome-extension://abcdefghijklmnopabcdefghijklmnop"):
            code, body = self.request("/api/bootstrap", {}, origin=origin)
            self.assertEqual(code, 403, origin)
            self.assertEqual(body["code"], "pairing_required")
            self.assertNotIn("bridgeToken", body)
        code, _ = self.request("/api/bootstrap", {}, origin=self.url, host="evil.example:1234")
        self.assertEqual(code, 403)

    def test_agent_status_requires_auth_and_stores_only_operational_fields(self):
        event = {"client_id": "tab:1", "session_id": "session-1", "site": "chatgpt.com", "state": "watching",
                 "calls": 2, "client_version": "2.9.0", "extension_version": "2.9.0", "code": "", "tool_name": "",
                 "text": "PRIVATE_CHAT", "arguments": {"code": "PRIVATE_CODE"}}
        self.assertEqual(self.request("/api/agent/state", event, token=False)[0], 401)
        self.assertEqual(self.request("/api/agent/state", event)[0], 200)
        _, status = self.request("/api/status", {})
        self.assertEqual(status["agent_sessions"][0]["site"], "chatgpt.com")
        self.assertEqual(status["agent_sessions"][0]["state"], "watching")
        self.assertNotIn("PRIVATE_", json.dumps(status))
        self.assertEqual(self.request("/api/agent/state", {**event, "state": "unknown"})[0], 400)
        for i in range(40):
            bridge.record_agent({**event, "client_id": f"tab:{i}"})
        self.assertEqual(len(bridge._AGENTS), 32)
        self.assertEqual(len(bridge.agent_sessions()), 12)

    def test_auth_and_origin_cors_policy(self):
        code, _ = self.request("/api/auth", {"token": "wrong"}, token=False)
        self.assertEqual(code, 401)
        code, body = self.request("/api/auth", {}, origin="chrome-extension://abcdefghijklmnopabcdefghijklmnop")
        self.assertEqual(code, 200)
        self.assertTrue(body["ok"])
        req = urllib.request.Request(self.url + "/api/status", headers={"Origin": "https://evil.example"})
        with urllib.request.urlopen(req) as response:
            self.assertNotIn("Access-Control-Allow-Origin", response.headers)

    def test_tools_list_uses_real_catalog_and_auth(self):
        code, _ = self.request("/api/tools/list", {}, token=False)
        self.assertEqual(code, 401)
        code, body = self.request("/api/tools/list", {})
        self.assertEqual(code, 200)
        self.assertEqual([t["name"] for t in body["tools"]], ["run_code", "echo"])
        self.assertEqual(body["instance_id"], bridge.INSTANCE_ID)

    def test_tool_call_validates_name_preserves_tool_errors_and_uses_timeout(self):
        code, body = self.request("/api/tools/call", {"name": "missing", "arguments": {}, "call_id": "a1"})
        self.assertEqual(code, 404)
        self.assertEqual(body["error"]["code"], "unknown_tool")
        self.assertEqual(body["code"], "unknown_tool")
        self.assertEqual(body["instance_id"], bridge.INSTANCE_ID)
        code, body = self.request("/api/tools/call", {"name": "echo", "arguments": [], "call_id": "a2"})
        self.assertEqual(code, 400)
        code, body = self.request("/api/tools/call", {"name": "echo", "arguments": {"fail": True}, "call_id": "a3"})
        self.assertEqual(code, 200)
        self.assertTrue(body["result"]["isError"])
        self.assertEqual(self.native.calls[-1][2], 60.0)

    def test_call_dedup_cached_and_conflicting_content_rejected(self):
        args = {"name": "echo", "arguments": {"value": 7}, "call_id": "same-id"}
        self.assertEqual(self.request("/api/tools/call", args)[0], 200)
        before = len(self.native.calls)
        self.assertEqual(self.request("/api/tools/call", args)[0], 200)
        self.assertEqual(len(self.native.calls), before)
        conflict = {"name": "echo", "arguments": {"value": 8}, "call_id": "same-id"}
        code, body = self.request("/api/tools/call", conflict)
        self.assertEqual(code, 409)
        self.assertEqual(body["error"]["code"], "call_id_conflict")
        self.native.state = "studio_closed"
        code, cached = self.request("/api/tools/call", args)
        self.assertEqual(code, 200)
        self.assertEqual(cached["result"], {"content": [{"type": "text", "text": '{"value": 7}'}], "isError": False})

    def test_concurrent_identical_calls_share_one_native_execution(self):
        self.native.delay = 0.15
        payload = {"name": "echo", "arguments": {"value": "parallel"}, "call_id": "parallel-id"}
        replies = []
        workers = [threading.Thread(target=lambda: replies.append(self.request("/api/tools/call", payload))) for _ in range(2)]
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join()
        self.native.delay = 0
        self.assertEqual(len(self.native.calls), 1)
        self.assertEqual([reply[0] for reply in replies], [200, 200])
        self.assertEqual(replies[0][1]["result"], replies[1][1]["result"])

    def test_manual_execute_uses_advertised_tool_and_records_real_result(self):
        code, accepted = self.request("/api/execute", {"luau": "print('hello')"})
        self.assertEqual(code, 200)
        jid = accepted["id"]
        deadline = time.time() + 2
        while time.time() < deadline:
            with bridge._STATE_LOCK:
                match = next((r for r in bridge.RESULTS if r["id"] == jid), None)
            if match:
                break
            time.sleep(0.01)
        self.assertIsNotNone(match)
        self.assertTrue(match["ok"])
        self.assertEqual(self.native.calls[-1][0:2], ("run_code", {"code": "print('hello')"}))
        self.assertIn("print('hello')", match["output"])
        self.assertNotIn('"content"', match["output"])

    def test_old_routes_and_private_files(self):
        for path in ("/api/poll", "/api/result", "/api/chat"):
            code, body = self.request(path, {})
            self.assertEqual(code, 410)
            self.assertEqual(body["error"]["code"], "removed")
        for path in ("/token.txt", "/python/token.txt", "/python/mcp_server.py", "/.git/config"):
            try:
                with urllib.request.urlopen(self.url + path) as response:
                    self.fail(f"private path served: {path} ({response.status})")
            except urllib.error.HTTPError as exc:
                self.assertEqual(exc.code, 404)

    def test_static_dashboard_and_native_status(self):
        with urllib.request.urlopen(self.url + "/ui/dashboard.html") as response:
            self.assertEqual(response.status, 200)
        with urllib.request.urlopen(self.url + "/api/status") as response:
            status = json.loads(response.read())
        self.assertEqual(status["studio_mode"], "native_mcp")
        self.assertEqual(status["service"], "argon-mcp")
        self.assertTrue(status["studio_linked"])
        self.assertIn("native_mcp", status)
        self.assertEqual(status["instance_id"], bridge.INSTANCE_ID)
        self.assertNotIn("results", status)
        self.assertNotIn("recent", status)
        self.assertNotIn("usage", status)
        self.assertNotIn("agent_sessions", status)
        self.assertNotIn("message", status["native_mcp"])

    def test_status_details_require_token_and_all_routes_require_loopback_host(self):
        with bridge._STATE_LOCK:
            bridge.RESULTS.append({"id": 1, "output": "private Studio output"})
        with urllib.request.urlopen(self.url + "/api/status") as response:
            self.assertNotIn("private Studio output", response.read().decode())
        self.assertEqual(self.request("/api/status", {}, token=False)[0], 401)
        code, body = self.request("/api/status", {})
        self.assertEqual(code, 200)
        self.assertEqual(body["results"][0]["output"], "private Studio output")
        request = urllib.request.Request(self.url + "/api/status", headers={"Host": f"evil.example:{self.server.server_port}"})
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(request)
        self.assertEqual(error.exception.code, 403)
        self.assertEqual(self.request("/api/status", {}, host=f"evil.example:{self.server.server_port}")[0], 403)

    def test_stale_instance_never_executes_a_tool(self):
        payload = {"name": "run_code", "arguments": {"code": "return 1"}, "call_id": "old-instance", "instance_id": "old"}
        code, body = self.request("/api/tools/call", payload)
        self.assertEqual((code, body["code"]), (409, "instance_changed"))
        code, body = self.request("/api/execute", {"luau": "return 1", "instance_id": "old"})
        self.assertEqual((code, body["code"]), (409, "instance_changed"))
        self.assertEqual(self.native.calls, [])

    def test_native_offline_is_structured(self):
        self.native.state = "studio_closed"
        code, body = self.request("/api/tools/list", {})
        self.assertEqual(code, 503)
        self.assertEqual(body["error"]["code"], "native_offline")
        self.assertEqual(body["code"], "native_offline")
        self.assertEqual(body["native_mcp"]["state"], "studio_closed")

    def test_safe_mode_checks_code_arguments(self):
        code, body = self.request("/api/tools/call", {"name": "run_code", "arguments": {"code": "loadstring('x')"}, "call_id": "unsafe"})
        self.assertEqual(code, 403)
        self.assertEqual(body["error"]["code"], "blocked_by_safe_mode")
        code, body = self.request("/api/tools/call", {"name": "run_code", "arguments": {"code": "local r = require; return r(12345)"}, "call_id": "unsafe-alias"})
        self.assertEqual((code, body["error"]["code"]), (403, "blocked_by_safe_mode"))

    def test_missing_token_file_cannot_silently_create_an_unusable_ephemeral_token(self):
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(bridge, '__file__', str(Path(directory) / 'mcp_server.py')), \
             patch.object(Path, 'write_text', side_effect=PermissionError('read only')):
            with self.assertRaisesRegex(SystemExit, 'Could not save the local bridge token'):
                bridge._load_token()


if __name__ == "__main__":
    unittest.main()
