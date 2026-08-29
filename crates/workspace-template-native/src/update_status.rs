use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::{assets, release};

const PACKAGE_NAME: &str = "workspace-template-win32-x64";
const VERSION: &str = env!("CARGO_PKG_VERSION");

fn read_json(path: &Path) -> Option<Value> {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
}

fn dependency_spec(manifest: &Value) -> Option<&str> {
    ["dependencies", "devDependencies", "optionalDependencies"]
        .into_iter()
        .find_map(|section| manifest[section][PACKAGE_NAME].as_str())
}

fn installed_path(root: &Path) -> PathBuf {
    root.join("node_modules").join(PACKAGE_NAME)
}

fn npm_lock(root: &Path) -> Option<Value> {
    read_json(&root.join("package-lock.json"))
}

fn pnpm_lock_status(root: &Path) -> Option<Value> {
    let content = std::fs::read_to_string(root.join("pnpm-lock.yaml")).ok()?;
    let resolution_key = format!("{PACKAGE_NAME}@{VERSION}:");
    let version_matches = content
        .lines()
        .any(|line| line.trim().contains(&resolution_key));
    let integrity_present = content.lines().any(|line| line.contains("integrity:"));
    Some(json!({
        "manager": "pnpm",
        "present": true,
        "versionMatches": version_matches,
        "integrityPresent": integrity_present
    }))
}

fn lock_status(root: &Path) -> Value {
    if let Some(lock) = npm_lock(root) {
        let key = format!("node_modules/{PACKAGE_NAME}");
        let entry = &lock["packages"][&key];
        return json!({
            "manager": "npm",
            "present": true,
            "version": entry["version"],
            "versionMatches": entry["version"] == VERSION,
            "integrityPresent": entry["integrity"].as_str().is_some_and(|value| !value.is_empty())
        });
    }
    pnpm_lock_status(root).unwrap_or_else(|| {
        json!({
            "manager": null,
            "present": false,
            "versionMatches": false,
            "integrityPresent": false
        })
    })
}

fn platform_key() -> String {
    format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
}

pub fn status(root: &Path) -> (Value, bool) {
    let running_executable = std::env::current_exe().ok();
    let executable_sha256 = running_executable
        .as_ref()
        .and_then(|path| std::fs::read(path).ok())
        .map(|bytes| hex::encode(Sha256::digest(bytes)));
    let manifest = read_json(&root.join("package.json"));
    let spec = manifest.as_ref().and_then(dependency_spec);
    let manifest_status = json!({
        "present": manifest.is_some(),
        "packageName": PACKAGE_NAME,
        "spec": spec,
        "exact": spec == Some(VERSION)
    });

    let lock = lock_status(root);
    let installed_root = installed_path(root);
    let installed_manifest = read_json(&installed_root.join("package.json"));
    let installed_executable_sha256 =
        std::fs::read(installed_root.join("bin/workspace-template.exe"))
            .ok()
            .map(|bytes| hex::encode(Sha256::digest(bytes)));
    let installed_executable_matches =
        installed_executable_sha256.is_some() && installed_executable_sha256 == executable_sha256;
    let installed_status = json!({
        "present": installed_manifest.is_some(),
        "name": installed_manifest.as_ref().and_then(|value| value["name"].as_str()),
        "version": installed_manifest.as_ref().and_then(|value| value["version"].as_str()),
        "nameMatches": installed_manifest.as_ref().and_then(|value| value["name"].as_str()) == Some(PACKAGE_NAME),
        "versionMatches": installed_manifest.as_ref().and_then(|value| value["version"].as_str()) == Some(VERSION),
        "executableSha256": installed_executable_sha256,
        "executableMatchesRunning": installed_executable_matches
    });

    let project = read_json(&root.join(".agentic/project.json"));
    let key = platform_key();
    let project_artifact = project
        .as_ref()
        .map(|value| &value["workspaceTemplate"]["artifacts"][&key]);
    let project_status = json!({
        "present": project.is_some(),
        "schemaVersion": project.as_ref().map(|value| value["version"].clone()),
        "releaseVersionMatches": project.as_ref().and_then(|value| value["workspaceTemplate"]["releaseVersion"].as_str()) == Some(VERSION),
        "sourceCommitMatches": project.as_ref().and_then(|value| value["workspaceTemplate"]["sourceCommit"].as_str()) == Some(env!("WT_SOURCE_COMMIT")),
        "releaseCommitMatches": project.as_ref().and_then(|value| value["workspaceTemplate"]["releaseCommit"].as_str()).is_some_and(|value| value == release::release_commit()),
        "assetManifestMatches": project.as_ref().and_then(|value| value["workspaceTemplate"]["embeddedAssetManifestSha256"].as_str()).is_some_and(|value| value == assets::manifest_sha256()),
        "releaseManifestMatches": project.as_ref().and_then(|value| value["workspaceTemplate"]["releaseManifestSha256"].as_str()).is_some_and(|value| value == assets::release_manifest_sha256()),
        "platformArtifactPresent": project_artifact.is_some_and(|artifact| artifact.is_object()),
        "platformArtifactMatches": project_artifact.is_some_and(|artifact| {
            artifact["packageName"] == PACKAGE_NAME
                && artifact["rustTarget"] == env!("WT_TARGET")
                && artifact["executableSha256"].as_str() == executable_sha256.as_deref()
                && artifact["signingStatus"] == release::signing_status()
        })
    });

    let binary_status = json!({
        "version": VERSION,
        "sourceCommit": env!("WT_SOURCE_COMMIT"),
        "releaseCommit": release::release_commit(),
        "target": env!("WT_TARGET"),
        "executableSha256": executable_sha256
    });

    let current = manifest_status["exact"] == true
        && lock["versionMatches"] == true
        && lock["integrityPresent"] == true
        && installed_status["nameMatches"] == true
        && installed_status["versionMatches"] == true
        && installed_status["executableMatchesRunning"] == true
        && project_status["schemaVersion"] == 2
        && project_status["releaseVersionMatches"] == true
        && project_status["sourceCommitMatches"] == true
        && project_status["releaseCommitMatches"] == true
        && project_status["assetManifestMatches"] == true
        && project_status["releaseManifestMatches"] == true
        && project_status["platformArtifactPresent"] == true
        && project_status["platformArtifactMatches"] == true;

    (
        json!({
            "status": if current { "CURRENT" } else { "INCOMPLETE" },
            "target": root,
            "manifest": manifest_status,
            "lockfile": lock,
            "installed": installed_status,
            "binary": binary_status,
            "projectState": project_status,
            "mutated": false
        }),
        current,
    )
}
