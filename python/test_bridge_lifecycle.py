"""Real loopback/process checks; no Roblox installation or real tools needed."""
import importlib.util
import errno
import json
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'python'))
spec = importlib.util.spec_from_file_location('lifecycle_bridge', ROOT / 'python/mcp_server.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class Native:
    def __init__(self): self.closed = False
    def status(self): return {'state': 'ready', 'ready': True, 'tools_count': 0}
    def close(self): self.closed = True


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        bridge.stop_native_client()
        self.native = Native()
        bridge.set_native_client_factory(lambda: self.native)
        bridge.get_native_client()
        bridge.TOKEN = 'fixture-token'
        bridge._CALLS.clear()
        bridge.QUEUE.clear()
        bridge._LAST_UI_OPEN = 0
        self.server = bridge.BridgeServer(('127.0.0.1', 0), bridge.H)
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        self.base = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.worker.join(timeout=3)

    def post(self, path, body):
        request = urllib.request.Request(self.base + path, data=json.dumps(body).encode(),
                                         headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())

    def test_shutdown_checks_auth_instance_and_running_calls(self):
        path = '/api/bridge/shutdown'
        self.assertEqual(self.post(path, {})[0], 401)
        body = {'token': bridge.TOKEN, 'instance_id': 'old-instance'}
        self.assertEqual(self.post(path, body)[0], 409)
        body['instance_id'] = bridge.INSTANCE_ID
        bridge._CALLS['pending'] = {'event': threading.Event()}
        self.assertEqual(self.post(path, body)[1]['code'], 'bridge_busy')
        self.assertFalse(self.server.stopping.is_set())
        bridge._CALLS.clear()
        self.assertEqual(self.post(path, body)[0], 200)
        self.worker.join(timeout=3)
        self.assertFalse(self.worker.is_alive())
        self.assertTrue(self.server.stopping.is_set())
        self.server.server_close()
        self.assertTrue(self.native.closed)

    def test_duplicate_ui_claims_are_coalesced(self):
        body = {'token': bridge.TOKEN, 'instance_id': bridge.INSTANCE_ID}
        self.assertTrue(self.post('/api/ui/claim', body)[1]['open_ui'])
        self.assertFalse(self.post('/api/ui/claim', body)[1]['open_ui'])
        self.assertEqual(self.post('/api/ui/claim', {**body, 'instance_id': 'old'})[0], 409)

    def test_duplicate_cli_reuses_owner_without_rewriting_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory) / 'python'
            folder.mkdir()
            for name in ['mcp_server.py', 'studio_mcp.py', 'usage_stats.py']:
                shutil.copy2(ROOT / 'python' / name, folder / name)
            token = folder / 'token.txt'
            token.write_text('untouched-local-token')
            before = token.stat().st_mtime_ns
            result = subprocess.run([sys.executable, str(folder / 'mcp_server.py'), '--port', str(self.server.server_port)],
                                    capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('reusing v'+bridge.VERSION, result.stdout)
            self.assertEqual(token.stat().st_mtime_ns, before)
            self.assertEqual(token.read_text(), 'untouched-local-token')

    def test_same_version_legacy_service_is_recognized_but_requires_verified_launcher_replacement(self):
        for service in ['argon-mcp', 'helium-mcp', 'miracle-mcp', 'unrelated']:
            with self.subTest(service=service):
                class Identity(bridge.H):
                    def _status(handler, include_details=False):
                        handler._json({'online': True, 'service': service, 'studio_mode': 'native_mcp',
                                       'version': bridge.VERSION, 'pid': 123, 'instance_id': 'identity-fixture'})
                self.server.RequestHandlerClass = Identity
                found = bridge.existing_bridge(self.server.server_port)
                if service == 'unrelated':
                    self.assertIsNone(found)
                else:
                    self.assertEqual(found['service'], service)
                with patch.object(bridge, 'BridgeServer', side_effect=OSError(errno.EADDRINUSE, 'fixture port in use')), \
                     patch.object(bridge, '_load_token') as token:
                    if service == 'argon-mcp':
                        self.assertEqual(bridge.main(['--port', str(self.server.server_port)]), 0)
                    else:
                        with self.assertRaisesRegex(SystemExit, 'Run run.bat to replace'):
                            bridge.main(['--port', str(self.server.server_port)])
                    token.assert_not_called()
                self.assertTrue(self.worker.is_alive(), 'Direct startup must not stop the previous owner')

    def test_simultaneous_process_launches_leave_one_bridge_and_one_token(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory) / 'python'
            folder.mkdir()
            for name in ['mcp_server.py', 'studio_mcp.py', 'usage_stats.py']:
                shutil.copy2(ROOT / 'python' / name, folder / name)
            with socket.socket() as reservation:
                reservation.bind(('127.0.0.1', 0))
                port = reservation.getsockname()[1]
            command = [sys.executable, '-u', str(folder / 'mcp_server.py'), '--port', str(port)]
            processes = [subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) for _ in range(3)]
            try:
                deadline = time.time() + 10
                while time.time() < deadline:
                    alive = [process for process in processes if process.poll() is None]
                    info = bridge.existing_bridge(port)
                    if info and len(alive) == 1: break
                    time.sleep(.05)
                self.assertEqual(len(alive), 1)
                for process in processes:
                    if process not in alive:
                        out, err = process.communicate(timeout=2)
                        self.assertEqual(process.returncode, 0, err)
                        self.assertIn('reusing', out)
                token = (folder / 'token.txt').read_text().strip()
                self.assertTrue(token)
                data = json.dumps({'token': token, 'instance_id': info['instance_id']}).encode()
                request = urllib.request.Request(f'http://127.0.0.1:{port}/api/bridge/shutdown', data=data,
                                                 headers={'Content-Type': 'application/json'})
                with urllib.request.urlopen(request, timeout=3) as response:
                    self.assertEqual(response.status, 200)
                alive[0].wait(timeout=5)
                self.assertEqual(alive[0].returncode, 0)
            finally:
                for process in processes:
                    if process.poll() is None: process.terminate()
                    try: process.communicate(timeout=3)
                    except subprocess.TimeoutExpired:
                        process.kill(); process.communicate()


if __name__ == '__main__': unittest.main()
