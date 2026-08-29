use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use sha2::{Digest, Sha256};

fn repository() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn files_under(root: &Path) -> Vec<PathBuf> {
    fn visit(current: &Path, files: &mut Vec<PathBuf>) {
        let Ok(entries) = fs::read_dir(current) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                visit(&path, files);
            } else if path.is_file() {
                files.push(path);
            }
        }
    }
    let mut files = Vec::new();
    visit(root, &mut files);
    files.sort();
    files
}

#[test]
fn canonical_skill_inventory_is_exact_and_embedded_byte_for_byte() {
    let repository = repository();
    let inventory: serde_json::Value =
        serde_json::from_slice(&fs::read(repository.join("assets/skills/inventory.json")).unwrap())
            .unwrap();
    let expected: BTreeSet<_> = inventory["skills"]
        .as_array()
        .unwrap()
        .iter()
        .map(|skill| skill["name"].as_str().unwrap().to_owned())
        .collect();
    for skill in inventory["skills"].as_array().unwrap() {
        let entrypoint = skill["entrypoint"].as_str().unwrap();
        let content =
            fs::read_to_string(repository.join("assets/skills").join(entrypoint)).unwrap();
        assert!(
            content.contains(&format!(
                "version: \"{}\"",
                skill["version"].as_str().unwrap()
            )),
            "inventory version drifted for {}",
            skill["name"]
        );
        assert_eq!(
            skill["sha256"],
            format!("{:x}", Sha256::digest(content.as_bytes())),
            "inventory hash drifted for {}",
            skill["name"]
        );
        let skill_directory = repository
            .join("assets/skills")
            .join(skill["name"].as_str().unwrap());
        let resources: BTreeSet<_> = files_under(&skill_directory)
            .into_iter()
            .filter(|path| path.file_name().is_none_or(|name| name != "SKILL.md"))
            .map(|path| {
                path.strip_prefix(&skill_directory)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/")
            })
            .collect();
        let declared: BTreeSet<_> = skill["resources"]
            .as_array()
            .unwrap()
            .iter()
            .map(|resource| resource.as_str().unwrap().to_owned())
            .collect();
        assert_eq!(
            resources, declared,
            "resource inventory drifted for {}",
            skill["name"]
        );
    }
    let actual: BTreeSet<_> = fs::read_dir(repository.join("assets/skills"))
        .unwrap()
        .flatten()
        .filter(|entry| entry.path().join("SKILL.md").is_file())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(actual, expected);
    assert_eq!(actual.len(), 13);

    let output = Command::new(env!("CARGO_BIN_EXE_workspace-template"))
        .arg("instructions")
        .output()
        .unwrap();
    assert!(output.status.success());
    let envelope: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    let embedded: BTreeSet<_> = envelope["result"]["embeddedAssets"]["paths"]
        .as_array()
        .unwrap()
        .iter()
        .map(|path| path.as_str().unwrap().to_owned())
        .collect();
    let disk: BTreeSet<_> = files_under(&repository.join("assets"))
        .into_iter()
        .map(|path| {
            path.strip_prefix(&repository)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/")
        })
        .collect();
    assert_eq!(
        embedded, disk,
        "every product asset must be embedded exactly once"
    );
}

#[test]
fn retained_skill_links_resolve_inside_their_skill_root() {
    let skill_root = repository().join("assets/skills");
    for skill_path in files_under(&skill_root)
        .into_iter()
        .filter(|path| path.file_name().is_some_and(|name| name == "SKILL.md"))
    {
        let content = fs::read_to_string(&skill_path).unwrap();
        let mut rest = content.as_str();
        while let Some(start) = rest.find("](") {
            rest = &rest[start + 2..];
            let Some(end) = rest.find(')') else {
                panic!("unterminated Markdown link in {}", skill_path.display());
            };
            let target = &rest[..end];
            rest = &rest[end + 1..];
            if target.contains("://") || target.starts_with('#') {
                continue;
            }
            let resolved = skill_path.parent().unwrap().join(target);
            assert!(
                resolved.is_file(),
                "missing skill resource {} referenced by {}",
                resolved.display(),
                skill_path.display()
            );
        }
    }
}

#[test]
fn legacy_roots_cannot_regrow_product_files() {
    let repository = repository();
    for relative in [
        ".agentic",
        ".agents",
        ".codex",
        ".opencode",
        ".agent",
        "src",
        "test",
        "assets/configs",
        "assets/presets",
        "assets/project-agent",
        "assets/scripts",
        "assets/tooling-packs",
    ] {
        assert!(
            files_under(&repository.join(relative)).is_empty(),
            "prohibited product files regrew under {relative}"
        );
    }
    for prohibited in [
        "frontier-loop",
        "execute-frontier",
        "repair-ticket",
        "ticket-implementer",
        "ticket-review",
        "retrofit-agent-docs",
        "retrofit-ticket-pack",
        "write-skill",
    ] {
        assert!(!repository
            .join("assets/skills")
            .join(prohibited)
            .join("SKILL.md")
            .exists());
    }
    assert!(!repository.join("opencode.json").exists());
    assert!(files_under(&repository.join("scripts"))
        .iter()
        .all(|path| path.extension().is_none_or(|extension| extension != "js")));
}

#[test]
fn third_party_notices_cover_every_locked_registry_crate() {
    let repository = repository();
    let lock = fs::read_to_string(repository.join("Cargo.lock")).unwrap();
    let notices = fs::read_to_string(repository.join("THIRD_PARTY_NOTICES.md")).unwrap();
    for package in lock.split("[[package]]").skip(1) {
        if !package
            .lines()
            .any(|line| line.starts_with("source = \"registry+"))
        {
            continue;
        }
        let value = |prefix: &str| {
            package
                .lines()
                .find_map(|line| line.strip_prefix(prefix))
                .map(|value| value.trim_matches('"'))
                .unwrap()
        };
        let name = value("name = ");
        let version = value("version = ");
        assert!(
            notices.contains(&format!("| {name} | {version} |")),
            "missing third-party notice for {name} {version}"
        );
    }
}
