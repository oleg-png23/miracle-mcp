"""Durable aggregate counters; no prompts, code, results or full URLs are stored."""
from __future__ import annotations

import copy
import json
import re
import threading
from datetime import datetime, timezone
from pathlib import Path


class UsageStats:
    MAX_EVENTS = 8192
    MAX_SITES = 128

    def __init__(self, path: Path | None = None):
        self.path = path
        self.lock = threading.Lock()
        self.data = {"version": 1, "since": datetime.now(timezone.utc).isoformat(),
                     "activations": 0, "tokens_in": 0, "tokens_out": 0, "sites": {}, "events": []}
        if path and path.exists():
            saved = json.loads(path.read_text(encoding="utf-8"))
            if (saved.get("version") != 1 or not isinstance(saved.get("sites"), dict)
                    or not isinstance(saved.get("events"), list)
                    or len(saved["sites"]) > self.MAX_SITES or len(saved["events"]) > self.MAX_EVENTS):
                raise ValueError("Invalid usage statistics file")
            for row in [saved, *saved["sites"].values()]:
                for field in ("activations", "tokens_in", "tokens_out"):
                    if type(row.get(field)) is not int or row[field] < 0:
                        raise ValueError("Invalid usage counter")
            self.data = saved

    def record(self, event: dict) -> dict:
        event_id, kind, site = event.get("event_id"), event.get("kind"), event.get("site")
        if not isinstance(event_id, str) or not re.fullmatch(r"[\w.:/-]{1,256}", event_id):
            raise ValueError("Invalid usage event ID")
        if kind not in {"activation", "input", "output"}:
            raise ValueError("Invalid usage event kind")
        if not isinstance(site, str) or not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?", site):
            raise ValueError("Usage site must be a hostname")
        count = event.get("characters", 0)
        if type(count) is not int or not 0 <= count <= 4_000_000:
            raise ValueError("Invalid transferred character count")
        with self.lock:
            identity = site + ":" + event_id
            if identity in self.data["events"]:
                return {"ok": True, "duplicate": True}
            next_data = copy.deepcopy(self.data)
            if site not in next_data["sites"] and len(next_data["sites"]) >= self.MAX_SITES - 1:
                site = "other"
            row = next_data["sites"].setdefault(site, {"activations": 0, "tokens_in": 0, "tokens_out": 0})
            field = "tokens_in" if kind == "input" else "tokens_out"
            estimate = (count + 3) // 4
            for item in (next_data, row):
                item[field] += estimate
                if kind == "activation":
                    item["activations"] += 1
            row["last_used"] = datetime.now(timezone.utc).isoformat()
            next_data["events"].append(identity)
            next_data["events"] = next_data["events"][-self.MAX_EVENTS:]
            if self.path:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                temporary = self.path.with_suffix(".tmp")
                temporary.write_text(json.dumps(next_data, ensure_ascii=False), encoding="utf-8")
                temporary.replace(self.path)
            self.data = next_data
        return {"ok": True, "duplicate": False}

    def snapshot(self) -> dict:
        with self.lock:
            data = copy.deepcopy(self.data)
        data.pop("events", None)
        data["estimated"] = True
        data["method"] = "characters_div_4"
        data["tokens_total"] = data["tokens_in"] + data["tokens_out"]
        data["sites"] = sorted((dict(site=site, **row) for site, row in data["sites"].items()),
                               key=lambda row: row["last_used"], reverse=True)
        return data
