use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::{SystemTime, UNIX_EPOCH};

fn fixture(name: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("workspace-template-inspect-{name}-{nonce}"));
    fs::create_dir_all(&root).unwrap();
    root
}

fn run(root: &Path) -> Output {
    Command::new(env!("CARGO_BIN_EXE_workspace-template"))
        .args(["inspect", root.to_str().unwrap()])
        .output()
        .expect("native CLI must launch")
}

fn result(root: &Path) -> serde_json::Value {
    let output = run(root);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
    serde_json::from_slice::<serde_json::Value>(&output.stdout).unwrap()["result"].clone()
}

#[test]
fn node_workspace_reports_modules_internal_edges_and_stable_fingerprint() {
    let root = fixture("node");
    fs::write(
        root.join("package.json"),
        r#"{"name":"root","private":true,"workspaces":["packages/*"]}"#,
    )
    .unwrap();
    fs::write(root.join("pnpm-lock.yaml"), "lockfileVersion: '9.0'\n").unwrap();
    fs::create_dir_all(root.join("packages/a")).unwrap();
    fs::create_dir_all(root.join("packages/b")).unwrap();
    fs::write(
        root.join("packages/a/package.json"),
        r#"{"name":"a","scripts":{"check":"node check.js"},"dependencies":{"b":"workspace:*"}}"#,
    )
    .unwrap();
    fs::write(
        root.join("packages/b/package.json"),
        r#"{"name":"b","scripts":{"test":"node test.js"}}"#,
    )
    .unwrap();

    let first = result(&root);
    let graph = &first["workspace"];
    assert_eq!(graph["schemaVersion"], 1);
    assert_eq!(graph["rootAggregate"]["root"], ".");
    assert_eq!(graph["valid"], true);
    assert_eq!(graph["fingerprint"].as_str().unwrap().len(), 64);
    assert!(graph["modules"].as_array().unwrap().iter().any(|module| {
        module["id"] == "node:packages/a"
            && module["name"] == "a"
            && module["lockOwner"] == "."
            && module["commands"][0]["args"] == serde_json::json!(["run", "check"])
    }));
    assert!(graph["edges"]
        .as_array()
        .unwrap()
        .iter()
        .any(|edge| { edge["from"] == "node:packages/a" && edge["to"] == "node:packages/b" }));
    assert_eq!(
        result(&root)["workspace"]["fingerprint"],
        graph["fingerprint"]
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn polyglot_workspace_reports_cargo_and_dart_modules() {
    let root = fixture("polyglot");
    fs::write(
        root.join("Cargo.toml"),
        "[workspace]\nmembers = [\"crates/core\"]\n",
    )
    .unwrap();
    fs::create_dir_all(root.join("crates/core/src")).unwrap();
    fs::write(
        root.join("crates/core/Cargo.toml"),
        "[package]\nname = \"core\"\nversion = \"0.1.0\"\n",
    )
    .unwrap();
    fs::write(
        root.join("pubspec.yaml"),
        "name: root_tools\nworkspace:\n  - packages/ui\n",
    )
    .unwrap();
    fs::create_dir_all(root.join("packages/ui")).unwrap();
    fs::write(
        root.join("packages/ui/pubspec.yaml"),
        "name: ui\ndependencies:\n  flutter:\n    sdk: flutter\n",
    )
    .unwrap();

    let graph = result(&root)["workspace"].clone();
    let ids: Vec<_> = graph["modules"]
        .as_array()
        .unwrap()
        .iter()
        .map(|module| module["id"].as_str().unwrap())
        .collect();
    assert!(ids.contains(&"rust:crates/core"));
    assert!(ids.contains(&"flutter:packages/ui"));
    assert_eq!(graph["valid"], true);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn workspace_overrides_add_structured_commands_and_reject_escaping_paths() {
    let root = fixture("overrides");
    fs::write(root.join("package.json"), r#"{"name":"root"}"#).unwrap();
    fs::create_dir_all(root.join(".agentic")).unwrap();
    fs::write(
        root.join(".agentic/project.json"),
        r#"{"overrides":{"workspace":{"commands":{"node:.":[{"program":"npm.cmd","args":["run","lint"],"cwd":"."}]},"modules":[{"root":"../escape","kind":"node"}]}}}"#,
    )
    .unwrap();

    let graph = result(&root)["workspace"].clone();
    assert_eq!(graph["valid"], false);
    assert!(graph["conflicts"]
        .as_array()
        .unwrap()
        .iter()
        .any(|conflict| { conflict["code"] == "UNSAFE_OVERRIDE_PATH" }));
    let root_module = graph["modules"]
        .as_array()
        .unwrap()
        .iter()
        .find(|module| module["id"] == "node:.")
        .unwrap();
    assert_eq!(root_module["commands"][0]["program"], "npm.cmd");
    assert_eq!(
        root_module["commands"][0]["args"],
        serde_json::json!(["run", "lint"])
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn yarn_members_are_observable_but_never_executable() {
    let root = fixture("yarn-opaque");
    fs::write(
        root.join("package.json"),
        r#"{"name":"root","workspaces":["packages/a"]}"#,
    )
    .unwrap();
    fs::write(root.join("yarn.lock"), "# lock\n").unwrap();
    fs::create_dir_all(root.join("packages/a")).unwrap();
    fs::write(
        root.join("packages/a/package.json"),
        r#"{"name":"a","scripts":{"test":"exit 99"}}"#,
    )
    .unwrap();

    let graph = result(&root)["workspace"].clone();
    let module = &graph["modules"][0];
    assert_eq!(module["toolchain"], "yarn");
    assert_eq!(module["opaque"], true);
    assert_eq!(module["commands"], serde_json::json!([]));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn explicit_override_edges_report_cycles_and_overlapping_roots() {
    let root = fixture("override-conflicts");
    fs::create_dir_all(root.join(".agentic")).unwrap();
    fs::write(
        root.join(".agentic/project.json"),
        r#"{"overrides":{"workspace":{"modules":[{"id":"opaque:a","root":"packages","dependencies":["opaque:b"]},{"id":"opaque:b","root":"packages/b","dependencies":["opaque:a"]}]}}}"#,
    )
    .unwrap();

    let graph = result(&root)["workspace"].clone();
    let codes: Vec<_> = graph["conflicts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|conflict| conflict["code"].as_str().unwrap())
        .collect();
    assert!(codes.contains(&"OVERLAPPING_MODULE_ROOTS"));
    assert!(codes.contains(&"DEPENDENCY_CYCLE"));
    assert!(graph["edges"]
        .as_array()
        .unwrap()
        .iter()
        .any(|edge| edge["from"] == "opaque:a" && edge["to"] == "opaque:b"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn unmatched_workspace_patterns_are_reported_as_missing_members() {
    let root = fixture("missing-member");
    fs::write(
        root.join("package.json"),
        r#"{"name":"root","workspaces":["packages/*"]}"#,
    )
    .unwrap();

    let graph = result(&root)["workspace"].clone();
    assert_eq!(graph["valid"], false);
    assert!(graph["conflicts"]
        .as_array()
        .unwrap()
        .iter()
        .any(|conflict| conflict["code"] == "MISSING_MEMBER"));
    fs::remove_dir_all(root).unwrap();
}

#[cfg(windows)]
#[test]
fn workspace_symlink_that_escapes_the_root_is_unsafe() {
    let root = fixture("unsafe-link");
    let external = fixture("unsafe-link-target");
    fs::write(
        root.join("package.json"),
        r#"{"name":"root","workspaces":["linked"]}"#,
    )
    .unwrap();
    fs::write(external.join("package.json"), r#"{"name":"outside"}"#).unwrap();
    let linked = root.join("linked");
    let junction = Command::new("cmd.exe")
        .args([
            "/D",
            "/C",
            "mklink",
            "/J",
            linked.to_str().unwrap(),
            external.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(
        junction.status.success(),
        "junction fixture must be available"
    );

    let graph = result(&root)["workspace"].clone();
    assert_eq!(graph["valid"], false);
    assert!(graph["unsafeSymlinks"]
        .as_array()
        .unwrap()
        .iter()
        .any(|path| path == "linked"));
    fs::remove_dir(&linked).unwrap();
    fs::remove_dir_all(root).unwrap();
    fs::remove_dir_all(external).unwrap();
}

#[test]
fn duplicate_names_case_collisions_and_multiple_lock_owners_are_conflicts() {
    let root = fixture("ambiguous");
    fs::write(root.join("package-lock.json"), "{}").unwrap();
    fs::write(root.join("pnpm-lock.yaml"), "lockfileVersion: '9.0'\n").unwrap();
    fs::create_dir_all(root.join("one")).unwrap();
    fs::create_dir_all(root.join("two")).unwrap();
    fs::write(root.join("one/package.json"), r#"{"name":"duplicate"}"#).unwrap();
    fs::write(root.join("two/package.json"), r#"{"name":"duplicate"}"#).unwrap();
    fs::write(root.join("package.json"), r#"{"workspaces":["one","two"]}"#).unwrap();
    fs::create_dir_all(root.join(".agentic")).unwrap();
    fs::write(
        root.join(".agentic/project.json"),
        r#"{"overrides":{"workspace":{"modules":[{"root":"Case","kind":"unknown"},{"root":"case","kind":"unknown"}]}}}"#,
    )
    .unwrap();

    let graph = result(&root)["workspace"].clone();
    let codes: Vec<_> = graph["conflicts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|conflict| conflict["code"].as_str().unwrap())
        .collect();
    assert!(codes.contains(&"DUPLICATE_PACKAGE_NAME"));
    assert!(codes.contains(&"CASE_COLLISION"));
    assert!(codes.contains(&"MULTIPLE_LOCK_OWNERS"));
    fs::remove_dir_all(root).unwrap();
}
