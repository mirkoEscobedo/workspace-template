"""Dependency-free YAML subset for Frontier Loop's generated policy files.

This deliberately supports only mappings, sequences, booleans, nulls, numbers,
and quoted/unquoted scalar strings. It is not a general YAML implementation.
The project uses it so generated retrofit and budget scripts do not require
PyYAML at runtime.
"""
from __future__ import annotations

import json
import re
from typing import Any


def _scalar(value: Any) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value)
    if (
        not text
        or text.strip() != text
        or any(ch in text for ch in ":#{}[],&*?|-<>=!%@`\n\r\t")
        or text.lower() in {"null", "true", "false", "yes", "no"}
    ):
        return json.dumps(text, ensure_ascii=False)
    return text


def _dump(value: Any, indent: int = 0) -> list[str]:
    prefix = " " * indent
    if isinstance(value, dict):
        lines: list[str] = []
        for key, item in value.items():
            rendered_key = _scalar(key)
            if isinstance(item, (dict, list)) and item:
                lines.append(f"{prefix}{rendered_key}:")
                lines.extend(_dump(item, indent + 2))
            elif isinstance(item, (dict, list)):
                lines.append(f"{prefix}{rendered_key}: {'{}' if isinstance(item, dict) else '[]'}")
            else:
                lines.append(f"{prefix}{rendered_key}: {_scalar(item)}")
        return lines
    if isinstance(value, list):
        lines = []
        for item in value:
            if isinstance(item, dict) and item:
                entries = list(item.items())
                key, first = entries[0]
                if isinstance(first, (dict, list)):
                    lines.append(f"{prefix}- {_scalar(key)}:")
                    lines.extend(_dump(first, indent + 4))
                else:
                    lines.append(f"{prefix}- {_scalar(key)}: {_scalar(first)}")
                for key, rest in entries[1:]:
                    if isinstance(rest, (dict, list)):
                        lines.append(f"{prefix}  {_scalar(key)}:")
                        lines.extend(_dump(rest, indent + 4))
                    else:
                        lines.append(f"{prefix}  {_scalar(key)}: {_scalar(rest)}")
            elif isinstance(item, list):
                lines.append(f"{prefix}-")
                lines.extend(_dump(item, indent + 2))
            else:
                lines.append(f"{prefix}- {_scalar(item)}")
        return lines
    return [f"{prefix}{_scalar(value)}"]


def safe_dump(value: Any, sort_keys: bool = False, allow_unicode: bool = True) -> str:
    del allow_unicode
    if sort_keys and isinstance(value, dict):
        value = dict(sorted(value.items()))
    return "\n".join(_dump(value)) + "\n"


def _parse_scalar(value: str) -> Any:
    value = value.strip()
    if value in {"", "null", "~"}:
        return None
    if value == "true":
        return True
    if value == "false":
        return False
    if value == "[]":
        return []
    if value == "{}":
        return {}
    if value.startswith(("\"", "'")):
        try:
            return json.loads(value) if value.startswith("\"") else value[1:-1]
        except json.JSONDecodeError:
            return value[1:-1]
    if re.fullmatch(r"-?\d+", value):
        return int(value)
    if re.fullmatch(r"-?\d+\.\d+", value):
        return float(value)
    return value


def safe_load(raw: str) -> Any:
    stripped = raw.strip()
    if not stripped:
        return None
    if stripped.startswith(("{", "[")):
        return json.loads(stripped)
    tokens: list[tuple[int, str]] = []
    for line in raw.replace("\r\n", "\n").split("\n"):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        indent = len(line) - len(line.lstrip(" "))
        if "\t" in line[:indent]:
            raise ValueError("tabs are not supported in generated YAML")
        tokens.append((indent, line.strip()))
    if not tokens:
        return None

    def parse_block(index: int, indent: int) -> tuple[Any, int]:
        is_list = tokens[index][1].startswith("-")
        output: Any = [] if is_list else {}
        while index < len(tokens):
            current_indent, text = tokens[index]
            if current_indent < indent:
                break
            if current_indent > indent:
                raise ValueError(f"Unsupported YAML indentation near: {text}")
            if is_list:
                if not text.startswith("-"):
                    break
                body = text[1:].strip()
                if not body:
                    child, index = parse_block(index + 1, indent + 2)
                    output.append(child)
                    continue
                if ":" in body:
                    key, raw_value = body.split(":", 1)
                    item: dict[str, Any] = {}
                    if raw_value.strip():
                        item[key.strip()] = _parse_scalar(raw_value)
                        index += 1
                    else:
                        child, index = parse_block(index + 1, indent + 2)
                        item[key.strip()] = child
                    while index < len(tokens) and tokens[index][0] == indent + 2 and not tokens[index][1].startswith("-"):
                        sub_key, sub_value = tokens[index][1].split(":", 1)
                        if sub_value.strip():
                            item[sub_key.strip()] = _parse_scalar(sub_value)
                            index += 1
                        else:
                            child, index = parse_block(index + 1, indent + 4)
                            item[sub_key.strip()] = child
                    output.append(item)
                    continue
                output.append(_parse_scalar(body))
                index += 1
            else:
                if ":" not in text:
                    raise ValueError(f"Unsupported YAML mapping line: {text}")
                key, raw_value = text.split(":", 1)
                if raw_value.strip():
                    output[key.strip()] = _parse_scalar(raw_value)
                    index += 1
                elif index + 1 < len(tokens) and tokens[index + 1][0] > indent:
                    child, index = parse_block(index + 1, tokens[index + 1][0])
                    output[key.strip()] = child
                else:
                    output[key.strip()] = None
                    index += 1
        return output, index

    value, _ = parse_block(0, tokens[0][0])
    return value
