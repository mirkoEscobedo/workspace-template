use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::{assets, release};

fn package_root(target: &Path) -> Option<PathBuf> {
    let target_is_package = std::fs::read(target.join("package.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .is_some_and(|manifest| manifest["name"] == "workspace-template");
    if target_is_package && target.join("assets/skills").is_dir() {
        return Some(target.to_owned());
    }
    release::package_root()
}

fn valid_hex(value: Option<&str>, length: usize) -> bool {
    value.is_some_and(|text| {
        text.len() == length && text.bytes().all(|byte| byte.is_ascii_hexdigit())
    })
}

fn runtime_debug_required(project: Option<&Value>) -> bool {
    project.is_some_and(|value| value["capabilities"]["runtime-debug"] == "required")
}

fn cdb_candidates(record: &Value) -> Vec<PathBuf> {
    let executable = record["providerExecutable"].as_str().unwrap_or("cdb.exe");
    let relative = record["windowsKitsRelativePath"]
        .as_str()
        .unwrap_or("Debuggers/x64/cdb.exe");
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("WT_CDB_PATH") {
        candidates.push(PathBuf::from(path));
    }
    if let Some(root) = std::env::var_os("WINDOWS_KITS_ROOT") {
        candidates.push(PathBuf::from(root).join(relative));
    }
    if let Some(program_files) = std::env::var_os("ProgramFiles(x86)") {
        candidates.push(
            PathBuf::from(program_files)
                .join("Windows Kits/10")
                .join(relative),
        );
    }
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|directory| directory.join(executable)));
    }
    candidates
}

fn runtime_debug_qualification(source_root: Option<&Path>) -> Value {
    let Some(source_root) = source_root else {
        return json!({
            "capability": "runtime-debug",
            "qualified": false,
            "reason": "portable package qualification record is unavailable"
        });
    };
    let record: Value =
        match std::fs::read(source_root.join("docs/qualification/cdb-windows-x64.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        {
            Some(record) => record,
            None => {
                return json!({
                    "capability": "runtime-debug",
                    "qualified": false,
                    "reason": "portable CDB qualification record is missing or invalid"
                });
            }
        };
    let provider_path = cdb_candidates(&record)
        .into_iter()
        .find(|candidate| candidate.is_file());
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
        "reason": if qualified { Value::Null } else { json!("qualified provider was not discovered or its bytes differ") }
    })
}

fn validate_project(root: &Path, binary_sha256: Option<&str>) -> (Option<Value>, Vec<String>) {
    let path = root.join(".agentic/project.json");
    if !path.is_file() {
        return (None, Vec::new());
    }
    let value: Value = match std::fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
    {
        Some(value) => value,
        None => {
            return (
                None,
                vec![".agentic/project.json is not valid JSON".to_owned()],
            )
        }
    };
    let mut errors = Vec::new();
    if value["version"] != 2 {
        errors.push("project version must be 2; run sealed upgrade".to_owned());
    }
    if value["execution"]["method"] != "adaptive" || value["execution"]["defaultMode"] != "direct" {
        errors.push("execution must use adaptive/direct".to_owned());
    }
    let identity = &value["workspaceTemplate"];
    if identity["packageName"] != "workspace-template" {
        errors.push("workspaceTemplate.packageName does not match the running package".to_owned());
    }
    if identity["releaseVersion"] != env!("CARGO_PKG_VERSION") {
        errors
            .push("workspaceTemplate.releaseVersion does not match the running binary".to_owned());
    }
    if !valid_hex(identity["sourceCommit"].as_str(), 40)
        || identity["sourceCommit"] != env!("WT_SOURCE_COMMIT")
    {
        errors.push(
            "workspaceTemplate.sourceCommit does not match the running source commit".to_owned(),
        );
    }
    if !valid_hex(identity["releaseCommit"].as_str(), 40)
        || identity["releaseCommit"] != release::release_commit()
    {
        errors.push(
            "workspaceTemplate.releaseCommit does not match the running release commit".to_owned(),
        );
    }
    if identity["embeddedAssetManifestSha256"] != assets::manifest_sha256() {
        errors.push("embedded asset manifest does not match the running binary".to_owned());
    }
    if identity["releaseManifestSha256"] != assets::release_manifest_sha256() {
        errors.push("release manifest does not match the running binary".to_owned());
    }
    let platform = format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH);
    let artifact = &identity["artifacts"][&platform];
    if !artifact.is_object() {
        errors.push(format!("project has no artifact identity for {platform}"));
    } else {
        if artifact["packageName"] != "workspace-template" {
            errors.push("platform artifact package name does not match".to_owned());
        }
        if artifact["rustTarget"] != env!("WT_TARGET") {
            errors.push("platform artifact Rust target does not match".to_owned());
        }
        if artifact["executableSha256"].as_str() != binary_sha256 {
            errors.push("platform artifact does not match the running executable".to_owned());
        }
        if !matches!(
            artifact["signingStatus"].as_str(),
            Some("unsigned-development" | "authenticode-rfc3161")
        ) {
            errors.push("platform artifact signing status is invalid".to_owned());
        }
    }
    (Some(value), errors)
}

pub fn doctor(root: &Path) -> (Value, bool) {
    let binary_sha256 = std::env::current_exe()
        .ok()
        .and_then(|path| std::fs::read(path).ok())
        .map(|bytes| hex::encode(Sha256::digest(bytes)));
    let (project, mut errors) = validate_project(root, binary_sha256.as_deref());
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
    if runtime_debug_required(project.as_ref()) {
        errors.push("required runtime-debug capability is unavailable".to_owned());
    }
    let ok = errors.is_empty();
    (
        json!({
            "verdict": if ok { "PASS" } else { "FAIL" },
            "target": root,
            "platform": { "os": std::env::consts::OS, "arch": std::env::consts::ARCH },
            "binarySha256": binary_sha256,
            "sourceCommit": env!("WT_SOURCE_COMMIT"),
            "releaseCommit": release::release_commit(),
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
