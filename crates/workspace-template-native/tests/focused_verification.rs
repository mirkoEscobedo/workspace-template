#![cfg(windows)]

use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

struct Workspace(PathBuf);

impl Workspace {
    fn new() -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("workspace-template-focused-{nonce}"));
        let member = root.join("crates/component");
        fs::create_dir_all(member.join("src")).unwrap();
        fs::create_dir_all(member.join("tests")).unwrap();
        fs::create_dir_all(root.join(".agentic")).unwrap();
        fs::write(
            root.join("Cargo.toml"),
            "[workspace]\nmembers = [\"crates/component\"]\nresolver = \"2\"\n",
        )
        .unwrap();
        fs::write(
            member.join("Cargo.toml"),
            "[package]\nname = \"focused-fixture\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
        )
        .unwrap();
        fs::write(
            member.join("src/lib.rs"),
            "pub fn answer() -> u32 {\n    42\n}\n",
        )
        .unwrap();
        fs::write(member.join("tests/focused.rs"), "#[test]\nfn observable_answer() {\n    assert_eq!(focused_fixture::answer(), 42);\n}\n").unwrap();
        fs::write(member.join("tests/aggregate.rs"), "#[test]\nfn aggregate_fixture() {\n    let path = std::env::var_os(\"WORKSPACE_TEMPLATE_AGGREGATE_MARKER\").unwrap();\n    std::fs::write(path, \"aggregate executed\").unwrap();\n}\n").unwrap();
        fs::write(root.join(".agentic/project.json"), serde_json::to_vec(&json!({"overrides":{"workspace":{"commands":{
            "rust:crates/component": [{"program":"cargo","args":["test","--offline","-p","focused-fixture","--test","focused"],"cwd":"."}]
        }}}})).unwrap()).unwrap();
        Self(root)
    }

    fn run(&self, tail: &[&str]) -> (bool, Value) {
        let output = Command::new(env!("CARGO_BIN_EXE_workspace-template"))
            .args(["verify", self.0.to_str().unwrap()])
            .args(tail)
            .env(
                "WORKSPACE_TEMPLATE_AGGREGATE_MARKER",
                self.0.join("aggregate-ran.txt"),
            )
            .env("CARGO_NET_OFFLINE", "true")
            .output()
            .unwrap();
        (
            output.status.success(),
            serde_json::from_slice::<Value>(&output.stdout).unwrap()["result"].clone(),
        )
    }
}

impl Drop for Workspace {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn existing_override_selects_one_native_fixture_while_root_retains_full_verification() {
    let workspace = Workspace::new();
    let (ok, focused) = workspace.run(&["--scope", "module", "--module", "rust:crates/component"]);
    assert!(ok, "{focused}");
    assert_eq!(focused["steps"].as_array().unwrap().len(), 1);
    assert_eq!(
        focused["steps"][0]["args"],
        json!([
            "test",
            "--offline",
            "-p",
            "focused-fixture",
            "--test",
            "focused"
        ])
    );
    assert!(!workspace.0.join("aggregate-ran.txt").exists());
    assert_eq!(focused["coverage"]["requiredChecksComplete"], false);

    let (ok, full) = workspace.run(&[]);
    assert!(ok, "{full}");
    assert_eq!(full["scope"], "root");
    assert_eq!(full["steps"].as_array().unwrap().len(), 2);
    assert_eq!(
        full["steps"][0]["args"],
        json!(["fmt", "--all", "--", "--check"])
    );
    assert_eq!(full["steps"][1]["args"], json!(["test"]));
    assert_eq!(
        fs::read_to_string(workspace.0.join("aggregate-ran.txt")).unwrap(),
        "aggregate executed"
    );
    assert!(full["steps"]
        .as_array()
        .unwrap()
        .iter()
        .all(|step| step["cleanup"]["qualified"] == true));
}

#[test]
fn unknown_module_cannot_launch_the_focused_or_aggregate_command() {
    let workspace = Workspace::new();
    let (ok, result) = workspace.run(&["--scope", "module", "--module", "rust:missing"]);
    assert!(!ok);
    assert_eq!(result["verdict"], "INSUFFICIENT_EVIDENCE");
    assert_eq!(result["steps"], json!([]));
    assert!(!workspace.0.join("target").exists());
    assert!(!workspace.0.join("aggregate-ran.txt").exists());
}
