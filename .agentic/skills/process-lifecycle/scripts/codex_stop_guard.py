#!/usr/bin/env python3
"""Codex Stop/SubagentStop hook that cleans Frontier Loop process leases.

The first failed cleanup asks Codex to continue. A repeated stop with remaining owned processes
stops the turn to avoid an infinite hook loop.
"""
from __future__ import annotations

import argparse
import json
import os
import signal
import sys
import time
from pathlib import Path
from typing import Any

try:
    import psutil
except ImportError:
    print(json.dumps({"continue": True, "systemMessage": "Frontier process guard skipped: install psutil to enforce leases."}))
    raise SystemExit(0)

LEASE_ENV = "FRONTIER_PROCESS_TOKEN"


def same_process(pid: Any, create_time: Any) -> bool:
    try:
        return abs(psutil.Process(int(pid)).create_time() - float(create_time)) < 0.05
    except (psutil.NoSuchProcess, psutil.AccessDenied, TypeError, ValueError):
        return False


def token_processes(token: str) -> list[psutil.Process]:
    owned: list[psutil.Process] = []
    if not token:
        return owned
    for process in psutil.process_iter(["pid"]):
        try:
            if process.pid == os.getpid():
                continue
            if process.environ().get(LEASE_ENV) == token:
                owned.append(process)
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue
    return owned


def group_processes(pgid: Any, started_at: Any) -> list[psutil.Process]:
    if os.name == "nt" or pgid is None:
        return []
    try:
        group_id = int(pgid)
        start = float(started_at)
    except (TypeError, ValueError):
        return []
    members: list[psutil.Process] = []
    for process in psutil.process_iter(["pid", "create_time"]):
        try:
            if process.info["create_time"] is not None and process.info["create_time"] + 2 < start:
                continue
            if os.getpgid(process.pid) == group_id:
                members.append(process)
        except (ProcessLookupError, PermissionError, psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return members


def cleanup(data: dict[str, Any], grace: float) -> list[int]:
    owned: dict[int, psutil.Process] = {}
    token = str(data.get("process_token") or "")
    for process in token_processes(token):
        owned[process.pid] = process
    for process in group_processes(data.get("process_group_id"), data.get("started_at")):
        owned[process.pid] = process
    if same_process(data.get("pid"), data.get("create_time")):
        try:
            root = psutil.Process(int(data["pid"]))
            for process in root.children(recursive=True) + [root]:
                owned[process.pid] = process
        except psutil.NoSuchProcess:
            pass

    pgid = data.get("process_group_id")
    if os.name != "nt" and pgid is not None:
        try:
            os.killpg(int(pgid), signal.SIGTERM)
        except (ProcessLookupError, PermissionError, TypeError, ValueError):
            pass
    for process in reversed(list(owned.values())):
        try:
            process.terminate()
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    _, alive = psutil.wait_procs(list(owned.values()), timeout=max(0.0, grace))

    if os.name != "nt" and pgid is not None and alive:
        try:
            os.killpg(int(pgid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError, TypeError, ValueError):
            pass
    for process in alive:
        try:
            process.kill()
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    psutil.wait_procs(alive, timeout=2)
    time.sleep(0.05)

    remaining = {process.pid for process in token_processes(token)}
    remaining.update(process.pid for process in group_processes(pgid, data.get("started_at")))
    return sorted(remaining)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lease-dir", type=Path, default=Path(".agent/leases"))
    parser.add_argument("--grace", type=float, default=3)
    args = parser.parse_args()

    try:
        event = json.load(sys.stdin)
    except Exception:
        event = {}

    leaks: list[dict[str, Any]] = []
    lease_dir = args.lease_dir.resolve()
    if lease_dir.exists():
        for path in sorted(lease_dir.glob("*.json")):
            if path.name.endswith(".final.json"):
                continue
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except Exception as exc:
                leaks.append({"lease": str(path), "error": f"invalid lease JSON: {exc}"})
                continue
            remaining = cleanup(data, args.grace)
            if remaining:
                leaks.append({"lease": str(path), "pids": remaining})
            else:
                try:
                    path.unlink()
                except OSError as exc:
                    leaks.append({"lease": str(path), "error": f"cleaned processes but could not remove lease: {exc}"})

    if not leaks:
        print(json.dumps({"continue": True}))
        return 0

    reason = "Owned process leases remain after cleanup: " + json.dumps(leaks, sort_keys=True)
    if event.get("stop_hook_active"):
        print(json.dumps({"continue": False, "stopReason": reason, "systemMessage": reason}))
    else:
        print(json.dumps({"decision": "block", "reason": reason + ". Inspect the leases and run cleanup before completion."}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
