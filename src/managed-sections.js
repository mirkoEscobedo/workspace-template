export const AGENTIC_BLOCK_BEGIN = "<!-- workspace-template:begin workspace-template version=2 -->";
export const AGENTIC_BLOCK_END = "<!-- workspace-template:end workspace-template -->";

export function wrapManagedBlock(body) {
  return `${AGENTIC_BLOCK_BEGIN}\n${body.trim()}\n${AGENTIC_BLOCK_END}`;
}

export function inspectManagedBlock(content) {
  const starts = [...content.matchAll(new RegExp(AGENTIC_BLOCK_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))];
  const ends = [...content.matchAll(new RegExp(AGENTIC_BLOCK_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))];
  if (starts.length === 0 && ends.length === 0) return { state: "absent" };
  if (starts.length !== 1 || ends.length !== 1 || ends[0].index < starts[0].index) {
    return { state: "invalid", reason: "managed block markers are missing, duplicated, or out of order" };
  }
  return {
    state: "valid",
    start: starts[0].index,
    end: ends[0].index + AGENTIC_BLOCK_END.length,
    body: content.slice(starts[0].index, ends[0].index + AGENTIC_BLOCK_END.length),
  };
}

export function upsertManagedBlock(content, body) {
  const inspected = inspectManagedBlock(content);
  if (inspected.state === "invalid") throw new Error(inspected.reason);
  const wrapped = wrapManagedBlock(body);
  if (inspected.state === "absent") {
    return `${content.trimEnd()}\n\n${wrapped}\n`;
  }
  return `${content.slice(0, inspected.start)}${wrapped}${content.slice(inspected.end)}`;
}
