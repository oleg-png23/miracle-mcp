import importlib.util
import contextlib
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import zipfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'python'))
spec = importlib.util.spec_from_file_location('release_builder_test', ROOT / 'scripts/build-release.py')
pack = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pack)
import mcp_server as bridge


class ReleasePackageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (ROOT / '.mcp_cache').mkdir(exist_ok=True)
        cls.temp = tempfile.TemporaryDirectory(prefix='release with spaces ', dir=ROOT / '.mcp_cache')
        cls.folder = Path(cls.temp.name)
        original = pack.OUT
        try:
            pack.OUT = cls.folder
            cls.archive = pack.archive('package.zip', pack.runtime_entries())
        finally:
            pack.OUT = original
        cls.extracted = cls.folder / 'extracted'
        with zipfile.ZipFile(cls.archive) as bundle:
            bundle.extractall(cls.extracted)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_two_folders_manifest_resources_and_instructions(self):
        with zipfile.ZipFile(self.archive) as bundle:
            names = set(bundle.namelist())
            self.assertEqual({Path(name).parts[0] for name in names}, {'plugin', 'release'})
            manifest = json.loads(bundle.read('plugin/manifest.json'))
            self.assertEqual(manifest['version'], bridge.VERSION)
            self.assertEqual(manifest['name'], 'Argon — Local Bridge for Roblox Studio')
            self.assertEqual(manifest['short_name'], 'Argon')
            self.assertIn('Argon', bundle.read('plugin/welcome.html').decode('utf-8'))
            self.assertIn('"argon_tool"', bundle.read('plugin/scripts/chat-prompt.js').decode('utf-8'))
            resources = [manifest['background']['service_worker'], *manifest['icons'].values()]
            for script in manifest['content_scripts']:
                resources.extend(script['js'])
            for resource in resources:
                self.assertIn('plugin/' + resource, names)
            for name in ['plugin/INSTALL.md', 'release/INSTALL.md', 'release/run.bat',
                         'release/scripts/start.ps1', 'release/python/mcp_server.py']:
                self.assertIn(name, names)
            forbidden = {'token.txt', '2fa.txt', 'queue.json', '.env'}
            self.assertFalse(any(Path(name).name in forbidden or '/.mcp_cache/' in name or '/__pycache__/' in name for name in names))
            self.assertFalse(any('/test_' in name or '/test-' in name for name in names))

    def test_source_and_split_layout_resolve_the_correct_ui(self):
        self.assertEqual(Path(bridge.resolve_app_root()), ROOT)
        server = self.extracted / 'release/python/mcp_server.py'
        self.assertEqual(Path(bridge.resolve_app_root(server)), self.extracted / 'plugin')

    def test_packaged_bridge_imports_without_source_checkout(self):
        result = subprocess.run([sys.executable, str(self.extracted / 'release/python/mcp_server.py'), '--help'],
                                cwd=self.extracted / 'release', capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('--port', result.stdout)
        self.assertIn('Argon MCP', result.stdout)

    def test_argon_builds_and_legacy_publication_aliases_have_separate_valid_checksums(self):
        with patch.object(pack, 'OUT', self.folder), contextlib.redirect_stdout(io.StringIO()):
            pack.build()
        for name in ['mcp', 'website', 'wallpapers']:
            canonical = self.folder / f'argon-{name}-{bridge.VERSION}.zip'
            legacy = self.folder / f'helium-{name}-{bridge.VERSION}.zip'
            self.assertEqual(canonical.read_bytes(), legacy.read_bytes())
        for filename, prefix in [('argon-SHA256SUMS.txt', 'argon'), ('SHA256SUMS.txt', 'helium')]:
            lines = (self.folder / filename).read_text().splitlines()
            expected = {f'{prefix}-{name}-{bridge.VERSION}.zip' for name in ['mcp', 'website', 'wallpapers']}
            self.assertEqual({line.split()[1] for line in lines}, expected)
            for line in lines:
                digest, name = line.split()
                self.assertEqual(hashlib.sha256((self.folder / name).read_bytes()).hexdigest(), digest)

    def test_packaged_http_ui_and_path_boundary(self):
        class Handler(bridge.H):
            APP_ROOT = bridge.resolve_app_root(self.extracted / 'release/python/mcp_server.py')
        server = bridge.BridgeServer(('127.0.0.1', 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        base = f'http://127.0.0.1:{server.server_port}'
        try:
            for path in ['/app', '/ui/welcome.html', '/ui/scripts/welcome-prompts.js', '/ui/styles/workspace-sections.css']:
                with urllib.request.urlopen(base + path, timeout=3) as response:
                    self.assertEqual(response.status, 200)
                    self.assertTrue(response.read())
            for path in ['/ui/../release/python/mcp_server.py', '/ui/%2e%2e/release/INSTALL.md', '/ui/python/token.txt']:
                with self.assertRaises(urllib.error.HTTPError) as caught:
                    urllib.request.urlopen(base + path, timeout=3)
                self.assertEqual(caught.exception.code, 404)
        finally:
            server.shutdown()
            server.server_close()
            worker.join()


if __name__ == '__main__':
    unittest.main()
