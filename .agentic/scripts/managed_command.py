#!/usr/bin/env python3
"""Run one command under a Frontier Loop process lease.

POSIX commands run in a dedicated session/process group. Windows commands are assigned to a
Job Object with KILL_ON_JOB_CLOSE when supported. A unique environment token lets the stop hook
find owned descendants even after the root process exits.
"""
from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
import re
import signal
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any

try:
    import psutil
except ImportError as exc:  # pragma: no cover - dependency error is user-facing
    raise SystemExit("psutil is required: pip install psutil") from exc


LEASE_ENV = "FRONTIER_PROCESS_TOKEN"


def safe_component(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", value).strip("._")
    if not cleaned:
        raise ValueError("lease identifiers must contain at least one safe character")
    return cleaned[:96]


def atomic_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + f".{os.getpid()}.tmp")
    temp.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temp.replace(path)


def process_identity(pid: int) -> dict[str, Any]:
    try:
        process = psutil.Process(pid)
        return {"pid": pid, "create_time": process.create_time()}
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        return {"pid": pid, "create_time": None}


def same_process(pid: int, create_time: float | None) -> bool:
    if create_time is None:
        return False
    try:
        return abs(psutil.Process(pid).create_time() - float(create_time)) < 0.05
    except (psutil.NoSuchProcess, psutil.AccessDenied, ValueError, TypeError):
        return False


def token_processes(token: str) -> list[psutil.Process]:
    owned: list[psutil.Process] = []
    for process in psutil.process_iter(["pid", "create_time"]):
        try:
            if process.pid == os.getpid():
                continue
            if process.environ().get(LEASE_ENV) == token:
                owned.append(process)
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue
    return owned


