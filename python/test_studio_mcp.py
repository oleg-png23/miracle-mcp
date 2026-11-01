import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

from studio_mcp import StudioMCP, StudioMCPError, find_studio_mcp


FAKE_SERVER = r'''
import json, sys
for line in sys.stdin:
    req = json.loads(line)
    method = req.get("method")
    if method == "notifications/initialized":
        continue
    if method == "initialize":
        result = {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}, "serverInfo": {"name": "fake"}}
    elif method == "tools/list":
        result = {"tools": [{"name": "ping", "description": "fixture", "inputSchema": {"type": "object"}}]}
    elif method == "tools/call":
        result = {"content": [{"type": "text", "text": req["params"]["name"]}], "isError": False}
    else:
        result = {}
    if "id" in req:
        print(json.dumps({"jsonrpc": "2.0", "id": req["id"], "result": result}), flush=True)
'''

PAGINATED_SERVER = r'''
import json, sys
for line in sys.stdin:
    req = json.loads(line)
    method = req.get("method")
    if method == "notifications/initialized":
        continue
    if method == "initialize":
        result = {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}, "serverInfo": {"name": "fake"}}
    elif method == "tools/list":
        cursor = req.get("params", {}).get("cursor")
        if cursor is None:
            result = {"tools": [{"name": "first", "description": "first page", "inputSchema": {"type": "object", "properties": {"x": {"type": "string"}}}, "annotations": {"readOnlyHint": True}, "_meta": {"vendor": "kept"}}], "nextCursor": "page-2"}
        elif cursor == "page-2":
            result = {"tools": [{"name": "second", "description": "second page", "inputSchema": {"type": "object", "required": ["flag"]}, "execution": {"taskSupport": "optional"}}]}
        else:
            result = {"tools": []}
    else:
        result = {}
    if "id" in req:
        print(json.dumps({"jsonrpc": "2.0", "id": req["id"], "result": result}), flush=True)
'''


