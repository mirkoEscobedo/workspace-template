#!/usr/bin/env python3
"""Measure source/test files and enforce Frontier Loop architecture ratchets."""
from __future__ import annotations

import argparse
import fnmatch
import json
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError as exc:  # pragma: no cover
    raise SystemExit("PyYAML is required: pip install pyyaml") from exc

DEFAULT_EXTENSIONS = {
    ".py", ".pyi", ".rs", ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs",
    ".go", ".java", ".kt", ".kts", ".cs", ".cpp", ".cc", ".cxx", ".c", ".h", ".hpp",
    ".swift", ".rb", ".php", ".scala", ".ex", ".exs",
}
DEFAULT_IGNORED_PARTS = {".git", ".hg", ".svn", "node_modules", "target", "dist", "build", ".venv", "venv", "__pycache__"}


def load_yaml(path: Path) -> dict[str, Any]:
    value = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(value, dict):
        raise ValueError("budget config must be a YAML object")
    return value


def matches(path: str, globs: list[str]) -> bool:
    return any(fnmatch.fnmatch(path, pattern) or Path(path).match(pattern) for pattern in globs)


def loc(path: Path) -> int:
    try:
        with path.open("r", encoding="utf-8", errors="ignore") as stream:
            return sum(1 for _ in stream)
    except OSError:
        return 0


def is_ignored(relative: Path, ignore_globs: list[str]) -> bool:
    if set(relative.parts) & DEFAULT_IGNORED_PARTS:
        return True
    value = relative.as_posix()
    return matches(value, ignore_globs)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--capture-baseline", action="store_true", help="Intentionally ratchet current megafiles into locked_files")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--fail-on-warnings", action="store_true")
    args = parser.parse_args()

    root = args.root.expanduser().resolve()
    config_path = args.config.expanduser().resolve()
    if not root.is_dir():
        raise SystemExit(f"not a directory: {root}")
    config = load_yaml(config_path)
    ignore_globs = [str(value) for value in config.get("ignore_globs", [])]
    test_globs = [str(value) for value in config.get("test_globs", [])]
    extensions = {str(value).lower() for value in config.get("source_extensions", DEFAULT_EXTENSIONS)}
    defaults = config.get("file_defaults", {}) or {}
    locked_files = dict(config.get("locked_files", {}) or {})

    files: dict[str, dict[str, Any]] = {}
    warnings: list[dict[str, Any]] = []
    violations: list[dict[str, Any]] = []

    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in extensions:
            continue
        relative_path = path.relative_to(root)
        if is_ignored(relative_path, ignore_globs):
            continue
        relative = relative_path.as_posix()
        count = loc(path)
        is_test = (
            matches(relative, test_globs)
            or any(part in ("test", "tests", "__tests__") for part in relative_path.parts)
            or relative_path.name.startswith("test_")
            or any(marker in relative_path.name for marker in (".test.", ".spec.", "_test.", "_tests."))
        )
        kind = "test" if is_test else "production"
        files[relative] = {"loc": count, "kind": kind}

        if is_test:
            if count >= int(defaults.get("test_block_growth_loc", 1500)):
                warnings.append({"path": relative, "kind": "test-megafile-lock-candidate", "loc": count})
            elif count >= int(defaults.get("test_split_plan_loc", 1000)):
                warnings.append({"path": relative, "kind": "test-split-plan", "loc": count})
            elif count >= int(defaults.get("test_warn_loc", 500)):
                warnings.append({"path": relative, "kind": "test-warning", "loc": count})
        else:
            if count >= int(defaults.get("production_split_plan_loc", 1500)):
                warnings.append({"path": relative, "kind": "production-split-plan", "loc": count})
            elif count >= int(defaults.get("production_warn_loc", 800)):
                warnings.append({"path": relative, "kind": "production-warning", "loc": count})

    for path, rule_value in sorted(locked_files.items()):
        if isinstance(rule_value, int):
            baseline = int(rule_value)
            allowed_growth = 0
        elif isinstance(rule_value, dict):
            baseline = int(rule_value.get("baseline_loc", 0))
            allowed_growth = int(rule_value.get("allowed_growth", 0))
        else:
            violations.append({"path": path, "kind": "invalid-lock-rule", "rule": rule_value})
            continue
        current = files.get(path, {}).get("loc")
        if current is None:
            warnings.append({"path": path, "kind": "locked-file-missing"})
            continue
        if int(current) > baseline + allowed_growth:
            violations.append(
                {
                    "path": path,
                    "kind": "locked-file-growth",
                    "baseline_loc": baseline,
                    "allowed_growth": allowed_growth,
                    "current_loc": current,
                    "excess_loc": int(current) - baseline - allowed_growth,
                }
            )

    test_files = sorted(
        ((path, int(meta["loc"])) for path, meta in files.items() if meta["kind"] == "test"),
        key=lambda item: item[1],
        reverse=True,
    )
    total_test_loc = sum(value for _, value in test_files)
    top_ten_loc = sum(value for _, value in test_files[:10])
    concentration = round(top_ten_loc / total_test_loc, 6) if total_test_loc else 0.0
    concentration_warn = float(config.get("concentration", {}).get("warn_top_10_share", 0.40))
    if concentration > concentration_warn:
        warnings.append(
            {
                "kind": "test-concentration",
                "top_10_share": concentration,
                "threshold": concentration_warn,
                "top_files": [{"path": path, "loc": value} for path, value in test_files[:10]],
            }
        )

    report: dict[str, Any] = {
        "schema_version": 1,
        "root": str(root),
        "config": str(config_path),
        "summary": {
            "files": len(files),
            "test_files": len(test_files),
            "production_files": len(files) - len(test_files),
            "total_test_loc": total_test_loc,
            "top_10_test_loc_share": concentration,
        },
        "files": files,
        "warnings": warnings,
        "violations": violations,
    }

    if args.capture_baseline:
        new_locks = dict(locked_files)
        lock_threshold = int(defaults.get("test_block_growth_loc", 1500))
        for path, metadata in files.items():
            if metadata["kind"] == "test" and int(metadata["loc"]) >= lock_threshold:
                new_locks[path] = {"baseline_loc": int(metadata["loc"]), "allowed_growth": 0}
        config["locked_files"] = dict(sorted(new_locks.items()))
        config_path.write_text(yaml.safe_dump(config, sort_keys=False, allow_unicode=True), encoding="utf-8")
        report["captured_locked_files"] = len(new_locks)

    text = json.dumps(report, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + "\n", encoding="utf-8")
    print(text)
    return 1 if violations or (args.fail_on_warnings and warnings) else 0


if __name__ == "__main__":
    raise SystemExit(main())
