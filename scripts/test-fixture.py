"""UI-only native MCP simulator. Never opens Studio or writes user tokens."""
import json
import sys
import threading
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
import mcp_server as bridge


class FakeStudio:
    def __init__(self):
        self.calls = []
        self.state = 'ready'
        self.delay = 0
        self.lock = threading.Lock()

    def status(self):
        return {'state': self.state, 'ready': self.state == 'ready', 'tools_count': 2,
                'message': 'Studio MCP test transport' if self.state == 'ready' else 'Откройте Studio и включите встроенный MCP.'}

    def start_if_needed(self):
        return self.status()

    def list_tools(self):
        return [
            {'name': 'run_code', 'description': 'Execute Luau in the open place', 'inputSchema': {'type': 'object', 'properties': {'code': {'type': 'string'}}, 'required': ['code']}},
            {'name': 'get_scene_info', 'description': 'Inspect the open place', 'inputSchema': {'type': 'object', 'properties': {}}, 'annotations': {'readOnlyHint': True}, '_meta': {'miracles_fixture': 'full-catalog-metadata'}},
        ]

    def call_tool(self, name, arguments=None, *, timeout=None):
        with self.lock:
            self.calls.append({'name': name, 'arguments': arguments})
            delay = self.delay
        time.sleep(delay)
        failed = 'error(' in str(arguments)
        return {'content': [{'type': 'text', 'text': 'line 1: test error' if failed else 'Native fixture result'}], 'isError': failed}

    def close(self):
        pass


fake = FakeStudio()
bridge.TOKEN = 'ui-test-token'
bridge.set_native_client_factory(lambda: fake)
bridge._refresh_native()


class FixtureHandler(bridge.H):
    def do_GET(self):
        if self.path == '/__fixture/calls':
            self._json({'calls': fake.calls})
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == '/__fixture/reset':
            body, error = self._body()
            if error:
                self._json({'error': error}, 400)
                return
            fake.calls.clear()
            fake.state = body.get('state', 'ready')
            fake.delay = min(3, max(0, float(body.get('delay', 0))))
            if body.get('restart'):
                bridge.INSTANCE_ID = bridge.secrets.token_hex(8)
                bridge._CALLS.clear()
            bridge._refresh_native()
            self._json({'ok': True})
        else:
            super().do_POST()


server = bridge.BridgeServer(('127.0.0.1', 19737), FixtureHandler)
print('Native MCP UI simulator: http://127.0.0.1:19737', flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