class StudioMCPTests(unittest.TestCase):
    def test_argon_override_precedes_helium_miracle_and_original_fallbacks(self):
        with tempfile.TemporaryDirectory() as directory:
            keys = ['ARGON_STUDIO_MCP_PATH', 'HELIUM_STUDIO_MCP_PATH',
                    'MIRACLES_STUDIO_MCP_PATH', 'ZS_STUDIO_MCP_PATH']
            paths = [Path(directory) / (key + '.exe') for key in keys]
            for path in paths:
                path.touch()
            with patch.dict(os.environ, dict(zip(keys, map(str, paths))), clear=True):
                for key, path in zip(keys, paths):
                    self.assertEqual(find_studio_mcp(), path)
                    del os.environ[key]

    def test_helium_path_override_takes_precedence_and_legacy_override_still_works(self):
        with tempfile.TemporaryDirectory() as directory:
            current = Path(directory) / 'helium.exe'
            legacy = Path(directory) / 'miracle.exe'
            current.touch()
            legacy.touch()
            with patch.dict(os.environ, {'HELIUM_STUDIO_MCP_PATH': str(current),
                                         'MIRACLES_STUDIO_MCP_PATH': str(legacy)}, clear=True):
                self.assertEqual(find_studio_mcp(), current)
                del os.environ['HELIUM_STUDIO_MCP_PATH']
                self.assertEqual(find_studio_mcp(), legacy)

    def client(self, **kwargs):
        return StudioMCP(command=[sys.executable, "-u", "-c", FAKE_SERVER], timeout=1, **kwargs)

    def test_initialize_advertises_argon_identity_over_real_stdio(self):
        strict = FAKE_SERVER.replace('method == "initialize":',
            'method == "initialize":\n        assert req["params"]["clientInfo"]["name"] == "argon-mcp"')
        client = StudioMCP(command=[sys.executable, '-u', '-c', strict], timeout=1)
        try:
            self.assertEqual(client.start_if_needed()['state'], 'ready')
        finally:
            client.close()

    @patch("studio_mcp.studio_is_running", return_value=True)
    def test_handshake_tools_and_call(self, _running):
        client = self.client()
        try:
            status = client.start_if_needed()
            self.assertEqual(status["state"], "ready")
            self.assertEqual(status["tools_count"], 1)
            self.assertEqual(client.list_tools()[0]["name"], "ping")
            result = client.call_tool("ping", {"value": 1})
            self.assertEqual(result["content"][0]["text"], "ping")
        finally:
            client.close()

    def test_empty_catalog_in_command_fixture_is_mcp_disabled(self):
        empty = FAKE_SERVER.replace('[{"name": "ping", "description": "fixture", "inputSchema": {"type": "object"}}]', '[]')
        client = StudioMCP(command=[sys.executable, "-u", "-c", empty], timeout=1)
        try:
            self.assertEqual(client.start_if_needed()["state"], "mcp_disabled")
        finally:
            client.close()

    @patch("studio_mcp.studio_is_running", return_value=True)
    def test_tools_list_follows_cursor_and_preserves_advertised_fields(self, _running):
        client = StudioMCP(command=[sys.executable, "-u", "-c", PAGINATED_SERVER], timeout=1)
        try:
            self.assertEqual(client.start_if_needed()["tools_count"], 2)
            tools = client.list_tools()
            self.assertEqual([tool["name"] for tool in tools], ["first", "second"])
            self.assertEqual(tools[0]["annotations"], {"readOnlyHint": True})
            self.assertEqual(tools[0]["_meta"], {"vendor": "kept"})
            self.assertEqual(tools[1]["execution"], {"taskSupport": "optional"})
        finally:
            client.close()

    @patch("studio_mcp.find_studio_mcp", return_value=None)
    def test_missing_executable(self, _find):
        status = StudioMCP().start_if_needed()
        self.assertEqual(status["state"], "missing")
        self.assertIn("ARGON_STUDIO_MCP_PATH", status["message"])

    def test_call_when_unavailable_is_meaningful(self):
        client = StudioMCP()
        with patch("studio_mcp.find_studio_mcp", return_value=None):
            with self.assertRaisesRegex(StudioMCPError, "not found"):
                client.call_tool("ping")

    def test_rediscovers_an_updated_executable(self):
        with tempfile.TemporaryDirectory() as directory:
            old, new = Path(directory) / 'old.exe', Path(directory) / 'new.exe'
            old.touch(); new.touch()
            def fake_popen(_command, **kwargs):
                return subprocess.Popen([sys.executable, '-u', '-c', FAKE_SERVER], **kwargs)
            client = StudioMCP(timeout=1, process_factory=fake_popen)
            try:
                with patch('studio_mcp.find_studio_mcp', side_effect=[old, new]) as discover, \
                     patch('studio_mcp.studio_is_running', return_value=True):
                    self.assertEqual(client.start_if_needed()['state'], 'ready')
                    client.close(); old.unlink()
                    self.assertEqual(client.start_if_needed()['state'], 'ready')
                    self.assertEqual(client.executable, new)
                    self.assertEqual(discover.call_count, 2)
            finally:
                client.close()

    def test_unknown_process_state_does_not_hide_available_tools(self):
        client = StudioMCP()
        client._list_all_tools = lambda: [{'name': 'ping'}]
        with patch('studio_mcp.studio_is_running', return_value=None):
            client._refresh_tools()
        self.assertEqual(client.status()['state'], 'ready')
        self.assertEqual(client.status()['tools_count'], 1)

    def test_queue_timeout_prevents_late_dispatch(self):
        client = StudioMCP(command=['fake'], timeout=.1)
        client.proc = type('Process', (), {'poll': lambda self: None})()
        client._state = 'ready'
        entered, release, second_dispatched = threading.Event(), threading.Event(), threading.Event()
        def fake_request(_method, params, timeout=None):
            if params['name'] == 'first':
                entered.set()
                release.wait(2)
            else:
                second_dispatched.set()
            return {}
        client._request = fake_request
        first = threading.Thread(target=lambda: client.call_tool('first', timeout=2))
        first.start()
        try:
            self.assertTrue(entered.wait(1))
            with self.assertRaisesRegex(StudioMCPError, 'tool was not sent'):
                client.call_tool('second', timeout=.1)
            self.assertFalse(second_dispatched.is_set())
        finally:
            release.set(); first.join(timeout=2)
        self.assertFalse(first.is_alive())
        self.assertFalse(second_dispatched.is_set())


if __name__ == "__main__":
    unittest.main()
