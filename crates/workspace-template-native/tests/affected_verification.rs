#![cfg(windows)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::{SystemTime, UNIX_EPOCH};

fn fixture(name: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("workspace-template-verify-{name}-{nonce}"));
    fs::create_dir_all(&root).unwrap();
    root
}

fn git(root: &Path, args: &[&str]) {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn run(args: &[String]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_workspace-template"))
        .args(args)
        .output()
        .expect("native CLI must launch")
}

fn setup_workspace(root: &Path) {
    fs::write(
        root.join("package.json"),
        r#"{"private":true,"workspaces":["packages/*"]}"#,
    )
    .unwrap();
    for (name, dependencies) in [
        ("a", r#","dependencies":{"b":"workspace:*"}"#),
        ("b", ""),
        ("c", ""),
    ] {
        let member = root.join("packages").join(name);
        fs::create_dir_all(&member).unwrap();
        fs::write(
            member.join("package.json"),
            format!(r#"{{"name":"{name}"{dependencies}}}"#),
        )
        .unwrap();
        fs::write(member.join("source.txt"), format!("{name}\n")).unwrap();
    }
    fs::create_dir_all(root.join(".agentic")).unwrap();
    fs::write(
        root.join(".agentic/project.json"),
        r#"{"overrides":{"workspace":{"commands":{"node:packages/a":[{"program":"cmd.exe","args":["/D","/C","exit 0"],"cwd":"packages/a"}],"node:packages/b":[{"program":"cmd.exe","args":["/D","/C","exit 0"],"cwd":"packages/b"}],"node:packages/c":[{"program":"cmd.exe","args":["/D","/C","exit 0"],"cwd":"packages/c"}]}}}}"#,
    )
    .unwrap();
    git(root, &["init", "-q"]);
    git(root, &["config", "user.email", "test@example.invalid"]);
    git(root, &["config", "user.name", "Test"]);
    git(root, &["add", "."]);
    git(root, &["commit", "-qm", "fixture"]);
}

#[test]
fn affected_scope_selects_changed_module_and_transitive_dependents_in_order() {
    let root = fixture("affected");
    setup_workspace(&root);
    fs::write(root.join("packages/b/source.txt"), "changed\n").unwrap();

    let output = run(&[
        "verify".to_owned(),
        root.to_string_lossy().into_owned(),
        "--scope".to_owned(),
        "affected".to_owned(),
        "--concurrency".to_owned(),
        "1".to_owned(),
    ]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
    let result = &serde_json::from_slice::<serde_json::Value>(&output.stdout).unwrap()["result"];
    assert_eq!(
        result["selection"]["modules"],
        serde_json::json!(["node:packages/a", "node:packages/b"])
    );
    let executed: Vec<_> = result["steps"]
        .as_array()
        .unwrap()
        .iter()
        .map(|step| step["module"].as_str().unwrap())
        .collect();
    assert_eq!(executed, ["node:packages/b", "node:packages/a"]);
    assert!(!executed.contains(&"node:packages/c"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn unknown_module_is_rejected_before_any_command_runs() {
    let root = fixture("unknown");
    setup_workspace(&root);
    let marker = root.join("ran.txt");
    let output = run(&[
        "verify".to_owned(),
        root.to_string_lossy().into_owned(),
        "--scope".to_owned(),
        "module".to_owned(),
        "--module".to_owned(),
        "node:missing".to_owned(),
    ]);
    assert!(!output.status.success());
    assert!(!marker.exists());
    let result = &serde_json::from_slice::<serde_json::Value>(&output.stdout).unwrap()["result"];
    assert_eq!(result["verdict"], "INSUFFICIENT_EVIDENCE");
    assert!(result["errors"][0]
        .as_str()
        .unwrap()
        .contains("node:missing"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn unowned_root_change_conservatively_selects_every_module() {
    let root = fixture("root-change");
    setup_workspace(&root);
    fs::write(root.join("README.md"), "root-wide\n").unwrap();
    let output = run(&[
        "verify".to_owned(),
        root.to_string_lossy().into_owned(),
        "--scope".to_owned(),
        "affected".to_owned(),
    ]);
    assert!(output.status.success());
    let result = &serde_json::from_slice::<serde_json::Value>(&output.stdout).unwrap()["result"];
    assert_eq!(
        result["selection"]["modules"],
        serde_json::json!(["node:packages/a", "node:packages/b", "node:packages/c"])
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn failed_dependency_blocks_dependents_but_unrelated_modules_finish() {
    let root = fixture("failure-blocking");
    setup_workspace(&root);
    fs::write(
        root.join(".agentic/project.json"),
        r#"{"overrides":{"workspace":{"commands":{"node:packages/a":[{"program":"cmd.exe","args":["/D","/C","exit 0"],"cwd":"packages/a"}],"node:packages/b":[{"program":"cmd.exe","args":["/D","/C","exit 7"],"cwd":"packages/b"}],"node:packages/c":[{"program":"cmd.exe","args":["/D","/C","exit 0"],"cwd":"packages/c"}]}}}}"#,
    )
    .unwrap();

    let output = run(&[
        "verify".to_owned(),
        root.to_string_lossy().into_owned(),
        "--scope".to_owned(),
        "all".to_owned(),
        "--concurrency".to_owned(),
        "1".to_owned(),
    ]);
    assert!(!output.status.success());
    let result = &serde_json::from_slice::<serde_json::Value>(&output.stdout).unwrap()["result"];
    assert_eq!(result["verdict"], "FAIL");
    assert_eq!(result["blocked"], serde_json::json!(["node:packages/a"]));
    let executed: Vec<_> = result["steps"]
        .as_array()
        .unwrap()
        .iter()
        .map(|step| step["module"].as_str().unwrap())
        .collect();
    assert!(executed.contains(&"node:packages/b"));
    assert!(executed.contains(&"node:packages/c"));
    assert!(!executed.contains(&"node:packages/a"));
    fs::remove_dir_all(root).unwrap();
}
