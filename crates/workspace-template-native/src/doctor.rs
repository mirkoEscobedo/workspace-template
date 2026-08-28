use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::assets;

fn package_root(target: &Path) -> Option<PathBuf> {
    if target.join("assets/skills").is_dir() {
        return Some(target.to_owned());
    }
    let executable = std::env::current_exe().ok()?;
    executable
        .ancestors()
        .find(|candidate| candidate.join("assets/skills").is_dir())
        .map(Path::to_owned)
}

fn valid_hex(value: Option<&str>, length: usize) -> bool {
    value.is_some_and(|text| {
        text.len() == length && text.bytes().all(|byte| byte.is_ascii_hexdigit())
    })
}

fn runtime_debug_qualification(source_root: Option<&Path>) -> Value {
    let Some(source_root) = source_root else {
        return json!({
            "capability": "runtime-debug",
            "qualified": false,
            "reason": "package qualification record is unavailable"
        });
    };
    let record_path = source_root.join("docs/qualification/cdb-windows-x64.json");
    let record: Value = match std::fs::read(&record_path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
    {
        Some(record) => record,
        None => {
            return json!({
                "capability": "runtime-debug",
                "qualified": false,
                "reason": "CDB qualification record is missing or invalid"
            });
        }
    };
    let provider_path = record["providerPath"].as_str().map(PathBuf::from);
    let actual_sha256 = provider_path
        .as_ref()
        .and_then(|path| std::fs::read(path).ok())
        .map(|bytes| hex::encode(Sha256::digest(bytes)));
    let expected_sha256 = record["providerSha256"].as_str();
    let qualified = record["verdict"] == "PASS"
        && record["postmortemDebuggerRegistered"] == false
        && actual_sha256.as_deref() == expected_sha256;
    json!({
        "capability": "runtime-debug",
        "qualified": qualified,
        "provider": record["provider"],
        "providerVersion": record["providerVersion"],
        "providerPath": provider_path,
        "expectedSha256": expected_sha256,
        "actualSha256": actual_sha256,
        "policy": "read-only-source-inspection-and-execution-control",
        "reason": if qualified { Value::Null } else { json!("provider missing or different from qualified executable") }
    })
}

fn runtime_debug_required(root: &Path) -> bool {
    std::fs::read(root.join(".agentic/project.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .is_some_and(|value| value["capabilities"]["runtime-debug"] == "required")
}

fn validate_project(root: &Path, binary_sha256: Option<&str>) -> Vec<String> {
    let path = root.join(".agentic/project.json");
    if !path.is_file() {
        return Vec::new();
    }
    let value: Value = match std::fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
    {
        Some(value) => value,
        None => return vec![".agentic/project.json is not valid JSON".to_owned()],
    };
    let mut errors = Vec::new();
    if value["version"] != 1 {
        errors.push("project version must be 1".to_owned());
    }
    if value["execution"]["method"] != "adaptive" || value["execution"]["defaultMode"] != "direct" {
        errors.push("execution must use adaptive/direct".to_owned());
    }
    if !valid_hex(value["workspaceTemplate"]["commit"].as_str(), 40) {
        errors.push("workspaceTemplate.commit must be a full Git SHA".to_owned());
    }
    if !valid_hex(value["workspaceTemplate"]["sourceCommit"].as_str(), 40) {
        errors.push("workspaceTemplate.sourceCommit must be a full Git SHA".to_owned());
    }
    if !valid_hex(value["workspaceTemplate"]["binarySha256"].as_str(), 64) {
        errors.push("workspaceTemplate.binarySha256 must be a SHA-256".to_owned());
    }
    if value["workspaceTemplate"]["sourceCommit"].as_str() != Some(env!("WT_SOURCE_COMMIT")) {
        errors.push(
            "workspaceTemplate.sourceCommit does not match the running source commit".to_owned(),
        );
    }
    if value["workspaceTemplate"]["binarySha256"].as_str() != binary_sha256 {
        errors.push(
            "workspaceTemplate.binarySha256 does not match the running executable".to_owned(),
        );
    }
    errors
}

pub fn doctor(root: &Path) -> (Value, bool) {
    let binary_sha256 = std::env::current_exe()
        .ok()
        .and_then(|path| std::fs::read(path).ok())
        .map(|bytes| hex::encode(Sha256::digest(bytes)));
    let mut errors = validate_project(root, binary_sha256.as_deref());
    let (verified, mismatches, source_root) = match package_root(root) {
        Some(source_root) => {
            let (verified, mismatches) = assets::verify_readable(&source_root);
            (verified, mismatches, Some(source_root))
        }
        None => (
            0,
            vec!["readable package assets were not found".to_owned()],
            None,
        ),
    };
    errors.extend(mismatches.iter().cloned());
    let runtime_debug = runtime_debug_qualification(source_root.as_deref());
    if runtime_debug_required(root) && runtime_debug["qualified"] != true {
        errors.push("required runtime-debug capability is not qualified on this host".to_owned());
    }
    let ok = errors.is_empty();
    (
        json!({
            "verdict": if ok { "PASS" } else { "FAIL" },
            "target": root,
            "platform": { "os": std::env::consts::OS, "arch": std::env::consts::ARCH },
            "binarySha256": binary_sha256,
            "sourceCommit": env!("WT_SOURCE_COMMIT"),
            "runtimeDebug": runtime_debug,
            "embeddedAssets": {
                "manifestSha256": assets::manifest_sha256(),
                "sourceRoot": source_root,
                "verified": verified,
                "mismatches": mismatches
            },
            "errors": errors
        }),
        ok,
    )
}
