import json
import os
from pathlib import Path
import sys
import tempfile
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
        self.assertIn("HELIUM_STUDIO_MCP_PATH", status["message"])

    def test_call_when_unavailable_is_meaningful(self):
        client = StudioMCP()
        with patch("studio_mcp.find_studio_mcp", return_value=None):
            with self.assertRaisesRegex(StudioMCPError, "not found"):
                client.call_tool("ping")


if __name__ == "__main__":
    unittest.main()
