use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::{assets, delivery_args, release};

const START: &str = "<!-- workspace-template:adaptive-delivery:start -->";
const END: &str = "<!-- workspace-template:adaptive-delivery:end -->";
const IGNORE_START: &str = "# workspace-template:thin-state:start";
const IGNORE_END: &str = "# workspace-template:thin-state:end";
const LEGACY_START: &str = "<!-- workspace-template:begin workspace-template";
const LEGACY_END: &str = "<!-- workspace-template:end workspace-template -->";

#[derive(Debug)]
pub struct DeliveryError {
    pub code: &'static str,
    pub message: String,
    pub exit_code: u8,
}

impl DeliveryError {
    fn usage(message: impl Into<String>) -> Self {
        Self {
            code: "INVALID_ARGUMENT",
            message: message.into(),
            exit_code: 64,
        }
    }

    fn stale(message: impl Into<String>) -> Self {
        Self {
            code: "STALE_PLAN",
            message: message.into(),
            exit_code: 2,
        }
    }

    fn io(context: &str, error: std::io::Error) -> Self {
        Self {
            code: "IO_ERROR",
            message: format!("{context}: {error}"),
            exit_code: 1,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Operation {
    kind: String,
    path: String,
    current_sha256: Option<String>,
    proposed_sha256: String,
    content: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Plan {
    version: u8,
    plan_id: String,
    command: String,
    root: String,
    source_fingerprint: String,
    operations: Vec<Operation>,
    conflicts: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TransactionState {
    version: u8,
    status: String,
    #[serde(default)]
    started_paths: Vec<String>,
}

type Retirement = (Vec<Operation>, Vec<String>, Option<String>);

fn sha(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn file_sha(path: &Path) -> Result<Option<String>, DeliveryError> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(sha(&bytes))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(DeliveryError::io(
            &format!("read {}", path.display()),
            error,
        )),
    }
}

fn canonical(root: &Path) -> Result<PathBuf, DeliveryError> {
    fs::canonicalize(root)
        .map_err(|error| DeliveryError::io(&format!("resolve {}", root.display()), error))
}

fn collect_agentic(
    root: &Path,
    current: &Path,
    files: &mut Vec<PathBuf>,
) -> Result<(), DeliveryError> {
    let entries = match fs::read_dir(current) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(DeliveryError::io(
                &format!("read {}", current.display()),
                error,
            ))
        }
    };
    for entry in entries {
        let entry = entry.map_err(|error| DeliveryError::io("read .agentic entry", error))?;
        let path = entry.path();
        let relative = path
            .strip_prefix(root)
            .expect("agentic path")
            .to_string_lossy()
            .replace('\\', "/");
        if relative.starts_with(".agentic/plans/")
            || relative.starts_with(".agentic/transactions/")
            || relative == ".agentic/plans"
            || relative == ".agentic/transactions"
        {
            continue;
        }
        if path.is_dir() {
            collect_agentic(root, &path, files)?;
        } else if path.is_file() {
            files.push(path);
        }
    }
    Ok(())
}

fn fingerprint(root: &Path) -> Result<String, DeliveryError> {
    let mut files = Vec::new();
    for name in [
        "AGENTS.md",
        "AGENT.md",
        "CLAUDE.md",
        "package.json",
        "pnpm-lock.yaml",
        "Cargo.toml",
        "pubspec.yaml",
        ".gitignore",
    ] {
        let path = root.join(name);
        if path.is_file() {
            files.push(path);
        }
    }
    collect_agentic(root, &root.join(".agentic"), &mut files)?;
    files.sort();
    files.dedup();
    let mut digest = Sha256::new();
    for path in files {
        let relative = path
            .strip_prefix(root)
            .expect("fingerprint path")
            .to_string_lossy()
            .replace('\\', "/");
        digest.update(relative.as_bytes());
        digest.update([0]);
        digest.update(
            fs::read(&path)
                .map_err(|error| DeliveryError::io(&format!("read {}", path.display()), error))?,
        );
        digest.update([0]);
    }
    Ok(hex::encode(digest.finalize()))
}

fn managed_agents(existing: &str, invocation: &str) -> String {
    let mut existing = existing.to_owned();
    while let Some(start) = existing.find(LEGACY_START) {
        let Some(end) = existing[start..].find(LEGACY_END) else {
            break;
        };
        let tail = start + end + LEGACY_END.len();
        existing.replace_range(start..tail, "");
    }
    let existing = existing.trim_end();
    let block = format!(
        "{START}\n## Adaptive Delivery\n\nUse `{invocation}` as this repository's workspace-template entry point. Direct is the default; Ticketed is for multi-session slices; Governed is reserved for enumerated high-consequence authority. Review is read-only, allows at most two semantic repair rounds, and returns `INSUFFICIENT_EVIDENCE` when required inspection is unavailable.\n\nLoad package-owned methodology without copying it:\n\n- Behavior changes: `{invocation} skills show tdd` and `{invocation} skills show implementation-style`.\n- Diagnosis: `{invocation} skills show diagnose`.\n- Spawned commands: `{invocation} skills show process-lifecycle`.\n- Completion evidence: `{invocation} skills show verify`.\n- Wayfinder only when a route-changing ambiguity remains.\n- Ticket compilation only after Ticketed or Governed routing.\n\nDiscover the complete inventory with `{invocation} skills list`. Do not copy generic skills into this repository. The host or repository owner selects available models, agents, permissions, skills, and capabilities.\n{END}"
    );
    if let (Some(start), Some(end)) = (existing.find(START), existing.find(END)) {
        let tail = end + END.len();
        format!(
            "{}\n",
            format!("{}{}{}", &existing[..start], block, &existing[tail..]).trim_end()
        )
    } else if existing.trim().is_empty() {
        format!("{block}\n")
    } else {
        format!("{}\n\n{block}\n", existing.trim_end())
    }
}

fn managed_gitignore(existing: &str) -> String {
    let block = format!(
        "{IGNORE_START}\n!.agentic/\n.agentic/*\n!.agentic/project.json\n!.agentic/history/\n.agentic/history/*\n!.agentic/history/migration-index.json\n!.agentic/resumption/\n!.agentic/resumption/**\n{IGNORE_END}"
    );
    if let (Some(start), Some(end)) = (existing.find(IGNORE_START), existing.find(IGNORE_END)) {
        let tail = end + IGNORE_END.len();
        format!("{}{}{}", &existing[..start], block, &existing[tail..])
    } else if existing.trim().is_empty() {
        format!("{block}\n")
    } else {
        format!("{}\n\n{block}\n", existing.trim_end())
    }
}

fn operation(
    root: &Path,
    relative: &str,
    content: String,
) -> Result<Option<Operation>, DeliveryError> {
    let current_sha256 = file_sha(&root.join(relative))?;
    let proposed_sha256 = sha(content.as_bytes());
    if current_sha256.as_deref() == Some(&proposed_sha256) {
        return Ok(None);
    }
    Ok(Some(Operation {
        kind: "write".to_owned(),
        path: relative.to_owned(),
        current_sha256,
        proposed_sha256,
        content,
    }))
}

fn invocation(root: &Path) -> &'static str {
    if root.join("pnpm-lock.yaml").is_file() {
        "pnpm exec workspace-template"
    } else if root.join("package.json").is_file() {
        "npm exec -- workspace-template"
    } else if root.join(".agentic/tooling/package.json").is_file() {
        "npm exec --prefix .agentic/tooling -- workspace-template"
    } else {
        "workspace-template"
    }
}

fn project_json(
    root: &Path,
    binary_sha256: &str,
    migration_index: bool,
    package_commit: &str,
) -> Result<String, DeliveryError> {
    let defaults = json!({
        "capabilities": {
            "runtime-debug": "optional",
            "interactive-gui": "optional"
        },
        "overrides": {},
        "history": {
            "migrationIndex": null,
            "resumption": null
        }
    });
    let existing_path = root.join(".agentic/project.json");
    let existing = if existing_path.is_file() {
        let bytes = fs::read(&existing_path)
            .map_err(|error| DeliveryError::io("read .agentic/project.json", error))?;
        let value: Value = serde_json::from_slice(&bytes).map_err(|error| DeliveryError {
            code: "INVALID_MIGRATION_INPUT",
            message: format!(".agentic/project.json: {error}"),
            exit_code: 3,
        })?;
        if !matches!(value["version"].as_u64(), Some(1 | 2))
            || !value["capabilities"].is_object()
            || !value["overrides"].is_object()
            || !value["history"].is_object()
        {
            return Err(DeliveryError {
                code: "INVALID_MIGRATION_INPUT",
                message: ".agentic/project.json is not valid thin state v1 or v2".to_owned(),
                exit_code: 3,
            });
        }
        value
    } else {
        defaults.clone()
    };
    let mut history = existing["history"].clone();
    if migration_index {
        history["migrationIndex"] = json!(".agentic/history/migration-index.json");
    }
    let artifact_key = format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH);
    let artifacts = json!({
        artifact_key: {
            "packageName": "workspace-template-win32-x64",
            "rustTarget": env!("WT_TARGET"),
            "executableSha256": binary_sha256,
            "signingStatus": release::signing_status()
        }
    });
    Ok(format!(
        "{}\n",
        serde_json::to_string_pretty(&json!({
            "version": 2,
            "workspaceTemplate": {
                "packageName": "workspace-template-win32-x64",
                "releaseVersion": env!("CARGO_PKG_VERSION"),
                "sourceCommit": env!("WT_SOURCE_COMMIT"),
                "releaseCommit": package_commit,
                "embeddedAssetManifestSha256": assets::manifest_sha256(),
                "releaseManifestSha256": assets::release_manifest_sha256(),
                "artifacts": artifacts
            },
            "execution": {
                "method": "adaptive",
                "defaultMode": "direct",
                "limits": { "semanticRepairs": 2, "flakyReruns": 1 }
            },
            "capabilities": existing["capabilities"],
            "overrides": existing["overrides"],
            "history": history
        }))
        .expect("project state")
    ))
}

