use std::path::{Path, PathBuf};

use serde_json::{json, Value};

fn exists(root: &Path, relative: &str) -> bool {
    root.join(relative).is_file()
}

pub fn inspect(root: &Path) -> Value {
    let absolute = std::fs::canonicalize(root).unwrap_or_else(|_| PathBuf::from(root));
    let project_kind = if exists(root, "pubspec.yaml") {
        "flutter"
    } else if exists(root, "Cargo.toml") {
        "rust"
    } else if exists(root, "pnpm-lock.yaml") {
        "pnpm"
    } else if exists(root, "package.json") {
        "node"
    } else {
        "unknown"
    };
    json!({
        "root": absolute,
        "projectKind": project_kind,
        "thinState": exists(root, ".agentic/project.json"),
        "legacyInputs": {
            "config": exists(root, ".agentic/config.json"),
            "profile": exists(root, ".agentic/profile.json")
        },
        "manifests": {
            "packageJson": exists(root, "package.json"),
            "pnpmLock": exists(root, "pnpm-lock.yaml"),
            "cargo": exists(root, "Cargo.toml"),
            "flutter": exists(root, "pubspec.yaml")
        }
    })
}
