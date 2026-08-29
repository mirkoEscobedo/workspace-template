use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::{SystemTime, UNIX_EPOCH};

fn run(args: &[String]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_workspace-template"))
        .args(args)
        .output()
        .expect("native CLI must launch")
}

fn fixture(name: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("workspace-template-adoption-{name}-{nonce}"));
    fs::create_dir_all(&root).expect("fixture root");
    root
}

fn json(output: &Output) -> serde_json::Value {
    serde_json::from_slice(&output.stdout).expect("CLI must emit JSON")
}

fn plan_and_apply(root: &Path, plan: &Path) {
    let planned = run(&[
        "adopt".to_owned(),
        "plan".to_owned(),
        root.to_string_lossy().into_owned(),
        "--plan-out".to_owned(),
        plan.to_string_lossy().into_owned(),
    ]);
    assert!(
        planned.status.success(),
        "{}",
        String::from_utf8_lossy(&planned.stdout)
    );
    let applied = run(&[
        "adopt".to_owned(),
        "apply".to_owned(),
        root.to_string_lossy().into_owned(),
        "--apply-plan".to_owned(),
        plan.to_string_lossy().into_owned(),
    ]);
    assert!(
        applied.status.success(),
        "{}",
        String::from_utf8_lossy(&applied.stdout)
    );
}

#[test]
fn empty_existing_directory_adopts_only_thin_managed_state_and_converges() {
    let root = fixture("empty");
    let plan = root.join("adopt.json");
    plan_and_apply(&root, &plan);

    let mut top_level: Vec<_> = fs::read_dir(&root)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    top_level.sort();
    assert_eq!(
        top_level,
        [".agentic", ".gitignore", "AGENTS.md", "adopt.json"]
    );
    assert!(root.join(".agentic/project.json").is_file());
    assert!(!root.join("package.json").exists());
    assert!(!root.join("Cargo.toml").exists());

    let agents = fs::read_to_string(root.join("AGENTS.md")).unwrap();
    for expected in [
        "skills show tdd",
        "skills show implementation-style",
        "skills show diagnose",
        "skills show process-lifecycle",
        "skills show verify",
        "Wayfinder only when a route-changing ambiguity remains",
        "Ticket compilation only after Ticketed or Governed routing",
    ] {
        assert!(
            agents.contains(expected),
            "missing managed routing: {expected}"
        );
    }

    let second_plan = root.join("second.json");
    let second = run(&[
        "adopt".to_owned(),
        "plan".to_owned(),
        root.to_string_lossy().into_owned(),
        "--plan-out".to_owned(),
        second_plan.to_string_lossy().into_owned(),
    ]);
    assert!(second.status.success());
    assert_eq!(json(&second)["result"]["operations"], serde_json::json!([]));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn non_node_root_with_agentic_tooling_uses_the_local_npm_entry_point() {
    let root = fixture("agentic-tooling");
    fs::create_dir_all(root.join(".agentic/tooling")).unwrap();
    fs::write(
        root.join(".agentic/tooling/package.json"),
        "{\"private\":true}\n",
    )
    .unwrap();

    let plan = root.join("adopt.json");
    plan_and_apply(&root, &plan);

    let agents = fs::read_to_string(root.join("AGENTS.md")).unwrap();
    assert!(
        agents.contains("npm exec --prefix .agentic/tooling -- workspace-template skills show tdd")
    );
    assert!(!agents.contains("Use `workspace-template` as this repository's"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn adopt_rejects_a_nonexistent_root_without_creating_it() {
    let parent = fixture("missing-parent");
    let root = parent.join("missing");
    let plan = parent.join("adopt.json");
    let output = run(&[
        "adopt".to_owned(),
        "plan".to_owned(),
        root.to_string_lossy().into_owned(),
        "--plan-out".to_owned(),
        plan.to_string_lossy().into_owned(),
    ]);
    assert!(!output.status.success());
    assert!(!root.exists());
    assert!(!plan.exists());
    fs::remove_dir_all(parent).unwrap();
}

#[test]
fn create_returns_the_official_initializer_and_adopt_migration() {
    let output = run(&["create".to_owned()]);
    assert_eq!(output.status.code(), Some(64));
    let value = json(&output);
    assert_eq!(value["error"]["code"], "OFFICIAL_INITIALIZER_REQUIRED");
    let message = value["error"]["message"].as_str().unwrap();
    assert!(message.contains("official language or framework initializer"));
    assert!(message.contains("adopt plan"));
    assert!(message.contains("adopt apply"));
}
