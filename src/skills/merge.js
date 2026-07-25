import { hashBuffer } from "../fs-utils.js";

function splitLines(text) {
  const normalized = text.replaceAll("\r\n", "\n");
  const trailing = normalized.endsWith("\n");
  const lines = normalized.split("\n");
  if (trailing) lines.pop();
  return { lines, trailing };
}

function lcsMatrix(left, right) {
  const matrix = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      matrix[i][j] = left[i] === right[j]
        ? matrix[i + 1][j + 1] + 1
        : Math.max(matrix[i + 1][j], matrix[i][j + 1]);
    }
  }
  return matrix;
}

export function diffHunks(baseText, variantText) {
  const base = splitLines(baseText).lines;
  const variant = splitLines(variantText).lines;
  const matrix = lcsMatrix(base, variant);
  const hunks = [];
  let current;
  let i = 0;
  let j = 0;
  const flush = () => {
    if (current) hunks.push(current);
    current = undefined;
  };
  while (i < base.length || j < variant.length) {
    if (i < base.length && j < variant.length && base[i] === variant[j]) {
      flush();
      i += 1;
      j += 1;
      continue;
    }
    current ??= { start: i, end: i, lines: [] };
    if (j < variant.length && (i === base.length || matrix[i][j + 1] >= matrix[i + 1][j])) {
      current.lines.push(variant[j]);
      j += 1;
    } else {
      current.end = i + 1;
      i += 1;
    }
  }
  flush();
  return hunks;
}

function overlaps(left, right) {
  // Insertions at the boundary of a replaced range are composable: an insertion
  // at `range.start` is before the replacement and an insertion at `range.end`
  // is after it. Only an insertion strictly inside a replaced range conflicts.
  if (left.start === left.end && right.start === right.end) return left.start === right.start;
  if (left.start === left.end) return left.start > right.start && left.start < right.end;
  if (right.start === right.end) return right.start > left.start && right.start < left.end;
  return left.start < right.end && right.start < left.end;
}

function same(left, right) {
  return left.start === right.start
    && left.end === right.end
    && JSON.stringify(left.lines) === JSON.stringify(right.lines);
}

function applyHunks(base, hunks) {
  const output = [...base];
  for (const hunk of [...hunks].sort((a, b) => b.start - a.start || b.end - a.end)) {
    output.splice(hunk.start, hunk.end - hunk.start, ...hunk.lines);
  }
  return output;
}

export function mergeText3(baseText, localText, incomingText) {
  if (localText === baseText) return { status: "incoming", content: incomingText, conflicts: [] };
  if (incomingText === baseText) return { status: "local", content: localText, conflicts: [] };
  if (localText === incomingText) return { status: "identical", content: localText, conflicts: [] };
  const local = diffHunks(baseText, localText);
  const incoming = diffHunks(baseText, incomingText);
  const conflicts = [];
  for (const left of local) {
    for (const right of incoming) {
      if (overlaps(left, right) && !same(left, right)) conflicts.push({ local: left, incoming: right });
    }
  }
  if (conflicts.length > 0) {
    return {
      status: "conflict",
      conflicts,
      content: `<<<<<<< LOCAL\n${localText.replace(/\n$/, "")}\n||||||| BASELINE\n${baseText.replace(/\n$/, "")}\n=======\n${incomingText.replace(/\n$/, "")}\n>>>>>>> INCOMING\n`,
    };
  }
  const unique = [...local];
  for (const hunk of incoming) if (!unique.some((item) => same(item, hunk))) unique.push(hunk);
  const split = splitLines(baseText);
  const trailing = split.trailing || localText.endsWith("\n") || incomingText.endsWith("\n");
  return { status: "merged", content: `${applyHunks(split.lines, unique).join("\n")}${trailing ? "\n" : ""}`, conflicts: [] };
}

export function threeWayMergeText(base, local, incoming) {
  const buffers = [base, local, incoming].map((item) => Buffer.isBuffer(item) ? item : Buffer.from(item ?? ""));
  if (buffers.some((item) => item.includes(0))) {
    if (buffers[1].equals(buffers[0])) return { status: "incoming", content: buffers[2] };
    if (buffers[2].equals(buffers[0])) return { status: "local", content: buffers[1] };
    if (buffers[1].equals(buffers[2])) return { status: "identical", content: buffers[1] };
    return { status: "conflict", reason: "binary/executable content changed on both sides", conflicts: [] };
  }
  const result = mergeText3(...buffers.map((item) => item.toString("utf8")));
  return { ...result, content: Buffer.from(result.content, "utf8") };
}

export function contentRecord(content) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return {
    encoding: "base64",
    content: buffer.toString("base64"),
    hash: hashBuffer(buffer),
  };
}