fn current_binary_sha() -> Result<String, DeliveryError> {
    let path = std::env::current_exe()
        .map_err(|error| DeliveryError::io("resolve current executable", error))?;
    let bytes = fs::read(&path)
        .map_err(|error| DeliveryError::io(&format!("read {}", path.display()), error))?;
    Ok(sha(&bytes))
}

fn retirable_managed_path(path: &str) -> bool {
    [
        ".agentic/skills/",
        ".agentic/skill-baselines/",
        ".agents/skills/",
        ".claude/skills/",
        ".opencode/skills/",
        ".agentic/presets/",
        ".agentic/policies/",
        ".agentic/scripts/",
        ".agentic/modules/",
    ]
    .iter()
    .any(|prefix| path.starts_with(prefix))
        || matches!(
            path,
            ".agentic/config.json"
                | ".agentic/profile.json"
                | ".agentic/profile.schema.json"
                | ".agentic/managed-projections.json"
                | ".agentic/dependency-snapshot.md"
                | ".agentic/implementation-profile.md"
                | ".agent/.gitignore"
                | ".agent/leases/.gitkeep"
        )
}

fn delete_operation(root: &Path, relative: &str) -> Result<Option<Operation>, DeliveryError> {
    let current_sha256 = file_sha(&root.join(relative))?;
    if current_sha256.is_none() {
        return Ok(None);
    }
    Ok(Some(Operation {
        kind: "delete".to_owned(),
        path: relative.to_owned(),
        current_sha256,
        proposed_sha256: sha(b""),
        content: String::new(),
    }))
}

