use std::fs;
use std::path::PathBuf;
use std::process::{Command, Output};
use std::time::{SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
use windows_sys::Win32::System::Console::{GenerateConsoleCtrlEvent, CTRL_BREAK_EVENT};
#[cfg(windows)]
use windows_sys::Win32::System::Threading::CREATE_NEW_PROCESS_GROUP;

fn run(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_workspace-template"))
        .args(args)
        .output()
        .expect("native CLI must launch")
}

fn json(output: &Output) -> serde_json::Value {
    serde_json::from_slice(&output.stdout).expect("CLI must emit one JSON envelope")
}

fn fixture(name: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("workspace-template-v09-{name}-{nonce}"));
    fs::create_dir_all(&root).expect("fixture root");
    root
}

#[test]
fn help_describes_the_json_contract_and_stable_exit_codes() {
    for spelling in ["help", "--help"] {
        let output = run(&[spelling]);
        assert!(output.status.success(), "{spelling}");
        let value = json(&output);
        assert_eq!(value["command"], "help");
        assert_eq!(value["result"]["output"], "json");
        assert_eq!(value["result"]["exitCodes"]["usage"], 64);
        assert!(value["result"]["commands"]
            .as_array()
            .unwrap()
            .iter()
            .any(|command| command == "skills show <name>"));
    }
}

#[test]
fn unknown_options_invalid_values_and_extra_positionals_are_rejected() {
    for args in [
        vec!["version", "extra"],
        vec!["inspect", ".", "extra"],
        vec!["route", "--slice-count", "zero"],
        vec!["route", "--unknown"],
        vec!["verify", ".", "--timeout", "0"],
        vec!["route", "--multi-session", "--multi-session"],
        vec!["verify", ".", "--timeout", "1", "--timeout", "2"],
    ] {
        let output = run(&args);
        assert_eq!(output.status.code(), Some(64), "{args:?}");
        assert_eq!(json(&output)["error"]["code"], "INVALID_ARGUMENT");
    }
}

#[test]
fn embedded_skills_can_be_listed_and_retrieved_exactly() {
    let listed = run(&["skills", "list"]);
    assert!(listed.status.success());
    let listing = json(&listed);
    let skills = listing["result"]["skills"].as_array().unwrap();
    assert_eq!(skills.len(), 13);
    assert!(skills.iter().any(|skill| {
        skill["name"] == "delivery-loop"
            && skill["version"] == "0.8.0"
            && skill["sha256"].as_str().unwrap().len() == 64
    }));
    assert!(!skills.iter().any(|skill| skill["name"] == "frontier-loop"));

    let shown = run(&["skills", "show", "delivery-loop"]);
    assert!(shown.status.success());
    let result = &json(&shown)["result"];
    let repository = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let bytes = fs::read(repository.join("assets/skills/delivery-loop/SKILL.md")).unwrap();
    assert_eq!(result["content"], String::from_utf8(bytes.clone()).unwrap());
    assert_eq!(result["sha256"], format!("{:x}", Sha256::digest(&bytes)));
    assert!(result["resources"]
        .as_array()
        .unwrap()
        .iter()
        .any(|path| path == "references/state-machine.md"));

    let missing = run(&["skills", "show", "not-a-skill"]);
    assert_eq!(missing.status.code(), Some(66));
    assert_eq!(json(&missing)["error"]["code"], "SKILL_NOT_FOUND");
}

