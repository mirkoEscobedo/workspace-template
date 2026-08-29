use sha2::{Digest, Sha256};
use std::path::Path;

use serde_json::{json, Value};

pub struct Asset {
    pub path: &'static str,
    pub bytes: &'static [u8],
}

include!(concat!(env!("OUT_DIR"), "/embedded_assets.rs"));

pub fn paths() -> Vec<&'static str> {
    EMBEDDED_ASSETS.iter().map(|asset| asset.path).collect()
}

pub fn manifest_sha256() -> String {
    let mut manifest = Sha256::new();
    for asset in EMBEDDED_ASSETS {
        manifest.update(asset.path.as_bytes());
        manifest.update([0]);
        manifest.update(Sha256::digest(asset.bytes));
    }
    hex::encode(manifest.finalize())
}

pub fn release_manifest_sha256() -> String {
    EMBEDDED_ASSETS
        .iter()
        .find(|asset| asset.path == "assets/release-manifest.json")
        .map(|asset| hex::encode(Sha256::digest(asset.bytes)))
        .unwrap_or_else(|| hex::encode(Sha256::digest([])))
}

fn frontmatter_value(content: &str, key: &str) -> Option<String> {
    let prefix = format!("{key}:");
    let mut lines = content.lines();
    if lines.next() != Some("---") {
        return None;
    }
    lines.take_while(|line| *line != "---").find_map(|line| {
        line.trim_start()
            .strip_prefix(&prefix)
            .map(|value| value.trim().trim_matches('"').to_owned())
    })
}

fn skill_assets(name: &str) -> Option<Vec<&'static Asset>> {
    if name.is_empty()
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return None;
    }
    let prefix = format!("assets/skills/{name}/");
    let assets: Vec<_> = EMBEDDED_ASSETS
        .iter()
        .filter(|asset| asset.path.starts_with(&prefix))
        .collect();
    (!assets.is_empty()).then_some(assets)
}

fn skill_record(name: &str, included: &[&Asset]) -> Option<Value> {
    let skill = included
        .iter()
        .find(|asset| asset.path.ends_with("/SKILL.md"))?;
    let content = std::str::from_utf8(skill.bytes).ok()?;
    Some(json!({
        "name": name,
        "version": frontmatter_value(content, "version").unwrap_or_else(|| "unversioned".to_owned()),
        "description": frontmatter_value(content, "description").unwrap_or_default(),
        "sha256": hex::encode(Sha256::digest(skill.bytes))
    }))
}

pub fn skills_list() -> Value {
    let mut names: Vec<_> = EMBEDDED_ASSETS
        .iter()
        .filter_map(|asset| {
            asset
                .path
                .strip_prefix("assets/skills/")
                .and_then(|rest| rest.strip_suffix("/SKILL.md"))
                .filter(|name| !name.contains('/'))
        })
        .collect();
    names.sort_unstable();
    names.dedup();
    let skills: Vec<_> = names
        .into_iter()
        .filter_map(|name| skill_assets(name).and_then(|included| skill_record(name, &included)))
        .collect();
    let count = skills.len();
    json!({ "skills": skills, "count": count, "manifestSha256": manifest_sha256() })
}

pub fn skills_show(name: &str) -> Option<Value> {
    let included = skill_assets(name)?;
    let skill = included
        .iter()
        .find(|asset| asset.path == format!("assets/skills/{name}/SKILL.md"))?;
    let content = std::str::from_utf8(skill.bytes).ok()?;
    let prefix = format!("assets/skills/{name}/");
    let resources: Vec<_> = included
        .iter()
        .filter(|asset| asset.path != skill.path)
        .map(|asset| asset.path.strip_prefix(&prefix).unwrap_or(asset.path))
        .collect();
    let mut record = skill_record(name, &included)?;
    record["content"] = json!(content);
    record["resources"] = json!(resources);
    Some(record)
}

pub fn verify_readable(root: &Path) -> (usize, Vec<String>) {
    let mut verified = 0;
    let mut mismatches = Vec::new();
    for asset in EMBEDDED_ASSETS {
        match std::fs::read(root.join(asset.path)) {
            Ok(bytes) if Sha256::digest(&bytes) == Sha256::digest(asset.bytes) => {
                verified += 1;
            }
            Ok(_) => mismatches.push(format!("{}: hash mismatch", asset.path)),
            Err(error) => mismatches.push(format!("{}: {error}", asset.path)),
        }
    }
    (verified, mismatches)
}
