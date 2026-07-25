import path from "node:path";
import { exists, readJson, writeJson } from "../fs-utils.js";
import { runCommandCaptureAsync } from "../process-utils.js";

export function parseExecutor(value) {
  if (!value || value === "manual") return { kind: "manual" };
  if (value.startsWith("command:") && value.slice("command:".length).trim()) {
    return { kind: "command", executable: value.slice("command:".length).trim() };
  }
  throw new Error(`Unsupported alignment executor '${value}'. Use manual or command:<executable>.`);
}

export async function readTaskResult(resultPath, task) {
  if (!(await exists(resultPath))) throw new Error(`Executor did not write the required structured result: ${resultPath}`);
  const result = await readJson(resultPath);
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error(`Task result must be an object: ${resultPath}`);
  if (result.taskId !== task.id) throw new Error(`Task result ID '${result.taskId}' does not match '${task.id}'`);
  if (result.status !== "completed") throw new Error(`Task ${task.id} result status must be 'completed'`);
  if (!Array.isArray(result.changedPaths) || result.changedPaths.some((item) => typeof item !== "string")) {
    throw new Error(`Task ${task.id} result must include changedPaths as an array of repository-relative strings`);
  }
  return {
    ...result,
    changedPaths: [...new Set(result.changedPaths.map((item) => item.replaceAll("\\", "/").replace(/^\.\//, "")))].sort(),
  };
}

export async function executeTask(executor, task, context, options = {}) {
  const requestPath = path.join(context.migrationRoot, `${task.id}.request.json`);
  const resultPath = path.join(context.migrationRoot, `${task.id}.result.json`);
  await writeJson(requestPath, {
    schemaVersion: 1,
    taskId: task.id,
    title: task.title,
    kind: task.kind,
    recipe: task.recipe,
    root: context.checkpointRoot,
    allowedPaths: task.allowedPaths,
    acceptanceCriteria: task.acceptanceCriteria,
    requiredCommands: task.requiredCommands,
    changeBudget: context.plan.alignment.changeBudget,
    resultPath,
    prohibitions: ["commit", "push", "publish", "deploy", "modify dependency manifests", "broaden allowed paths"],
  });
  if (executor.kind === "manual") return { status: "awaiting-manual", requestPath, resultPath };
  const runner = options.runner ?? runCommandCaptureAsync;
  const processResult = await runner(executor.executable, [requestPath], {
    cwd: context.checkpointRoot,
    timeout: options.timeout ?? 60 * 60 * 1000,
    env: {
      CREATE_AGENTIC_TASK: requestPath,
      CREATE_AGENTIC_RESULT: resultPath,
      CREATE_AGENTIC_ROOT: context.checkpointRoot,
    },
  });
  if (processResult.status !== 0 || processResult.error) {
    return {
      status: "failed",
      requestPath,
      resultPath,
      command: executor.executable,
      exitStatus: processResult.status,
      signal: processResult.signal,
      stdout: (processResult.stdout ?? "").slice(-20_000),
      stderr: (processResult.stderr ?? "").slice(-20_000),
      error: processResult.error ? String(processResult.error.message ?? processResult.error) : undefined,
    };
  }
  let structuredResult;
  try {
    structuredResult = await readTaskResult(resultPath, task);
  } catch (error) {
    return {
      status: "failed",
      requestPath,
      resultPath,
      command: executor.executable,
      exitStatus: processResult.status,
      signal: processResult.signal,
      stdout: (processResult.stdout ?? "").slice(-20_000),
      stderr: (processResult.stderr ?? "").slice(-20_000),
      error: String(error.message ?? error),
    };
  }
  return {
    status: "completed",
    requestPath,
    resultPath,
    command: executor.executable,
    exitStatus: processResult.status,
    signal: processResult.signal,
    stdout: (processResult.stdout ?? "").slice(-20_000),
    stderr: (processResult.stderr ?? "").slice(-20_000),
    structuredResult,
  };
}