fn legacy_retirement(root: &Path) -> Result<Retirement, DeliveryError> {
    let registry_path = root.join(".agentic/managed-files.json");
    if !registry_path.is_file() {
        return Ok((Vec::new(), Vec::new(), None));
    }
    let registry_bytes = fs::read(&registry_path)
        .map_err(|error| DeliveryError::io("read managed file registry", error))?;
    let registry: Value =
        serde_json::from_slice(&registry_bytes).map_err(|error| DeliveryError {
            code: "INVALID_MIGRATION_INPUT",
            message: format!(".agentic/managed-files.json: {error}"),
            exit_code: 3,
        })?;
    if registry["generator"] != "workspace-template" {
        return Err(DeliveryError {
            code: "INVALID_MIGRATION_INPUT",
            message: "managed file registry has an unknown generator".to_owned(),
            exit_code: 3,
        });
    }
    let files = registry["files"].as_object().ok_or_else(|| DeliveryError {
        code: "INVALID_MIGRATION_INPUT",
        message: "managed file registry has no files object".to_owned(),
        exit_code: 3,
    })?;
    let mut operations = Vec::new();
    let mut retired = Vec::new();
    let mut preserved = Vec::new();
    let mut conflicts = Vec::new();
    let mut entries: Vec<_> = files.iter().collect();
    entries.sort_by_key(|(path, _)| *path);
    for (path, record) in entries {
        if !retirable_managed_path(path) || !root.join(path).is_file() {
            continue;
        }
        let baseline = record["hash"].as_str().unwrap_or_default();
        let current = file_sha(&root.join(path))?.unwrap_or_default();
        if current == baseline {
            if let Some(operation) = delete_operation(root, path)? {
                operations.push(operation);
                retired.push(path.clone());
            }
        } else {
            preserved.push(path.clone());
            conflicts.push(format!(
                "modified managed asset requires an override or merge decision: {path}"
            ));
        }
    }
    let migration_index = format!(
        "{}\n",
        serde_json::to_string_pretty(&json!({
            "version": 1,
            "source": ".agentic/managed-files.json",
            "policy": "retire-hash-matching-only",
            "retired": retired,
            "preserved": preserved
        }))
        .expect("migration index")
    );
    if conflicts.is_empty() {
        if let Some(operation) = delete_operation(root, ".agentic/managed-files.json")? {
            operations.push(operation);
        }
    }
    Ok((operations, conflicts, Some(migration_index)))
}

