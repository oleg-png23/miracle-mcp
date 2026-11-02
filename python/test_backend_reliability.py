"""Failure-path checks using loopback HTTP and owned synthetic MCP processes."""
import json
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

import mcp_server as bridge
from studio_mcp import StudioMCP, StudioMCPOutcomeUnknown
from test_studio_mcp import FAKE_SERVER


class TransportRecoveryTests(unittest.TestCase):
    def test_pipe_write_and_cleanup_obey_timeout_when_child_stops_reading(self):
        source = FAKE_SERVER.replace('import json, sys', 'import json, sys, time')
        source = source.replace('flush=True)\n', 'flush=True)\n        if method == "tools/list": time.sleep(10)\n')
        client = StudioMCP(command=[sys.executable, '-u', '-c', source], timeout=1)
        try:
            self.assertEqual(client.start_if_needed()['state'], 'ready')
            before = time.monotonic()
            with self.assertRaises(StudioMCPOutcomeUnknown) as caught:
                client.call_tool('ping', {'large': 'x' * 500_000}, timeout=0.1)
            self.assertLess(time.monotonic() - before, 1)
            self.assertFalse(caught.exception.pending)
            client.proc.wait(timeout=1)
            self.assertFalse(client._writer.is_alive())
        finally:
            client.close()

    def test_late_response_is_collected_without_sending_another_tool_call(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / 'executions'
            source = FAKE_SERVER.replace('import json, sys', 'import json, sys, time\nfrom pathlib import Path')
            source = source.replace('    elif method == "tools/call":\n',
                '    elif method == "tools/call":\n        time.sleep(.3)\n        with Path(' + repr(str(marker)) + ').open("a") as f: f.write("executed\\n")\n')
            client = StudioMCP(command=[sys.executable, '-u', '-c', source], timeout=1)
            try:
                client.start_if_needed()
                with self.assertRaises(StudioMCPOutcomeUnknown) as caught:
                    client.call_tool('ping', timeout=0.1)
                self.assertTrue(caught.exception.pending)
                self.assertEqual(client.status()['state'], 'outcome_unknown')
                # The monitor must not kill/restart a child with a late result.
                original_process = client.proc
                self.assertEqual(client.start_if_needed()['state'], 'outcome_unknown')
                self.assertIs(client.proc, original_process)
                result = caught.exception.resolve(timeout=2)
                self.assertEqual(result['content'][0]['text'], 'ping')
                self.assertEqual(marker.read_text().splitlines(), ['executed'])
                self.assertEqual(client.status()['state'], 'ready')
            finally:
                client.close()

    def test_forced_close_interrupts_a_waiting_call_before_taking_its_lock(self):
        source = FAKE_SERVER.replace('import json, sys', 'import json, sys, time')
        source = source.replace('    elif method == "tools/call":\n', '    elif method == "tools/call":\n        time.sleep(10)\n')
        client = StudioMCP(command=[sys.executable, '-u', '-c', source], timeout=1)
        errors, entered = [], threading.Event()
        original_write = client._write_message
        def write(proc, message, deadline):
            original_write(proc, message, deadline)
            if message.get('method') == 'tools/call':
                entered.set()
        client._write_message = write
        def call():
            try:
                client.call_tool('ping', timeout=10)
            except StudioMCPOutcomeUnknown as exc:
                errors.append(exc)
        try:
            client.start_if_needed()
            worker = threading.Thread(target=call)
            worker.start()
            self.assertTrue(entered.wait(2))
            before = time.monotonic()
            client.close()
            worker.join(timeout=1)
            self.assertLess(time.monotonic() - before, 1)
            self.assertFalse(worker.is_alive())
            self.assertEqual(len(errors), 1)
            self.assertFalse(errors[0].pending)
        finally:
            client.close()


class Native:
    def __init__(self):
        self.calls = []
        self.handler = lambda name, args: {'content': [{'type': 'text', 'text': 'done'}]}
    def status(self):
        return {'state': 'ready', 'ready': True, 'tools_count': 2}
    def list_tools(self):
        return [{'name': 'echo'}, {'name': 'run_code', 'inputSchema': {'properties': {'code': {'type': 'string'}}}}]
    def call_tool(self, name, arguments, timeout=None):
        self.calls.append((name, arguments))
        return self.handler(name, arguments)
    def close(self):
        pass


class HTTPRecoveryTests(unittest.TestCase):
    def setUp(self):
        bridge.stop_native_client()
        bridge._CALLS.clear()
        bridge._CACHED_CALLS.clear()
        bridge.QUEUE.clear()
        bridge.RESULTS.clear()
        bridge._NATIVE_TOOLS.clear()
        bridge.TOKEN = 'synthetic-token'
        bridge.SAFE = True
        self.native = Native()
        bridge.set_native_client_factory(lambda: self.native)
        self.server = bridge.BridgeServer(('127.0.0.1', 0), bridge.H)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f'http://127.0.0.1:{self.server.server_port}'
        self.release = threading.Event()

    def tearDown(self):
        self.release.set()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def post(self, path, body=None):
        payload = {'token': bridge.TOKEN, 'instance_id': bridge.INSTANCE_ID, **(body or {})}
        request = urllib.request.Request(self.base + path, data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read())

    def call(self, call_id='one', **arguments):
        return self.post('/api/tools/call', {'call_id': call_id, 'name': 'echo', 'arguments': arguments})

    def test_large_first_result_is_delivered_and_cannot_execute_again(self):
        self.native.handler = lambda *_: {'content': [{'type': 'text', 'text': 'x' * 2_000_001}]}
        code, first = self.call()
        self.assertEqual(code, 200)
        self.assertEqual(len(first['result']['content'][0]['text']), 2_000_001)
        self.assertEqual(self.call()[0], 410)
        self.assertEqual(len(self.native.calls), 1)

    def test_a_disconnected_caller_can_retrieve_the_original_result_without_reexecution(self):
        entered = threading.Event()
        def hold(*_):
            entered.set()
            self.release.wait(2)
            return {'content': [{'type': 'text', 'text': 'recovered'}]}
        self.native.handler = hold
        payload = json.dumps({'token': bridge.TOKEN, 'instance_id': bridge.INSTANCE_ID,
                              'call_id': 'disconnected', 'name': 'echo', 'arguments': {}}).encode()
        with socket.create_connection(('127.0.0.1', self.server.server_port), timeout=2) as stream:
            stream.sendall(f'POST /api/tools/call HTTP/1.0\r\nHost: 127.0.0.1:{self.server.server_port}\r\nContent-Type: application/json\r\nContent-Length: {len(payload)}\r\n\r\n'.encode() + payload)
            self.assertTrue(entered.wait(1))
        self.release.set()
        self.assertTrue(bridge._CALLS['disconnected']['event'].wait(1))
        code, result = self.post('/api/tools/result', {'call_id': 'disconnected'})
        self.assertEqual(code, 200)
        self.assertEqual(result['result']['content'][0]['text'], 'recovered')
        self.assertEqual(len(self.native.calls), 1)

    def test_malformed_tool_results_remain_uncertain_and_do_not_reexecute(self):
        self.native.handler = lambda *_: None
        code, result = self.call()
        self.assertEqual((code, result['code']), (504, 'outcome_unknown'))
        self.assertFalse(result['pending'])
        self.assertEqual(self.call()[1]['code'], 'outcome_unknown')
        self.assertEqual(len(self.native.calls), 1)

    def test_result_cache_has_a_byte_budget_and_history_never_reopens_old_ids(self):
        self.native.handler = lambda *_: {'content': [{'type': 'text', 'text': 'x' * 400}]}
        with patch.object(bridge, 'MAX_CACHED_BYTES', 700), patch.object(bridge, 'MAX_CALL_HISTORY', 2):
            self.assertEqual(self.call('one')[0], 200)
            self.assertEqual(self.call('two')[0], 200)
            self.assertEqual(len(bridge._CACHED_CALLS), 1)
            self.assertLessEqual(sum(bridge._CACHED_CALLS.values()), 700)
            self.assertEqual(self.call('one')[0], 410)
            code, rejected = self.call('three')
            self.assertEqual((code, rejected['code']), (429, 'call_history_full'))
            self.assertEqual(len(bridge._CALLS), 2)
            self.assertEqual(len(self.native.calls), 2)

    def test_manual_retries_share_one_job_and_conflicting_content_is_rejected(self):
        entered = threading.Event()
        def hold(*_):
            entered.set()
            self.release.wait(2)
            return {'content': [{'type': 'text', 'text': 'once'}]}
        self.native.handler = hold
        payload = {'call_id': 'manual:one', 'luau': 'return 1'}
        code, first = self.post('/api/execute', payload)
        self.assertEqual(code, 200)
        self.assertTrue(entered.wait(1))
        self.assertEqual(self.post('/api/execute', payload)[1]['id'], first['id'])
        self.assertEqual(self.post('/api/execute', {**payload, 'luau': 'return 2'})[0], 409)
        self.assertEqual(len(self.native.calls), 1)
        self.release.set()
        self.assertTrue(bridge._CALLS['manual:one']['event'].wait(1))
        self.assertEqual(bridge.RESULTS[-1]['call_id'], 'manual:one')
        bridge.RESULTS.clear()  # Recovery still works after the UI's result window expires.
        completed = self.post('/api/execute', payload)[1]['completion']
        self.assertTrue(completed['ok'])
        self.assertEqual(completed['output'], 'once')
        self.assertEqual(len(self.native.calls), 1)

    def test_chat_and_manual_calls_share_capacity_and_rejection_does_not_consume_id(self):
        self.server.jobs = bridge.ToolJobQueue(capacity=1)
        entered = threading.Event()
        def hold(*_):
            entered.set()
            self.release.wait(2)
            return {'content': []}
        self.native.handler = hold
        self.post('/api/execute', {'call_id': 'manual:busy', 'luau': 'return 1'})
        self.assertTrue(entered.wait(1))
        code, result = self.call('chat:waiting')
        self.assertEqual((code, result['code']), (429, 'queue_full'))
        self.assertTrue(result['not_sent'])
        self.assertNotIn('chat:waiting', bridge._CALLS)
        self.assertEqual(len(self.native.calls), 1)

    def test_expired_queued_jobs_are_never_dispatched(self):
        entered = threading.Event()
        def hold(*_):
            entered.set()
            self.release.wait(2)
            return {'content': []}
        self.native.handler = hold
        self.post('/api/execute', {'call_id': 'manual:first', 'luau': 'return 1'})
        self.assertTrue(entered.wait(1))
        with patch.object(bridge, 'TOOL_TIMEOUT', 0.05):
            self.post('/api/execute', {'call_id': 'manual:expired', 'luau': 'return 2'})
        time.sleep(0.07)
        self.release.set()
        self.assertTrue(bridge._CALLS['manual:expired']['event'].wait(1))
        code, result = self.post('/api/tools/result', {'call_id': 'manual:expired'})
        self.assertEqual((code, result['code']), (504, 'native_timeout'))
        self.assertTrue(result['not_sent'])
        self.assertEqual(len(self.native.calls), 1)

    def test_late_http_result_stays_recoverable_and_shutdown_remains_busy(self):
        source = FAKE_SERVER.replace('import json, sys', 'import json, sys, time')
        source = source.replace('    elif method == "tools/call":\n', '    elif method == "tools/call":\n        time.sleep(.5)\n')
        client = StudioMCP(command=[sys.executable, '-u', '-c', source], timeout=1)
        bridge.stop_native_client()
        bridge.set_native_client_factory(lambda: client)
        client.start_if_needed()
        bridge._NATIVE_TOOLS[:] = client.list_tools()
        with patch.object(bridge, 'TOOL_TIMEOUT', 0.1):
            code, result = self.post('/api/tools/call', {'call_id': 'late', 'name': 'ping', 'arguments': {}})
        self.assertEqual((code, result['code']), (504, 'outcome_unknown'))
        self.assertTrue(result['pending'])
        self.assertFalse(bridge._CALLS['late']['event'].is_set())
        self.assertEqual(self.post('/api/bridge/shutdown')[0], 409)
        self.assertEqual(self.post('/api/tools/result', {'call_id': 'late'})[0], 202)
        self.assertEqual(self.post('/api/tools/result', {'call_id': 'late', 'token': 'wrong'})[0], 401)
        self.assertEqual(self.post('/api/tools/result', {'call_id': 'late', 'instance_id': 'old'})[0], 409)
        self.assertTrue(bridge._CALLS['late']['event'].wait(2))
        code, final = self.post('/api/tools/result', {'call_id': 'late'})
        self.assertEqual(code, 200)
        self.assertEqual(final['result']['content'][0]['text'], 'ping')
        self.assertEqual(client._id, 4)  # initialize, two catalog reads, one tools/call

    def test_slow_body_has_a_deadline_before_authentication(self):
        self.server.request_timeout = 0.1
        with socket.create_connection(('127.0.0.1', self.server.server_port), timeout=2) as stream:
            stream.sendall(f'POST /api/auth HTTP/1.0\r\nHost: 127.0.0.1:{self.server.server_port}\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{{'.encode())
            response = stream.recv(4096)
            self.assertIn(b'408 Request Timeout', response)
        self.assertEqual(self.post('/api/auth')[0], 200)

    def test_connection_capacity_rejects_overload_without_starting_more_handlers(self):
        self.server._request_slots = threading.BoundedSemaphore(1)
        self.server._request_slots.acquire()
        try:
            with socket.create_connection(('127.0.0.1', self.server.server_port), timeout=2) as stream:
                self.assertIn(b'503 Service Unavailable', stream.recv(4096))
        finally:
            self.server._request_slots.release()
        self.assertEqual(self.post('/api/auth')[0], 200)


if __name__ == '__main__':
    unittest.main()