#[test]
fn skills_update_is_a_non_mutating_package_manager_migration_message() {
    let root = fixture("skills-update");
    fs::write(root.join("package.json"), "{\"name\":\"fixture\"}\n").unwrap();
    let before = fs::read(root.join("package.json")).unwrap();
    let output = run(&["skills", "update", root.to_str().unwrap()]);
    assert_eq!(output.status.code(), Some(64));
    let value = json(&output);
    assert_eq!(value["error"]["code"], "PACKAGE_MANAGER_UPDATE_REQUIRED");
    assert!(value["error"]["message"]
        .as_str()
        .unwrap()
        .contains("upgrade plan"));
    assert_eq!(fs::read(root.join("package.json")).unwrap(), before);
    assert!(!root.join(".agentic").exists());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn sealed_adopt_writes_project_state_v2_without_mutating_the_manifest() {
    let root = fixture("adopt-v2");
    let manifest = "{\n  \"name\": \"fixture\",\n  \"devDependencies\": {\n    \"workspace-template\": \"0.9.0-alpha.0\"\n  }\n}\n";
    fs::write(root.join("package.json"), manifest).unwrap();
    let plan = root.join("adopt.json");
    let planned = run(&[
        "adopt",
        "plan",
        root.to_str().unwrap(),
        "--plan-out",
        plan.to_str().unwrap(),
    ]);
    assert!(planned.status.success());
    let operations = json(&planned)["result"]["operations"]
        .as_array()
        .unwrap()
        .clone();
    assert!(!operations
        .iter()
        .any(|operation| operation["path"] == "package.json"));
    assert!(!operations
        .iter()
        .any(|operation| operation["path"] == ".agentic/tooling/package.json"));

    let applied = run(&[
        "adopt",
        "apply",
        root.to_str().unwrap(),
        "--apply-plan",
        plan.to_str().unwrap(),
    ]);
    assert!(applied.status.success());
    assert_eq!(
        fs::read_to_string(root.join("package.json")).unwrap(),
        manifest
    );
    let state: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join(".agentic/project.json")).unwrap()).unwrap();
    assert_eq!(state["version"], 2);
    assert_eq!(
        state["workspaceTemplate"]["releaseVersion"],
        "0.9.0-alpha.0"
    );
    assert_eq!(
        state["workspaceTemplate"]["embeddedAssetManifestSha256"]
            .as_str()
            .unwrap()
            .len(),
        64
    );
    assert!(state["workspaceTemplate"]["artifacts"]["windows-x86_64"].is_object());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn update_status_is_read_only_and_reports_exact_package_identity() {
    let root = fixture("update-status");
    fs::create_dir_all(root.join("node_modules/workspace-template")).unwrap();
    fs::write(
        root.join("package.json"),
        "{\"devDependencies\":{\"workspace-template\":\"0.9.0-alpha.0\"}}\n",
    )
    .unwrap();
    fs::write(
        root.join("package-lock.json"),
        "{\"lockfileVersion\":3,\"packages\":{\"node_modules/workspace-template\":{\"version\":\"0.9.0-alpha.0\",\"integrity\":\"sha512-fixture\"}}}\n",
    )
    .unwrap();
    fs::write(
        root.join("node_modules/workspace-template/package.json"),
        "{\"name\":\"workspace-template\",\"version\":\"0.9.0-alpha.0\"}\n",
    )
    .unwrap();
    let before = fs::read(root.join("package.json")).unwrap();
    let output = run(&["update", "status", root.to_str().unwrap()]);
    assert_eq!(output.status.code(), Some(1));
    let value = json(&output);
    assert_eq!(value["result"]["status"], "INCOMPLETE");
    assert_eq!(value["result"]["manifest"]["exact"], true);
    assert_eq!(value["result"]["lockfile"]["integrityPresent"], true);
    assert_eq!(value["result"]["installed"]["versionMatches"], true);
    assert_eq!(value["result"]["projectState"]["present"], false);
    assert_eq!(fs::read(root.join("package.json")).unwrap(), before);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn update_status_classifies_non_exact_git_tarball_and_range_specs_without_writing() {
    for (name, spec) in [
        (
            "git",
            "github:owner/workspace-template#1111111111111111111111111111111111111111",
        ),
        ("tarball", "file:C:/offline/workspace-template.tgz"),
        ("range", "^0.9.0-alpha.0"),
    ] {
        let root = fixture(name);
        let manifest = format!(
            "{{\"devDependencies\":{{\"workspace-template\":{}}}}}\n",
            serde_json::to_string(spec).unwrap()
        );
        fs::write(root.join("package.json"), &manifest).unwrap();
        let output = run(&["update", "status", root.to_str().unwrap()]);
        assert_eq!(output.status.code(), Some(1), "{name}");
        assert_eq!(
            json(&output)["result"]["manifest"]["exact"],
            false,
            "{name}"
        );
        assert_eq!(
            fs::read_to_string(root.join("package.json")).unwrap(),
            manifest
        );
        fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn upgrade_rejects_a_downgrade_without_an_explicit_reviewed_override() {
    let root = fixture("downgrade");
    fs::create_dir_all(root.join(".agentic")).unwrap();
    fs::write(
        root.join(".agentic/project.json"),
        "{\"version\":2,\"workspaceTemplate\":{\"releaseVersion\":\"0.10.0\"},\"capabilities\":{},\"overrides\":{},\"history\":{}}\n",
    )
    .unwrap();
    let plan = root.join("downgrade.json");
    let output = run(&[
        "upgrade",
        "plan",
        root.to_str().unwrap(),
        "--plan-out",
        plan.to_str().unwrap(),
    ]);
    assert_eq!(output.status.code(), Some(3));
    assert_eq!(
        json(&output)["error"]["code"],
        "DOWNGRADE_REQUIRES_APPROVAL"
    );
    assert!(!plan.exists());

    let allowed = run(&[
        "upgrade",
        "plan",
        root.to_str().unwrap(),
        "--plan-out",
        plan.to_str().unwrap(),
        "--allow-downgrade",
    ]);
    assert!(allowed.status.success());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn sealed_delivery_rejects_removed_package_mutation_options() {
    let root = fixture("removed-option");
    let plan = root.join("plan.json");
    let output = run(&[
        "adopt",
        "plan",
        root.to_str().unwrap(),
        "--plan-out",
        plan.to_str().unwrap(),
        "--package-spec",
        "file:legacy.tgz",
    ]);
    assert_eq!(output.status.code(), Some(64));
    assert_eq!(json(&output)["error"]["code"], "INVALID_ARGUMENT");
    assert!(!plan.exists());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn update_status_reaches_current_after_exact_install_and_sealed_adoption() {
    let root = fixture("update-current");
    fs::create_dir_all(root.join("node_modules/workspace-template/bin")).unwrap();
    fs::write(
        root.join("package.json"),
        "{\"devDependencies\":{\"workspace-template\":\"0.9.0-alpha.0\"}}\n",
    )
    .unwrap();
    fs::write(
        root.join("package-lock.json"),
        "{\"lockfileVersion\":3,\"packages\":{\"node_modules/workspace-template\":{\"version\":\"0.9.0-alpha.0\",\"integrity\":\"sha512-fixture\"}}}\n",
    )
    .unwrap();
    fs::write(
        root.join("node_modules/workspace-template/package.json"),
        "{\"name\":\"workspace-template\",\"version\":\"0.9.0-alpha.0\"}\n",
    )
    .unwrap();
    fs::copy(
        env!("CARGO_BIN_EXE_workspace-template"),
        root.join("node_modules/workspace-template/bin/workspace-template.exe"),
    )
    .unwrap();
    let plan = root.join("adopt.json");
    assert!(run(&[
        "adopt",
        "plan",
        root.to_str().unwrap(),
        "--plan-out",
        plan.to_str().unwrap(),
    ])
    .status
    .success());
    assert!(run(&[
        "adopt",
        "apply",
        root.to_str().unwrap(),
        "--apply-plan",
        plan.to_str().unwrap(),
    ])
    .status
    .success());
    let output = run(&["update", "status", root.to_str().unwrap()]);
    assert!(output.status.success());
    assert_eq!(json(&output)["result"]["status"], "CURRENT");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn update_status_reads_pnpm_resolution_and_integrity_without_execution() {
    let root = fixture("pnpm-status");
    fs::create_dir_all(root.join("node_modules/workspace-template")).unwrap();
    fs::write(
        root.join("package.json"),
        "{\"devDependencies\":{\"workspace-template\":\"0.9.0-alpha.0\"}}\n",
    )
    .unwrap();
    fs::write(
        root.join("pnpm-lock.yaml"),
        "lockfileVersion: '9.0'\nimporters:\n  .:\n    devDependencies:\n      workspace-template:\n        specifier: 0.9.0-alpha.0\n        version: 0.9.0-alpha.0\npackages:\n  workspace-template@0.9.0-alpha.0:\n    resolution: {integrity: sha512-fixture}\n",
    )
    .unwrap();
    fs::write(
        root.join("node_modules/workspace-template/package.json"),
        "{\"name\":\"workspace-template\",\"version\":\"0.9.0-alpha.0\"}\n",
    )
    .unwrap();
    let output = run(&["update", "status", root.to_str().unwrap()]);
    let value = json(&output);
    assert_eq!(value["result"]["lockfile"]["manager"], "pnpm");
    assert_eq!(value["result"]["lockfile"]["versionMatches"], true);
    assert_eq!(value["result"]["lockfile"]["integrityPresent"], true);
    fs::remove_dir_all(root).unwrap();
}

#[cfg(windows)]
#[test]
fn cancellation_signal_closes_the_job_and_removes_detached_descendants() {
    let root = fixture("signal-cleanup");
    fs::create_dir_all(root.join("test")).unwrap();
    let marker = root.join("descendant.json");
    fs::write(
        root.join("test/hang.js"),
        format!(
            "import {{ spawn }} from 'node:child_process';\nimport {{ writeFileSync }} from 'node:fs';\nconst child = spawn(process.execPath, ['-e', 'setInterval(() => {{}}, 1000)'], {{ detached: true, stdio: 'ignore' }});\nwriteFileSync({}, JSON.stringify({{ pid: child.pid }}));\nchild.unref();\nsetInterval(() => {{}}, 1000);\n",
            serde_json::to_string(&marker).unwrap()
        ),
    )
    .unwrap();
    fs::write(
        root.join("package.json"),
        "{\"scripts\":{\"check\":\"node test/hang.js\"}}\n",
    )
    .unwrap();
    let mut cli = Command::new(env!("CARGO_BIN_EXE_workspace-template"));
    cli.args(["verify", root.to_str().unwrap(), "--timeout", "30000"])
        .creation_flags(CREATE_NEW_PROCESS_GROUP);
    let mut child = cli.spawn().unwrap();
    let started = std::time::Instant::now();
    while !marker.is_file() && started.elapsed() < std::time::Duration::from_secs(10) {
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    assert!(marker.is_file(), "verification descendant never started");
    assert_ne!(
        unsafe { GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, child.id()) },
        0,
        "failed to deliver the cancellation signal"
    );
    let cancellation_started = std::time::Instant::now();
    loop {
        if child.try_wait().unwrap().is_some() {
            break;
        }
        if cancellation_started.elapsed() > std::time::Duration::from_secs(10) {
            child.kill().unwrap();
            panic!("CLI did not terminate after the cancellation signal");
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    let recorded: serde_json::Value = serde_json::from_slice(&fs::read(&marker).unwrap()).unwrap();
    let pid = recorded["pid"].as_u64().unwrap();
    let absent = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            &format!(
                "if (Get-Process -Id {pid} -ErrorAction SilentlyContinue) {{ exit 1 }} else {{ exit 0 }}"
            ),
        ])
        .status()
        .unwrap();
    assert!(
        absent.success(),
        "detached descendant {pid} survived cancellation"
    );
    fs::remove_dir_all(root).unwrap();
}

#[cfg(windows)]
#[test]
fn successful_root_exit_still_removes_a_surviving_detached_descendant() {
    let root = fixture("root-exit-cleanup");
    fs::create_dir_all(root.join("test")).unwrap();
    let marker = root.join("descendant.json");
    fs::write(
        root.join("test/root-exits.js"),
        format!(
            "import {{ spawn }} from 'node:child_process';\nimport {{ writeFileSync }} from 'node:fs';\nconst child = spawn(process.execPath, ['-e', 'setInterval(() => {{}}, 1000)'], {{ detached: true, stdio: 'ignore' }});\nwriteFileSync({}, JSON.stringify({{ pid: child.pid }}));\nchild.unref();\n",
            serde_json::to_string(&marker).unwrap()
        ),
    )
    .unwrap();
    fs::write(
        root.join("package.json"),
        "{\"scripts\":{\"check\":\"node test/root-exits.js\"}}\n",
    )
    .unwrap();
    let output = run(&["verify", root.to_str().unwrap(), "--timeout", "5000"]);
    assert!(output.status.success());
    assert!(marker.is_file());
    let recorded: serde_json::Value = serde_json::from_slice(&fs::read(&marker).unwrap()).unwrap();
    let pid = recorded["pid"].as_u64().unwrap();
    let absent = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            &format!(
                "if (Get-Process -Id {pid} -ErrorAction SilentlyContinue) {{ exit 1 }} else {{ exit 0 }}"
            ),
        ])
        .status()
        .unwrap();
    assert!(
        absent.success(),
        "detached descendant {pid} survived root exit"
    );
    fs::remove_dir_all(root).unwrap();
}
