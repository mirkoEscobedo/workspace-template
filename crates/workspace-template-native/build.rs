use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn collect(root: &Path, current: &Path, output: &mut Vec<String>) {
    let mut entries: Vec<_> = fs::read_dir(current)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", current.display()))
        .map(|entry| entry.expect("asset directory entry"))
        .collect();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        if path.is_dir() {
            collect(root, &path, output);
        } else if path.is_file() {
            output.push(
                path.strip_prefix(root)
                    .expect("asset must be under repository root")
                    .to_string_lossy()
                    .replace('\\', "/"),
            );
        }
    }
}

fn main() {
    let crate_root = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").expect("manifest root"));
    let repository_root = crate_root.join("../..");
    let source_commit = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(&repository_root)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        .filter(|value| value.len() == 40)
        .unwrap_or_else(|| "0000000000000000000000000000000000000000".to_owned());
    println!("cargo:rustc-env=WT_SOURCE_COMMIT={source_commit}");
    println!(
        "cargo:rustc-env=WT_TARGET={}",
        std::env::var("TARGET").unwrap_or_default()
    );
    println!(
        "cargo:rerun-if-changed={}",
        repository_root.join(".git/HEAD").display()
    );
    let mut assets = Vec::new();
    for relative in [
        "assets/schemas",
        "assets/skills/delivery-loop",
        "assets/skills/execute-delivery/SKILL.md",
        "assets/skills/review-change",
        "assets/skills/repair-change/SKILL.md",
        "assets/skills/diagnose/SKILL.md",
        "assets/skills/compile-master-plan/SKILL.md",
        "assets/skills/wayfinder/SKILL.md",
        "assets/skills/wayfinder/assets/decision-template.md",
        "assets/skills/verify/SKILL.md",
        "assets/skills/tdd",
        "assets/skills/implementation-style",
        "assets/skills/test-topology",
        "assets/skills/process-lifecycle/SKILL.md",
        "assets/skills/process-lifecycle/references/windows-job-object.md",
        "assets/skills/integrate-wave",
    ] {
        let path = repository_root.join(relative);
        println!("cargo:rerun-if-changed={}", path.display());
        if path.is_dir() {
            collect(&repository_root, &path, &mut assets);
        } else if path.is_file() {
            assets.push(relative.to_owned());
        } else {
            panic!("canonical asset does not exist: {}", path.display());
        }
    }
    assets.sort();

    let mut generated = String::from("pub static EMBEDDED_ASSETS: &[Asset] = &[\n");
    for path in assets {
        generated.push_str(&format!(
            "    Asset {{ path: {path:?}, bytes: include_bytes!(concat!(env!(\"CARGO_MANIFEST_DIR\"), \"/../../{path}\")) }},\n"
        ));
    }
    generated.push_str("];\n");
    let destination =
        PathBuf::from(std::env::var_os("OUT_DIR").expect("OUT_DIR")).join("embedded_assets.rs");
    fs::write(destination, generated).expect("write embedded asset table");
}
