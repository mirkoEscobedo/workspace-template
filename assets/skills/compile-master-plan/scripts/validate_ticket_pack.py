#!/usr/bin/env python3
"""Validate a Frontier Loop ticket pack and optionally regenerate frontier.json."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError as exc:  # pragma: no cover
    raise SystemExit("PyYAML is required: pip install pyyaml") from exc

DONE = {"committed", "closed", "superseded"}
ACTIVE = {"claimed", "in_progress", "review", "repair", "passed"}
ALLOWED_STATUS = DONE | ACTIVE | {"planned", "ready", "blocked", "cancelled"}
IGNORED_PARTS = {"evidence", ".git", "node_modules", "target", "dist", "build"}


def load_yaml(path: Path) -> dict[str, Any]:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{path}: expected YAML object")
    return data


def find_contracts(track: Path) -> list[Path]:
    result: list[Path] = []
    for path in sorted(track.rglob("contract.yaml")):
        if path.is_file() and not (set(path.relative_to(track).parts) & IGNORED_PARTS):
            result.append(path)
    return result


def detect_cycle(graph: dict[str, list[str]]) -> list[str] | None:
    visiting: set[str] = set()
    visited: set[str] = set()
    stack: list[str] = []

    def dfs(node: str) -> list[str] | None:
        if node in visiting:
            index = stack.index(node)
            return stack[index:] + [node]
        if node in visited:
            return None
        visiting.add(node)
        stack.append(node)
        for dependency in graph.get(node, []):
            cycle = dfs(dependency)
            if cycle:
                return cycle
        stack.pop()
        visiting.remove(node)
        visited.add(node)
        return None

    for node in graph:
        cycle = dfs(node)
        if cycle:
            return cycle
    return None


def expect_list(contract: dict[str, Any], key: str, ticket_id: str, errors: list[str]) -> list[Any]:
    value = contract.get(key, [])
    if not isinstance(value, list):
        errors.append(f"{ticket_id}: {key} must be a list")
        return []
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("track", type=Path)
    parser.add_argument("--write-frontier", action="store_true")
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args()

    track = args.track.expanduser().resolve()
    if not track.is_dir():
        raise SystemExit(f"not a directory: {track}")

    errors: list[str] = []
    warnings: list[str] = []
    contracts: dict[str, dict[str, Any]] = {}
    locations: dict[str, str] = {}

    for path in find_contracts(track):
        try:
            contract = load_yaml(path)
        except Exception as exc:
            errors.append(str(exc))
            continue
        ticket_id = str(contract.get("id", "")).strip()
        if not ticket_id:
            errors.append(f"{path}: missing id")
            continue
        if ticket_id in contracts:
            errors.append(f"duplicate ticket id {ticket_id}: {locations[ticket_id]} and {path}")
            continue
        contracts[ticket_id] = contract
        locations[ticket_id] = path.relative_to(track).as_posix()

        lane = contract.get("risk_lane")
        if lane not in (0, 1, 2, 3):
            errors.append(f"{ticket_id}: risk_lane must be 0..3")
        status = str(contract.get("status", "planned"))
        if status not in ALLOWED_STATUS:
            errors.append(f"{ticket_id}: unknown status {status!r}")
        if not str(contract.get("public_outcome", "")).strip():
            errors.append(f"{ticket_id}: empty public_outcome")

        dependencies = [str(value) for value in expect_list(contract, "blocked_by", ticket_id, errors)]
        lenses = [str(value) for value in expect_list(contract, "review_lenses", ticket_id, errors)]
        write_set = expect_list(contract, "write_set", ticket_id, errors)
        expect_list(contract, "conflict_keys", ticket_id, errors)
        gates = expect_list(contract, "human_gates", ticket_id, errors)
        if contract.get("preflight_required") is False and not write_set:
            warnings.append(f"{ticket_id}: no write_set but preflight_required is false")
        if lane in (2, 3):
            for required in ("spec-authority", "code-test"):
                if required not in lenses:
                    errors.append(f"{ticket_id}: Lane {lane} requires {required} review")
        if lane == 3 and "operations-security" not in lenses:
            errors.append(f"{ticket_id}: Lane 3 requires operations-security review")
        if lane == 3 and not gates:
            warnings.append(f"{ticket_id}: Lane 3 has no explicit human gate; confirm that this is intentional")
        budgets = contract.get("budgets", {}) or {}
        if not isinstance(budgets, dict):
            errors.append(f"{ticket_id}: budgets must be an object")
        elif budgets.get("zero_owned_processes_after_run") is not True:
            warnings.append(f"{ticket_id}: zero-owned-process postcondition not enabled")
        if contract.get("kind") == "tracker" and contract.get("execution_policy") != "aggregate-only":
            warnings.append(f"{ticket_id}: tracker should normally use aggregate-only execution")
        if ticket_id in dependencies:
            errors.append(f"{ticket_id}: self dependency")

    graph: dict[str, list[str]] = {}
    parent_children: dict[str, list[str]] = {ticket_id: [] for ticket_id in contracts}
    for ticket_id, contract in contracts.items():
        dependencies = [str(value) for value in contract.get("blocked_by", [])]
        graph[ticket_id] = dependencies
        for dependency in dependencies:
            if dependency not in contracts:
                errors.append(f"{ticket_id}: blocker {dependency} does not exist")
        parent = contract.get("parent")
        if parent:
            parent_id = str(parent)
            if parent_id not in contracts:
                errors.append(f"{ticket_id}: parent {parent_id} does not exist")
            elif parent_id == ticket_id:
                errors.append(f"{ticket_id}: self parent")
            else:
                parent_children[parent_id].append(ticket_id)

    cycle = detect_cycle(graph)
    if cycle:
        errors.append("dependency cycle: " + " -> ".join(cycle))

    statuses = {ticket_id: str(contract.get("status", "planned")) for ticket_id, contract in contracts.items()}
    ready: list[str] = []
    aggregate_ready: list[str] = []
    blocked: list[dict[str, Any]] = []
    active: list[str] = []
    complete: list[str] = []
    planned: list[str] = []

    for ticket_id, contract in contracts.items():
        status = statuses[ticket_id]
        if status in DONE:
            complete.append(ticket_id)
            continue
        if status in ACTIVE:
            active.append(ticket_id)
            continue
        remaining = [dependency for dependency in graph[ticket_id] if statuses.get(dependency) not in DONE]
        if status == "ready" and not remaining:
            if contract.get("execution_policy") == "aggregate-only":
                aggregate_ready.append(ticket_id)
            else:
                ready.append(ticket_id)
        elif status in {"ready", "blocked"}:
            blocked.append({"id": ticket_id, "remaining_blockers": remaining, "source_status": status})
        elif status == "planned":
            planned.append(ticket_id)

    frontier = {
        "schema_version": 1,
        "generated_by": "frontier-loop/validate-ticket-pack",
        "track": track.name,
        "ready": sorted(ready),
        "aggregate_ready": sorted(aggregate_ready),
        "active": sorted(active),
        "blocked": blocked,
        "planned": sorted(planned),
        "complete": sorted(complete),
        "parent_children": {key: sorted(value) for key, value in parent_children.items() if value},
        "errors": errors,
        "warnings": warnings,
    }

    existing_frontier = track / "frontier.json"
    if args.write_frontier and existing_frontier.exists():
        try:
            existing_schema = json.loads(existing_frontier.read_text(encoding="utf-8")).get("schema_version")
        except (OSError, json.JSONDecodeError):
            existing_schema = None
        if existing_schema == 2:
            errors.append(
                "refusing to overwrite schema-v2 frontier; use the track-declared status-preserving updater"
            )
            frontier["errors"] = errors

    if args.write_frontier and not errors:
        (track / "frontier.json").write_text(json.dumps(frontier, indent=2) + "\n", encoding="utf-8")
    if args.as_json:
        print(json.dumps(frontier, indent=2))
    else:
        print(
            "contracts={} ready={} aggregate_ready={} active={} errors={} warnings={}".format(
                len(contracts), len(ready), len(aggregate_ready), len(active), len(errors), len(warnings)
            )
        )
        for error in errors:
            print("ERROR:", error)
        for warning in warnings:
            print("WARN:", warning)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