def posix_group_members(pgid: int, started_at: float) -> list[psutil.Process]:
    members: list[psutil.Process] = []
    for process in psutil.process_iter(["pid", "create_time"]):
        try:
            if process.info["create_time"] is not None and process.info["create_time"] + 2 < started_at:
                continue
            if os.getpgid(process.pid) == pgid:
                members.append(process)
        except (ProcessLookupError, PermissionError, psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return members


def wait_and_kill(processes: list[psutil.Process], grace: float) -> list[int]:
    unique = {process.pid: process for process in processes}
    processes = list(unique.values())
    if not processes:
        return []
    _, alive = psutil.wait_procs(processes, timeout=max(0.0, grace))
    for process in alive:
        try:
            process.kill()
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    _, alive = psutil.wait_procs(alive, timeout=3)
    return [process.pid for process in alive if process.is_running()]


def terminate_posix_group(pgid: int, started_at: float, token: str, grace: float) -> list[int]:
    members = {process.pid: process for process in posix_group_members(pgid, started_at)}
    members.update({process.pid: process for process in token_processes(token)})
    if not members:
        return []
    try:
        os.killpg(pgid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        for process in reversed(list(members.values())):
            try:
                process.terminate()
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
    _, alive = psutil.wait_procs(list(members.values()), timeout=max(0.0, grace))
    if alive:
        try:
            os.killpg(pgid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            for process in alive:
                try:
                    process.kill()
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
    _, alive = psutil.wait_procs(alive, timeout=3)
    remaining = {process.pid for process in alive if process.is_running()}
    remaining.update(process.pid for process in token_processes(token))
    return sorted(remaining)


class WindowsJob:
    """Minimal Windows Job Object wrapper with KILL_ON_JOB_CLOSE."""

    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000
    JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS = 9

    class IO_COUNTERS(ctypes.Structure):
        _fields_ = [
            ("ReadOperationCount", ctypes.c_ulonglong),
            ("WriteOperationCount", ctypes.c_ulonglong),
            ("OtherOperationCount", ctypes.c_ulonglong),
            ("ReadTransferCount", ctypes.c_ulonglong),
            ("WriteTransferCount", ctypes.c_ulonglong),
            ("OtherTransferCount", ctypes.c_ulonglong),
        ]

    class BASIC_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_longlong),
            ("PerJobUserTimeLimit", ctypes.c_longlong),
            ("LimitFlags", ctypes.c_uint32),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", ctypes.c_uint32),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", ctypes.c_uint32),
            ("SchedulingClass", ctypes.c_uint32),
        ]

    class EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
        pass

    EXTENDED_LIMIT_INFORMATION._fields_ = [
        ("BasicLimitInformation", BASIC_LIMIT_INFORMATION),
        ("IoInfo", IO_COUNTERS),
        ("ProcessMemoryLimit", ctypes.c_size_t),
        ("JobMemoryLimit", ctypes.c_size_t),
        ("PeakProcessMemoryUsed", ctypes.c_size_t),
        ("PeakJobMemoryUsed", ctypes.c_size_t),
    ]

    def __init__(self, process: subprocess.Popen[Any]):
        self.handle: int | None = None
        self.error: str | None = None
        if os.name != "nt":
            return
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CreateJobObjectW.restype = ctypes.c_void_p
        kernel32.CreateJobObjectW.argtypes = (ctypes.c_void_p, ctypes.c_wchar_p)
        kernel32.SetInformationJobObject.restype = ctypes.c_int
        kernel32.SetInformationJobObject.argtypes = (ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32)
        kernel32.AssignProcessToJobObject.restype = ctypes.c_int
        kernel32.AssignProcessToJobObject.argtypes = (ctypes.c_void_p, ctypes.c_void_p)
        kernel32.TerminateJobObject.restype = ctypes.c_int
        kernel32.TerminateJobObject.argtypes = (ctypes.c_void_p, ctypes.c_uint32)
        kernel32.CloseHandle.restype = ctypes.c_int
        kernel32.CloseHandle.argtypes = (ctypes.c_void_p,)
        self.kernel32 = kernel32

        handle = kernel32.CreateJobObjectW(None, None)
        if not handle:
            self.error = f"CreateJobObjectW failed: {ctypes.get_last_error()}"
            return
        info = self.EXTENDED_LIMIT_INFORMATION()
        info.BasicLimitInformation.LimitFlags = self.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        ok = kernel32.SetInformationJobObject(
            handle,
            self.JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
            ctypes.byref(info),
            ctypes.sizeof(info),
        )
        if not ok:
            self.error = f"SetInformationJobObject failed: {ctypes.get_last_error()}"
            kernel32.CloseHandle(handle)
            return
        process_handle = ctypes.c_void_p(int(process._handle))  # type: ignore[attr-defined]
        if not kernel32.AssignProcessToJobObject(handle, process_handle):
            self.error = f"AssignProcessToJobObject failed: {ctypes.get_last_error()}"
            kernel32.CloseHandle(handle)
            return
        self.handle = int(handle)

    @property
    def active(self) -> bool:
        return self.handle is not None

    def terminate(self) -> None:
        if self.handle is not None:
            self.kernel32.TerminateJobObject(ctypes.c_void_p(self.handle), 1)

    def close(self) -> None:
        if self.handle is not None:
            self.kernel32.CloseHandle(ctypes.c_void_p(self.handle))
            self.handle = None


