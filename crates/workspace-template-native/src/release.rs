use std::path::PathBuf;

use serde_json::Value;
use sha2::{Digest, Sha256};

pub fn package_root() -> Option<PathBuf> {
    let executable = std::env::current_exe().ok()?;
    executable
        .ancestors()
        .find(|ancestor| {
            ancestor.join("package.json").is_file() && ancestor.join("assets/skills").is_dir()
        })
        .map(std::path::Path::to_owned)
}

pub fn provenance() -> Option<Value> {
    let root = package_root()?;
    let value: Value = std::fs::read(root.join("workspace-template.provenance.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())?;
    let executable_sha256 = std::env::current_exe()
        .ok()
        .and_then(|path| std::fs::read(path).ok())
        .map(|bytes| hex::encode(Sha256::digest(bytes)))?;
    (value["executable"]["sha256"].as_str() == Some(executable_sha256.as_str())).then_some(value)
}

pub fn release_commit() -> String {
    provenance()
        .and_then(|value| {
            value["release"]["releaseCommit"]
                .as_str()
                .map(str::to_owned)
        })
        .unwrap_or_else(|| env!("WT_RELEASE_COMMIT").to_owned())
}

pub fn signing_status() -> String {
    provenance()
        .and_then(|value| {
            value["executable"]["signingStatus"]
                .as_str()
                .map(str::to_owned)
        })
        .filter(|value| {
            matches!(
                value.as_str(),
                "unsigned-development" | "authenticode-rfc3161"
            )
        })
        .unwrap_or_else(|| "unsigned-development".to_owned())
}