fn build_plan(command: &str, root: &Path, package_commit: &str) -> Result<Plan, DeliveryError> {
    let root = canonical(root)?;
    let mut operations = Vec::new();
    let (retirement, conflicts, migration_index) = if command == "upgrade" {
        legacy_retirement(&root)?
    } else {
        (Vec::new(), Vec::new(), None)
    };
    operations.extend(retirement);
    if let Some(index) = &migration_index {
        if let Some(item) = operation(
            &root,
            ".agentic/history/migration-index.json",
            index.clone(),
        )? {
            operations.push(item);
        }
    }
    if let Some(item) = operation(
        &root,
        ".agentic/project.json",
        project_json(
            &root,
            &current_binary_sha()?,
            migration_index.is_some(),
            package_commit,
        )?,
    )? {
        operations.push(item);
    }
    let agents = fs::read_to_string(root.join("AGENTS.md")).unwrap_or_default();
    if let Some(item) = operation(
        &root,
        "AGENTS.md",
        managed_agents(&agents, invocation(&root)),
    )? {
        operations.push(item);
    }
    let gitignore = fs::read_to_string(root.join(".gitignore")).unwrap_or_default();
    if let Some(item) = operation(&root, ".gitignore", managed_gitignore(&gitignore))? {
        operations.push(item);
    }
    operations.sort_by(|left, right| left.path.cmp(&right.path));
    let mut plan = Plan {
        version: 1,
        plan_id: String::new(),
        command: command.to_owned(),
        root: root.to_string_lossy().into_owned(),
        source_fingerprint: fingerprint(&root)?,
        operations,
        conflicts,
    };
    plan.plan_id = plan_id(&plan)?;
    Ok(plan)
}

fn plan_id(plan: &Plan) -> Result<String, DeliveryError> {
    let mut unsigned = plan.clone();
    unsigned.plan_id.clear();
    serde_json::to_vec(&unsigned)
        .map(|bytes| sha(&bytes))
        .map_err(|error| DeliveryError {
            code: "PLAN_ERROR",
            message: error.to_string(),
            exit_code: 1,
        })
}

