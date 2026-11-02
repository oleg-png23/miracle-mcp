import concurrent.futures
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from usage_stats import UsageStats


class UsageTests(unittest.TestCase):
    def event(self, event_id="one", site="chatgpt.com", kind="activation", characters=100):
        return dict(event_id=event_id, site=site, kind=kind, characters=characters)

    def test_persistence_deduplication_and_directions(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "usage.json"
            store = UsageStats(path)
            store.record(self.event())
            store.record(self.event("two", kind="input", characters=41))
            store.record(self.event("three", site="claude.ai", kind="output", characters=20))
            restored = UsageStats(path)
            self.assertTrue(restored.record(self.event())["duplicate"])
            data = restored.snapshot()
            self.assertEqual(data["activations"], 1)
            self.assertEqual(data["tokens_in"], 11)
            self.assertEqual(data["tokens_out"], 30)
            self.assertEqual(data["tokens_total"], 41)
            self.assertEqual(len(data["sites"]), 2)
            self.assertNotIn("events", data)
            self.assertTrue(data["estimated"])

    def test_concurrent_events_are_not_lost(self):
        store = UsageStats()
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(lambda i: store.record(self.event(str(i))), range(100)))
        self.assertEqual(store.snapshot()["activations"], 100)
        self.assertEqual(store.snapshot()["tokens_total"], 2500)

    def test_rejected_values_never_change_counters(self):
        store = UsageStats()
        for event in [self.event(characters=-1), self.event(characters=True),
                      self.event(site="https://chatgpt.com/private"), self.event(kind="unknown"),
                      self.event(characters=4_000_001), self.event(event_id="bad id")]:
            with self.assertRaises(ValueError):
                store.record(event)
        self.assertEqual(store.snapshot()["tokens_total"], 0)

    def test_save_failure_does_not_commit_in_memory(self):
        with tempfile.TemporaryDirectory() as folder:
            blocked = Path(folder) / "not-a-directory"
            blocked.write_text("file")
            store = UsageStats(blocked / "usage.json")
            with self.assertRaises(OSError):
                store.record(self.event())
            self.assertEqual(store.snapshot()["activations"], 0)

    def test_invalid_optional_files_are_preserved_and_new_counters_can_be_saved(self):
        cases = ['{', '[]', json.dumps({'version': 1, 'sites': {}, 'events': []}),
                 json.dumps({'version': 1, 'since': 'now', 'activations': 0, 'tokens_in': 0,
                             'tokens_out': 0, 'sites': {'chatgpt.com': {'activations': 0, 'tokens_in': 0, 'tokens_out': 0}}, 'events': []})]
        for content in cases:
            with self.subTest(content=content), tempfile.TemporaryDirectory() as folder:
                path = Path(folder) / 'usage.json'
                path.write_text(content)
                store = UsageStats(path)
                self.assertTrue(store.recovery_message)
                self.assertEqual(store.snapshot()['tokens_total'], 0)
                backups = list(Path(folder).glob('usage.json.corrupt-*'))
                self.assertEqual(len(backups), 1)
                self.assertEqual(backups[0].read_text(), content)
                store.record(self.event())
                self.assertEqual(UsageStats(path).snapshot()['activations'], 1)

    def test_recovery_failure_uses_memory_and_never_overwrites_the_damaged_file(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'usage.json'
            path.write_text('{')
            with patch.object(Path, 'rename', side_effect=PermissionError('read only')):
                store = UsageStats(path)
            store.record(self.event())
            self.assertEqual(path.read_text(), '{')
            self.assertEqual(store.snapshot()['activations'], 1)
            self.assertIn('memory', store.recovery_message)

    def test_unreadable_optional_stats_do_not_block_startup(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'usage.json'
            path.write_text('{}')
            with patch.object(Path, 'read_text', side_effect=PermissionError('read only')):
                store = UsageStats(path)
            self.assertEqual(store.snapshot()['tokens_total'], 0)
            self.assertIn('memory', store.recovery_message)


if __name__ == "__main__":
    unittest.main()
