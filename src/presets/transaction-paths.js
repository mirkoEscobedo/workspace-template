export const PRESET_TRANSACTION_DIRECTORY = ".agentic/.preset-transactions";
export const PRESET_TRANSACTION_PATH = ".agentic/.preset-transaction.json";
export const PRESET_BOOTSTRAP_STAGE_PATH = ".agentic/.preset-transaction.stage";
export const PRESET_TRANSACTION_IGNORE = `${PRESET_TRANSACTION_DIRECTORY}/.gitignore`;
export const PRESET_IGNORE_STAGE_PATH = `${PRESET_TRANSACTION_DIRECTORY}/.gitignore.stage`;

export function transactionPrivateDirectory(planId) {
  return `${PRESET_TRANSACTION_DIRECTORY}/${planId}`;
}

export function snapshotPath(planId, index) {
  return `${transactionPrivateDirectory(planId)}/snapshots/${index}.bin`;
}

export function desiredStagePath(planId, index, desiredHash) {
  return desiredHash === null
    ? null
    : `${transactionPrivateDirectory(planId)}/stages/desired/${index}.bin`;
}

export function restoreStagePath(planId, index, originalHash) {
  return originalHash === null
    ? null
    : `${transactionPrivateDirectory(planId)}/stages/restore/${index}.bin`;
}