fn safe_relative(relative: &str) -> bool {
    let path = Path::new(relative);
    !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

fn recovery_error(message: impl Into<String>) -> DeliveryError {
    DeliveryError {
        code: "RECOVERY_REQUIRED",
        message: message.into(),
        exit_code: 3,
    }
}

fn write_transaction_state(path: &Path, state: &TransactionState) -> Result<(), DeliveryError> {
    let bytes = format!(
        "{}\n",
        serde_json::to_string_pretty(state).expect("transaction state JSON")
    );
    fs::write(path, bytes).map_err(|error| DeliveryError::io("write transaction state", error))
}

fn recover_transactions(root: &Path) -> Result<Vec<String>, DeliveryError> {
    let transactions = root.join(".agentic/transactions");
    let entries = match fs::read_dir(&transactions) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(DeliveryError::io("read transaction directory", error)),
    };
    let mut directories: Vec<_> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect();
    directories.sort();
    let mut recovered = Vec::new();
    for transaction in directories {
        let id = transaction
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| recovery_error("transaction directory has no valid identity"))?
            .to_owned();
        let state: TransactionState =
            serde_json::from_slice(&fs::read(transaction.join("state.json")).map_err(|error| {
                recovery_error(format!("transaction {id} state is unreadable: {error}"))
            })?)
            .map_err(|error| {
                recovery_error(format!("transaction {id} state is invalid: {error}"))
            })?;
        if state.version != 1 || !matches!(state.status.as_str(), "staged" | "applying") {
            return Err(recovery_error(format!(
                "transaction {id} has unsupported state"
            )));
        }
        if state.status == "applying" {
            let plan: Plan =
                serde_json::from_slice(&fs::read(transaction.join("plan.json")).map_err(
                    |error| recovery_error(format!("transaction {id} plan is unreadable: {error}")),
                )?)
                .map_err(|error| {
                    recovery_error(format!("transaction {id} plan is invalid: {error}"))
                })?;
            if plan.plan_id != id || plan.plan_id != plan_id(&plan)? {
                return Err(recovery_error(format!(
                    "transaction {id} plan identity is invalid"
                )));
            }
            for relative in state.started_paths.iter().rev() {
                if !safe_relative(relative) {
                    return Err(recovery_error(format!(
                        "transaction {id} contains an unsafe path"
                    )));
                }
                let operation = plan
                    .operations
                    .iter()
                    .find(|operation| operation.path == *relative)
                    .ok_or_else(|| {
                        recovery_error(format!("transaction {id} references an unknown operation"))
                    })?;
                let target = root.join(relative);
                let saved = transaction.join("backup").join(relative);
                if saved.is_file() {
                    if target.is_file() {
                        fs::remove_file(&target).map_err(|error| {
                            DeliveryError::io("remove interrupted target", error)
                        })?;
                    } else if target.exists() {
                        return Err(recovery_error(format!(
                            "transaction {id} target became a non-file: {relative}"
                        )));
                    }
                    if let Some(parent) = target.parent() {
                        fs::create_dir_all(parent)
                            .map_err(|error| DeliveryError::io("restore target parent", error))?;
                    }
                    fs::rename(&saved, &target)
                        .map_err(|error| DeliveryError::io("restore interrupted target", error))?;
                } else if operation.current_sha256.is_none() {
                    match file_sha(&target)? {
                        Some(current) if current == operation.proposed_sha256 => {
                            fs::remove_file(&target).map_err(|error| {
                                DeliveryError::io("remove interrupted new target", error)
                            })?;
                        }
                        None => {}
                        Some(_) => {
                            return Err(recovery_error(format!(
                                "transaction {id} new target diverged during recovery: {relative}"
                            )));
                        }
                    }
                } else if file_sha(&target)? != operation.current_sha256 {
                    return Err(recovery_error(format!(
                        "transaction {id} lost its backup for changed target: {relative}"
                    )));
                }
            }
        }
        fs::remove_dir_all(&transaction)
            .map_err(|error| DeliveryError::io("remove recovered transaction", error))?;
        recovered.push(id);
    }
    Ok(recovered)
}