def terminate_owned(
    *,
    process: subprocess.Popen[Any],
    identity: dict[str, Any],
    pgid: int | None,
    started_at: float,
    token: str,
    grace: float,
    job: WindowsJob | None,
) -> list[int]:
    if os.name == "nt":
        if job and job.active:
            job.terminate()
            time.sleep(min(max(grace, 0.1), 2.0))
        else:
            owned = token_processes(token)
            if same_process(process.pid, identity.get("create_time")):
                try:
                    root = psutil.Process(process.pid)
                    owned.extend(root.children(recursive=True))
                    owned.append(root)
                except psutil.NoSuchProcess:
                    pass
            for candidate in reversed(owned):
                try:
                    candidate.terminate()
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
            wait_and_kill(owned, grace)
        return sorted(process.pid for process in token_processes(token))
    if pgid is None:
        return []
    return terminate_posix_group(pgid, started_at, token, grace)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--ticket-id", required=True)
    parser.add_argument("--agent-id", required=True)
    parser.add_argument("--lease-dir", type=Path, default=Path(".agent/leases"))
    parser.add_argument("--timeout", type=float, default=0, help="Seconds; zero means no wrapper timeout")
    parser.add_argument("--grace", type=float, default=8, help="Graceful process-tree shutdown seconds")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()

    command = list(args.command)
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        raise SystemExit("command required after --")
    if args.timeout < 0 or args.grace < 0:
        raise SystemExit("--timeout and --grace must be non-negative")

    run_id = safe_component(args.run_id)
    ticket_id = safe_component(args.ticket_id)
    agent_id = safe_component(args.agent_id)
    lease_dir = args.lease_dir.resolve()
    lease_dir.mkdir(parents=True, exist_ok=True)
    lease = lease_dir / f"{run_id}--{ticket_id}--{agent_id}.json"
    final_evidence = lease_dir / f"{run_id}--{ticket_id}--{agent_id}.final.json"
    token = uuid.uuid4().hex
    started_at = time.time()

    environment = os.environ.copy()
    environment.update(
        {
            LEASE_ENV: token,
            "FRONTIER_RUN_ID": args.run_id,
            "FRONTIER_TICKET_ID": args.ticket_id,
            "FRONTIER_AGENT_ID": args.agent_id,
            "FRONTIER_LEASE_PATH": str(lease),
        }
    )

    creation_flags = 0
    popen_kwargs: dict[str, Any] = {"env": environment}
    if os.name == "nt":
        creation_flags = subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
    else:
        popen_kwargs["start_new_session"] = True

    process = subprocess.Popen(command, creationflags=creation_flags, **popen_kwargs)
    identity = process_identity(process.pid)
    pgid = None if os.name == "nt" else os.getpgid(process.pid)
    job = WindowsJob(process) if os.name == "nt" else None

    record: dict[str, Any] = {
        "schema_version": 1,
        "run_id": args.run_id,
        "ticket_id": args.ticket_id,
        "agent_id": args.agent_id,
        "owner_wrapper_pid": os.getpid(),
        "pid": process.pid,
        "create_time": identity["create_time"],
        "process_group_id": pgid,
        "process_token": token,
        "windows_job_active": bool(job and job.active),
        "windows_job_error": job.error if job else None,
        "cwd": str(Path.cwd()),
        "started_at": started_at,
        "deadline": started_at + args.timeout if args.timeout else None,
        "command_digest": hashlib.sha256(json.dumps(command, ensure_ascii=False).encode("utf-8")).hexdigest(),
        "command": command,
        "state": "running",
    }
    atomic_json(lease, record)

    interrupted = False
    termination_requested = False

    def handle_signal(signum: int, _frame: object) -> None:
        nonlocal interrupted, termination_requested
        interrupted = True
        termination_requested = True
        record["state"] = "interrupted"
        record["signal"] = signum
        atomic_json(lease, record)
        terminate_owned(
            process=process,
            identity=identity,
            pgid=pgid,
            started_at=started_at,
            token=token,
            grace=args.grace,
            job=job,
        )

    old_int = signal.signal(signal.SIGINT, handle_signal)
    old_term = signal.signal(signal.SIGTERM, handle_signal)
    timed_out = False
    try:
        try:
            exit_code = process.wait(timeout=args.timeout if args.timeout else None)
        except subprocess.TimeoutExpired:
            timed_out = True
            termination_requested = True
            record["state"] = "timeout"
            atomic_json(lease, record)
            remaining = terminate_owned(
                process=process,
                identity=identity,
                pgid=pgid,
                started_at=started_at,
                token=token,
                grace=args.grace,
                job=job,
            )
            try:
                process.wait(timeout=max(1.0, args.grace + 1.0))
            except subprocess.TimeoutExpired:
                pass
            exit_code = 124
        else:
            # Root exit does not authorize descendants to remain alive.
            remaining = terminate_owned(
                process=process,
                identity=identity,
                pgid=pgid,
                started_at=started_at,
                token=token,
                grace=min(args.grace, 2.0),
                job=job,
            )
    finally:
        signal.signal(signal.SIGINT, old_int)
        signal.signal(signal.SIGTERM, old_term)
        if job:
            job.close()

    if interrupted:
        final_state = "interrupted"
        final_code = 130
    elif timed_out:
        final_state = "timeout"
        final_code = 124
    elif exit_code == 0 and not remaining:
        final_state = "finished"
        final_code = 0
    else:
        final_state = "failed"
        final_code = int(exit_code)

    record.update(
        {
            "state": final_state,
            "exit_code": final_code,
            "finished_at": time.time(),
            "duration_seconds": round(time.time() - started_at, 6),
            "termination_requested": termination_requested,
            "remaining_pids": sorted(set(remaining)),
        }
    )
    atomic_json(final_evidence, record)
    if not remaining:
        try:
            lease.unlink()
        except FileNotFoundError:
            pass
    else:
        atomic_json(lease, record)
    return final_code


if __name__ == "__main__":
    raise SystemExit(main())