fn apply(plan: &Plan, root: &Path) -> Result<Value, DeliveryError> {
    let root = canonical(root)?;
    recover_transactions(&root)?;
    if plan.version != 1 || plan.plan_id != plan_id(plan)? {
        return Err(DeliveryError::stale("plan identity is invalid"));
    }
    if !plan.conflicts.is_empty() {
        return Err(DeliveryError {
            code: "PLAN_CONFLICT",
            message: plan.conflicts.join("\n"),
            exit_code: 3,
        });
    }
    if Path::new(&plan.root) != root || plan.source_fingerprint != fingerprint(&root)? {
        return Err(DeliveryError::stale(
            "repository state changed after plan review",
        ));
    }
    for operation in &plan.operations {
        if !safe_relative(&operation.path) {
            return Err(DeliveryError::stale(format!(
                "unsafe operation path: {}",
                operation.path
            )));
        }
        if file_sha(&root.join(&operation.path))? != operation.current_sha256 {
            return Err(DeliveryError::stale(format!(
                "{} changed after plan review",
                operation.path
            )));
        }
        if sha(operation.content.as_bytes()) != operation.proposed_sha256 {
            return Err(DeliveryError::stale(format!(
                "{} proposal hash is invalid",
                operation.path
            )));
        }
    }
    if plan.operations.is_empty() {
        return Ok(json!({ "status": "current", "planId": plan.plan_id, "applied": [] }));
    }

    let transaction = root.join(".agentic/transactions").join(&plan.plan_id);
    let staged = transaction.join("staged");
    let backup = transaction.join("backup");
    fs::create_dir_all(&staged)
        .map_err(|error| DeliveryError::io("create transaction staging", error))?;
    fs::write(
        transaction.join("plan.json"),
        format!(
            "{}\n",
            serde_json::to_string_pretty(plan).expect("transaction plan JSON")
        ),
    )
    .map_err(|error| DeliveryError::io("write transaction plan", error))?;
    let mut staged_paths = BTreeMap::new();
    for operation in &plan.operations {
        let path = staged.join(&operation.path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| DeliveryError::io("create staged parent", error))?;
        }
        fs::write(&path, operation.content.as_bytes())
            .map_err(|error| DeliveryError::io("write staged content", error))?;
        staged_paths.insert(operation.path.clone(), path);
    }
    let mut state = TransactionState {
        version: 1,
        status: "staged".to_owned(),
        started_paths: Vec::new(),
    };
    write_transaction_state(&transaction.join("state.json"), &state)?;

    let mut applied: Vec<&Operation> = Vec::new();
    let result: Result<(), DeliveryError> = (|| {
        for operation in &plan.operations {
            if file_sha(&root.join(&operation.path))? != operation.current_sha256 {
                return Err(DeliveryError::stale(format!(
                    "{} changed during apply",
                    operation.path
                )));
            }
            let target = root.join(&operation.path);
            state.status = "applying".to_owned();
            state.started_paths.push(operation.path.clone());
            write_transaction_state(&transaction.join("state.json"), &state)?;
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| DeliveryError::io("create target parent", error))?;
            }
            if target.exists() {
                let saved = backup.join(&operation.path);
                if let Some(parent) = saved.parent() {
                    fs::create_dir_all(parent)
                        .map_err(|error| DeliveryError::io("create backup parent", error))?;
                }
                fs::rename(&target, &saved)
                    .map_err(|error| DeliveryError::io("backup current target", error))?;
            }
            if operation.kind == "write" {
                fs::rename(
                    staged_paths.get(&operation.path).expect("staged operation"),
                    &target,
                )
                .map_err(|error| DeliveryError::io("commit staged target", error))?;
            } else if operation.kind != "delete" {
                return Err(DeliveryError::stale(format!(
                    "unknown operation kind: {}",
                    operation.kind
                )));
            }
            applied.push(operation);
        }
        Ok(())
    })();
    if let Err(error) = result {
        for operation in applied.into_iter().rev() {
            let target = root.join(&operation.path);
            let _ = fs::remove_file(&target);
            let saved = backup.join(&operation.path);
            if saved.exists() {
                if let Some(parent) = target.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                let _ = fs::rename(saved, target);
            }
        }
        return Err(error);
    }
    let paths: Vec<_> = plan
        .operations
        .iter()
        .map(|operation| operation.path.clone())
        .collect();
    fs::remove_dir_all(&transaction)
        .map_err(|error| DeliveryError::io("remove completed transaction", error))?;
    for operation in &plan.operations {
        if operation.kind != "delete" {
            continue;
        }
        let mut parent = root.join(&operation.path).parent().map(Path::to_owned);
        while let Some(directory) = parent {
            if directory == root
                || directory == root.join(".agentic")
                || directory == root.join(".agent")
            {
                break;
            }
            if fs::remove_dir(&directory).is_err() {
                break;
            }
            parent = directory.parent().map(Path::to_owned);
        }
    }
    Ok(json!({ "status": "applied", "planId": plan.plan_id, "applied": paths }))
}

pub fn execute(command: &str, args: &[String]) -> Result<(Value, u8), DeliveryError> {
    delivery_args::validate(command, args)?;
    let subcommand = args
        .first()
        .map(String::as_str)
        .ok_or_else(|| DeliveryError::usage(format!("{command} requires plan or apply")))?;
    let root = args
        .get(1)
        .filter(|value| !value.starts_with('-'))
        .map(String::as_str)
        .unwrap_or(".");
    match subcommand {
        "plan" => {
            let plan_path = delivery_args::option(args, "--plan-out")
                .ok_or_else(|| DeliveryError::usage("plan requires --plan-out <path>"))?;
            let root_path = canonical(Path::new(root))?;
            recover_transactions(&root_path)?;
            delivery_args::reject_unapproved_downgrade(
                &root_path,
                delivery_args::flag(args, "--allow-downgrade"),
            )?;
            let package_commit = delivery_args::option(args, "--package-commit")
                .unwrap_or_else(release::release_commit);
            if package_commit.len() != 40
                || !package_commit.bytes().all(|byte| byte.is_ascii_hexdigit())
            {
                return Err(DeliveryError::usage(
                    "--package-commit must be a full 40-character Git SHA",
                ));
            }
            let plan = build_plan(command, &root_path, &package_commit)?;
            let path = PathBuf::from(plan_path);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| DeliveryError::io("create plan parent", error))?;
            }
            let bytes = format!(
                "{}\n",
                serde_json::to_string_pretty(&plan).expect("plan JSON")
            );
            fs::write(&path, bytes)
                .map_err(|error| DeliveryError::io("write sealed plan", error))?;
            let exit_code = if plan.conflicts.is_empty() { 0 } else { 3 };
            Ok((
                json!({
                    "status": if plan.conflicts.is_empty() { "planned" } else { "conflicted" },
                    "planId": plan.plan_id,
                    "planPath": path,
                    "operations": plan.operations,
                    "conflicts": plan.conflicts
                }),
                exit_code,
            ))
        }
        "apply" => {
            let plan_path = delivery_args::option(args, "--apply-plan")
                .ok_or_else(|| DeliveryError::usage("apply requires --apply-plan <path>"))?;
            let bytes = fs::read(&plan_path)
                .map_err(|error| DeliveryError::io("read sealed plan", error))?;
            let plan: Plan = serde_json::from_slice(&bytes).map_err(|error| DeliveryError {
                code: "INVALID_PLAN",
                message: error.to_string(),
                exit_code: 2,
            })?;
            if plan.command != command {
                return Err(DeliveryError::stale(format!(
                    "plan command {} does not match {command}",
                    plan.command
                )));
            }
            apply(&plan, Path::new(root)).map(|value| (value, 0))
        }
        _ => Err(DeliveryError::usage(format!(
            "unknown {command} subcommand: {subcommand}"
        ))),
    }
}
