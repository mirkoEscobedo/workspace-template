use std::fs;
use std::path::PathBuf;
use std::process::{Command, Output};
use std::time::{SystemTime, UNIX_EPOCH};

use sha2::Digest;

fn run(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_workspace-template"))
        .args(args)
        .output()
        .expect("native CLI must launch")
}

fn run_owned(args: &[String]) -> Output {
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
    let root = std::env::temp_dir().join(format!("workspace-template-native-{name}-{nonce}"));
    fs::create_dir_all(&root).expect("fixture root");
    root
}

fn json(output: &Output) -> serde_json::Value {
    serde_json::from_slice(&output.stdout).expect("CLI must emit JSON")
}

#[test]
fn ordinary_work_routes_direct_without_wayfinder() {
    let output = run(&["route", "--json"]);
    assert!(output.status.success());
    let value = json(&output);
    assert_eq!(value["ok"], true);
    assert_eq!(value["result"]["mode"], "direct");
    assert_eq!(value["result"]["wayfinderAdmitted"], false);
    assert_eq!(value["result"]["durableArtifacts"], serde_json::json!([]));
}

#[test]
fn multi_session_work_routes_ticketed() {
    let output = run(&["route", "--json", "--multi-session"]);
    assert!(output.status.success());
    let value = json(&output);
    assert_eq!(value["result"]["mode"], "ticketed");
    assert_eq!(
        value["result"]["durableArtifacts"],
        serde_json::json!(["compact-plan", "current-ticket"])
    );
}

#[test]
fn enumerated_high_consequence_work_routes_governed() {
    for flag in [
        "--irreversible",
        "--credentials",
        "--security",
        "--financial-authority",
        "--destructive-migration",
        "--native-process-ownership",
        "--external-authority",
    ] {
        let output = run(&["route", "--json", flag]);
        assert!(output.status.success(), "{flag}");
        assert_eq!(json(&output)["result"]["mode"], "governed", "{flag}");
    }
}

#[test]
fn unsupported_native_commands_fail_without_node_fallback() {
    for command in ["tooling", "preset", "restructure", "align"] {
        let output = run(&[command, "--json"]);
        assert_eq!(output.status.code(), Some(64), "{command}");
        let value = json(&output);
        assert_eq!(value["ok"], false, "{command}");
        assert_eq!(
            value["error"]["code"], "UNSUPPORTED_PORTABLE_CAPABILITY",
            "{command}"
        );
    }
}

#[test]
fn instructions_report_embedded_canonical_assets() {
    let output = run(&["instructions", "--json"]);
    assert!(output.status.success());
    let value = json(&output);
    assert_eq!(value["result"]["method"], "adaptive");
    assert_eq!(value["result"]["defaultMode"], "direct");
    assert!(value["result"]["embeddedAssets"]["count"].as_u64().unwrap() > 20);
    let paths = value["result"]["embeddedAssets"]["paths"]
        .as_array()
        .expect("asset paths");
    assert!(paths
        .iter()
        .any(|path| path == "assets/skills/delivery-loop/SKILL.md"));
    assert!(paths
        .iter()
        .any(|path| path == "assets/schemas/project.schema.json"));
    for legacy in [
        "frontier-loop",
        "execute-frontier",
        "ticket-review",
        "repair-ticket",
        "retrofit-ticket-pack",
        "validate_ticket_pack.py",
    ] {
        assert!(
            !paths
                .iter()
                .any(|path| path.as_str().unwrap().contains(legacy)),
            "legacy executable methodology leaked into embedded assets: {legacy}"
        );
    }
}

#[test]
fn methodology_evals_cover_bounded_transitions_regressions_and_inspection_guards() {
    let repository = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let delivery: serde_json::Value = serde_json::from_slice(
        &fs::read(repository.join("assets/skills/delivery-loop/evals/evals.json")).unwrap(),
    )
    .unwrap();
    let review: serde_json::Value = serde_json::from_slice(
        &fs::read(repository.join("assets/skills/review-change/evals/evals.json")).unwrap(),
    )
    .unwrap();
    let delivery_ids: Vec<_> = delivery["evals"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_str().unwrap())
        .collect();
    for required in [
        "ordinary-direct",
        "diagnostic-repair",
        "classified-flaky-rerun",
        "exhausted-repair",
        "alternate-route",
        "reduced-scope",
        "defer-blocker",
        "abort",
        "workspace-002-spiral",
        "trading-validator-cycle",
        "ultima-review-cycle",
        "health-low-overhead",
        "agent-cad-recovery",
        "pandora-fresh-adoption",
    ] {
        assert!(
            delivery_ids.contains(&required),
            "missing delivery eval {required}"
        );
    }
    let review_ids: Vec<_> = review["evals"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_str().unwrap())
        .collect();
    for required in [
        "ordinary-static",
        "runtime-state",
        "native-gui",
        "unavailable-runtime-capability",
        "debugger-read-only-boundary",
    ] {
        assert!(
            review_ids.contains(&required),
            "missing review eval {required}"
        );
    }
}

#[test]
fn inspect_identifies_a_flutter_repository_without_mutation() {
    let root = fixture("inspect-flutter");
    fs::write(root.join("pubspec.yaml"), "name: health_canary\n").expect("manifest");
    let output = run(&["inspect", root.to_str().unwrap(), "--json"]);
    assert!(output.status.success());
    let value = json(&output);
    assert_eq!(value["result"]["projectKind"], "flutter");
    assert_eq!(value["result"]["thinState"], false);
    assert!(!root.join(".agentic").exists());
    fs::remove_dir_all(root).expect("fixture cleanup");
}

#[test]
fn doctor_verifies_readable_sources_match_embedded_assets() {
    let repository = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let output = run(&["doctor", repository.to_str().unwrap(), "--json"]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let value = json(&output);
    assert_eq!(value["result"]["verdict"], "PASS");
    assert_eq!(
        value["result"]["embeddedAssets"]["mismatches"],
        serde_json::json!([])
    );
    assert_eq!(value["result"]["runtimeDebug"]["provider"], "microsoft-cdb");
    assert_eq!(
        value["result"]["runtimeDebug"]["policy"],
        "read-only-source-inspection-and-execution-control"
    );
    assert!(
        value["result"]["embeddedAssets"]["verified"]
            .as_u64()
            .unwrap()
            > 20
    );
}

#[test]
fn sealed_adopt_plan_applies_thin_state_and_converges() {
    let root = fixture("adopt-flutter");
    fs::write(root.join("pubspec.yaml"), "name: health_canary\n").expect("manifest");
    fs::write(root.join(".gitignore"), ".agentic\n").expect("legacy ignore rule");
    fs::write(
        root.join("AGENTS.md"),
        "# Product instructions\n\nKeep this text.\n\n<!-- workspace-template:begin workspace-template version=2 -->\n## Frontier Loop\n\nUse execute-frontier and successor validators.\n<!-- workspace-template:end workspace-template -->\n",
    )
    .expect("instructions");
    let plan = root.join(".agentic/plans/adopt.json");
    let plan_args = vec![
        "adopt".to_owned(),
        "plan".to_owned(),
        root.to_string_lossy().into_owned(),
        "--plan-out".to_owned(),
        plan.to_string_lossy().into_owned(),
        "--json".to_owned(),
    ];
    let planned = run_owned(&plan_args);
    assert!(
        planned.status.success(),
        "{}",
        String::from_utf8_lossy(&planned.stderr)
    );
    assert!(plan.is_file());
    assert!(!root.join(".agentic/project.json").exists());

    let apply_args = vec![
        "adopt".to_owned(),
        "apply".to_owned(),
        root.to_string_lossy().into_owned(),
        "--apply-plan".to_owned(),
        plan.to_string_lossy().into_owned(),
        "--json".to_owned(),
    ];
    let applied = run_owned(&apply_args);
    assert!(
        applied.status.success(),
        "{}",
        String::from_utf8_lossy(&applied.stderr)
    );
    let project: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join(".agentic/project.json")).expect("thin state"))
            .expect("project JSON");
    assert_eq!(project["version"], 2);
    assert_eq!(project["execution"]["defaultMode"], "direct");
    assert_eq!(
        project["workspaceTemplate"]["releaseCommit"]
            .as_str()
            .unwrap()
            .len(),
        40
    );
    assert_eq!(
        project["workspaceTemplate"]["artifacts"]["windows-x86_64"]["executableSha256"]
            .as_str()
            .unwrap()
            .len(),
        64
    );
    let agents = fs::read_to_string(root.join("AGENTS.md")).expect("AGENTS");
    assert!(agents.contains("# Product instructions"));
    assert!(!agents.contains("workspace-template:begin workspace-template"));
    assert!(!agents.contains("Frontier Loop"));
    assert!(!agents.contains("execute-frontier"));
    assert!(agents.contains("Use `workspace-template`"));
    assert!(agents.contains("host or repository owner selects"));
    assert!(!root.join(".agentic/tooling/package.json").exists());
    let gitignore = fs::read_to_string(root.join(".gitignore")).expect("managed ignore rules");
    assert!(gitignore.contains(".agentic\n"));
    assert!(gitignore.contains("!.agentic/project.json"));
    assert!(!gitignore.contains("!.agentic/tooling/package-lock.json"));
    assert!(gitignore.contains("!.agentic/history/migration-index.json"));
    assert!(gitignore.contains("!.agentic/resumption/**"));

    let second_plan = root.join(".agentic/plans/adopt-second.json");
    let second = run_owned(&[
        "adopt".to_owned(),
        "plan".to_owned(),
        root.to_string_lossy().into_owned(),
        "--plan-out".to_owned(),
        second_plan.to_string_lossy().into_owned(),
        "--json".to_owned(),
    ]);
    assert!(second.status.success());
    assert_eq!(json(&second)["result"]["operations"], serde_json::json!([]));
    fs::remove_dir_all(root).expect("fixture cleanup");
}

#[test]
fn sealed_adopt_can_use_a_local_package_while_recording_distribution_and_source_identity() {
    let root = fixture("adopt-local-package");
    fs::write(root.join("pubspec.yaml"), "name: local_package_canary\n").expect("manifest");
    let plan = root.join("adopt.json");
    let distribution_commit = "1111111111111111111111111111111111111111";
    let planned = run_owned(&[
        "adopt".to_owned(),
        "plan".to_owned(),
        root.to_string_lossy().into_owned(),
        "--plan-out".to_owned(),
        plan.to_string_lossy().into_owned(),
        "--package-commit".to_owned(),
        distribution_commit.to_owned(),
        "--json".to_owned(),
    ]);
    assert!(planned.status.success());
    let applied = run_owned(&[
        "adopt".to_owned(),
        "apply".to_owned(),
        root.to_string_lossy().into_owned(),
        "--apply-plan".to_owned(),
        plan.to_string_lossy().into_owned(),
        "--json".to_owned(),
    ]);
    assert!(applied.status.success());
    let project: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join(".agentic/project.json")).unwrap()).unwrap();
    assert_eq!(
        project["workspaceTemplate"]["releaseCommit"],
        distribution_commit
    );
    assert_eq!(
        project["workspaceTemplate"]["sourceCommit"]
            .as_str()
            .unwrap()
            .len(),
        40
    );
    assert!(!root.join(".agentic/tooling/package.json").exists());
    fs::remove_dir_all(root).expect("fixture cleanup");
}

#[test]
fn sealed_adopt_apply_rejects_stale_reviewed_state() {
    let root = fixture("adopt-stale");
    fs::write(root.join("pubspec.yaml"), "name: stale_canary\n").expect("manifest");
    fs::write(root.join("AGENTS.md"), "original\n").expect("instructions");
    let plan = root.join("adopt-plan.json");
    let planned = run_owned(&[
        "adopt".to_owned(),
        "plan".to_owned(),
        root.to_string_lossy().into_owned(),
        "--plan-out".to_owned(),
        plan.to_string_lossy().into_owned(),
        "--json".to_owned(),
    ]);
    assert!(planned.status.success());
    fs::write(root.join("AGENTS.md"), "changed after review\n").expect("stale edit");
    let applied = run_owned(&[
        "adopt".to_owned(),
        "apply".to_owned(),
        root.to_string_lossy().into_owned(),
        "--apply-plan".to_owned(),
        plan.to_string_lossy().into_owned(),
        "--json".to_owned(),
    ]);
    assert_eq!(applied.status.code(), Some(2));
    assert_eq!(json(&applied)["error"]["code"], "STALE_PLAN");
    assert!(!root.join(".agentic/project.json").exists());
    fs::remove_dir_all(root).expect("fixture cleanup");
}

#[test]
fn next_invocation_rolls_back_an_interrupted_apply_journal() {
    let root = fixture("interrupted-apply");
    fs::write(root.join("pubspec.yaml"), "name: interrupted_canary\n").expect("manifest");
    fs::write(root.join("AGENTS.md"), "original product policy\n").expect("instructions");
    let plan_path = root.join("adopt.json");
    let planned = run_owned(&[
        "adopt".to_owned(),
        "plan".to_owned(),
        root.to_string_lossy().into_owned(),
        "--plan-out".to_owned(),
        plan_path.to_string_lossy().into_owned(),
        "--json".to_owned(),
    ]);
    assert!(planned.status.success());
    let plan: serde_json::Value = serde_json::from_slice(&fs::read(&plan_path).unwrap()).unwrap();
    let plan_id = plan["planId"].as_str().unwrap();
    let agents = plan["operations"]
        .as_array()
        .unwrap()
        .iter()
        .find(|operation| operation["path"] == "AGENTS.md")
        .expect("AGENTS operation");
    let transaction = root.join(".agentic/transactions").join(plan_id);
    fs::create_dir_all(transaction.join("backup")).expect("backup directory");
    fs::copy(&plan_path, transaction.join("plan.json")).expect("transaction plan");
    fs::rename(root.join("AGENTS.md"), transaction.join("backup/AGENTS.md"))
        .expect("interrupted backup");
    fs::write(root.join("AGENTS.md"), agents["content"].as_str().unwrap())
        .expect("interrupted target");
    fs::write(
        transaction.join("state.json"),
        "{\n  \"version\": 1,\n  \"status\": \"applying\",\n  \"startedPaths\": [\"AGENTS.md\"]\n}\n",
    )
    .expect("transaction state");

    let recovered_plan = root.join("recovered.json");
    let recovered = run_owned(&[
        "adopt".to_owned(),
        "plan".to_owned(),
        root.to_string_lossy().into_owned(),
        "--plan-out".to_owned(),
        recovered_plan.to_string_lossy().into_owned(),
        "--json".to_owned(),
    ]);
    assert!(
        recovered.status.success(),
        "{}",
        String::from_utf8_lossy(&recovered.stderr)
    );
    assert_eq!(
        fs::read_to_string(root.join("AGENTS.md")).unwrap(),
        "original product policy\n"
    );
    assert!(!transaction.exists());
    fs::remove_dir_all(root).expect("fixture cleanup");
}

#[test]
fn doctor_rejects_project_identity_that_does_not_match_running_binary() {
    let root = fixture("doctor-identity");
    fs::write(root.join("pubspec.yaml"), "name: doctor_identity\n").expect("manifest");
    let plan = root.join("adopt.json");
    assert!(run_owned(&[
        "adopt".to_owned(),
        "plan".to_owned(),
        root.to_string_lossy().into_owned(),
        "--plan-out".to_owned(),
        plan.to_string_lossy().into_owned(),
        "--json".to_owned(),
    ])
    .status
    .success());
    assert!(run_owned(&[
        "adopt".to_owned(),
        "apply".to_owned(),
        root.to_string_lossy().into_owned(),
        "--apply-plan".to_owned(),
        plan.to_string_lossy().into_owned(),
        "--json".to_owned(),
    ])
    .status
    .success());
    let project_path = root.join(".agentic/project.json");
    let mut project: serde_json::Value =
        serde_json::from_slice(&fs::read(&project_path).unwrap()).unwrap();
    project["workspaceTemplate"]["sourceCommit"] =
        serde_json::json!("0000000000000000000000000000000000000000");
    project["workspaceTemplate"]["artifacts"]["windows-x86_64"]["executableSha256"] =
        serde_json::json!("0000000000000000000000000000000000000000000000000000000000000000");
    fs::write(
        &project_path,
        format!("{}\n", serde_json::to_string_pretty(&project).unwrap()),
    )
    .unwrap();

    let output = run_owned(&[
        "doctor".to_owned(),
        root.to_string_lossy().into_owned(),
        "--json".to_owned(),
    ]);
    assert_eq!(output.status.code(), Some(1));
    let errors = json(&output)["result"]["errors"]
        .as_array()
        .unwrap()
        .clone();
    assert!(errors
        .iter()
        .any(|error| error.as_str().unwrap().contains("running source commit")));
    assert!(errors
        .iter()
        .any(|error| error.as_str().unwrap().contains("running executable")));
    fs::remove_dir_all(root).expect("fixture cleanup");
}

#[test]
fn upgrade_retires_only_hash_matching_generic_assets() {
    let root = fixture("upgrade-managed-assets");
    fs::write(root.join("pubspec.yaml"), "name: managed_canary\n").expect("manifest");
    fs::create_dir_all(root.join(".agentic/skills/verify")).expect("skill directory");
    fs::write(root.join(".agentic/skills/verify/SKILL.md"), "managed\n").expect("managed skill");
    fs::create_dir_all(root.join(".agentic/skills/local-override")).expect("override directory");
    fs::write(
        root.join(".agentic/skills/local-override/SKILL.md"),
        "locally changed\n",
    )
    .expect("override skill");
    let managed_hash = format!("{:x}", sha2::Sha256::digest(b"managed\n"));
    let registry = serde_json::json!({
        "version": 3,
        "generator": "workspace-template",
        "files": {
            ".agentic/skills/verify/SKILL.md": { "mode": "managed", "hash": managed_hash },
            ".agentic/skills/local-override/SKILL.md": { "mode": "managed", "hash": "0000000000000000000000000000000000000000000000000000000000000000" }
        }
    });
    fs::write(
        root.join(".agentic/managed-files.json"),
        format!("{}\n", serde_json::to_string_pretty(&registry).unwrap()),
    )
    .expect("managed registry");
    let plan = root.join("upgrade.json");
    let planned = run_owned(&[
        "upgrade".to_owned(),
        "plan".to_owned(),
        root.to_string_lossy().into_owned(),
        "--plan-out".to_owned(),
        plan.to_string_lossy().into_owned(),
        "--json".to_owned(),
    ]);
    assert_eq!(planned.status.code(), Some(3));
    let report = json(&planned);
    assert!(report["result"]["conflicts"]
        .as_array()
        .unwrap()
        .iter()
        .any(|item| item.as_str().unwrap().contains("local-override")));
    assert!(root.join(".agentic/skills/verify/SKILL.md").exists());

    fs::remove_file(root.join(".agentic/skills/local-override/SKILL.md"))
        .expect("resolve conflict fixture");
    let clean_plan = root.join("upgrade-clean.json");
    let clean = run_owned(&[
        "upgrade".to_owned(),
        "plan".to_owned(),
        root.to_string_lossy().into_owned(),
        "--plan-out".to_owned(),
        clean_plan.to_string_lossy().into_owned(),
        "--json".to_owned(),
    ]);
    assert!(
        clean.status.success(),
        "{}",
        String::from_utf8_lossy(&clean.stderr)
    );
    let applied = run_owned(&[
        "upgrade".to_owned(),
        "apply".to_owned(),
        root.to_string_lossy().into_owned(),
        "--apply-plan".to_owned(),
        clean_plan.to_string_lossy().into_owned(),
        "--json".to_owned(),
    ]);
    assert!(
        applied.status.success(),
        "{}",
        String::from_utf8_lossy(&applied.stderr)
    );
    assert!(!root.join(".agentic/skills/verify/SKILL.md").exists());
    assert!(root.join(".agentic/history/migration-index.json").is_file());
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(
            &fs::read(root.join(".agentic/project.json")).unwrap()
        )
        .unwrap()["history"]["migrationIndex"],
        ".agentic/history/migration-index.json"
    );

    let project_path = root.join(".agentic/project.json");
    let mut project: serde_json::Value =
        serde_json::from_slice(&fs::read(&project_path).unwrap()).unwrap();
    project["capabilities"]["runtime-debug"] = serde_json::json!("required");
    project["overrides"] = serde_json::json!({ "health": { "policy": "keep" } });
    project["history"]["resumption"] = serde_json::json!(".agentic/resumption/current.json");
    fs::write(
        &project_path,
        format!("{}\n", serde_json::to_string_pretty(&project).unwrap()),
    )
    .unwrap();
    let second_plan = root.join("upgrade-second.json");
    let second = run_owned(&[
        "upgrade".to_owned(),
        "plan".to_owned(),
        root.to_string_lossy().into_owned(),
        "--plan-out".to_owned(),
        second_plan.to_string_lossy().into_owned(),
        "--json".to_owned(),
    ]);
    assert!(second.status.success());
    assert_eq!(json(&second)["result"]["operations"], serde_json::json!([]));
    fs::remove_dir_all(root).expect("fixture cleanup");
}

#[test]
fn skills_update_requires_the_package_manager_without_mutation() {
    let root = fixture("skills-update-node");
    fs::write(
        root.join("package.json"),
        "{\n  \"name\": \"pandora-canary\",\n  \"private\": true,\n  \"devDependencies\": { \"existing-tool\": \"1.0.0\" }\n}\n",
    )
    .expect("package manifest");
    let before = fs::read(root.join("package.json")).unwrap();
    let planned = run_owned(&[
        "skills".to_owned(),
        "update".to_owned(),
        root.to_string_lossy().into_owned(),
        "--json".to_owned(),
    ]);
    assert_eq!(planned.status.code(), Some(64));
    assert_eq!(
        json(&planned)["error"]["code"],
        "PACKAGE_MANAGER_UPDATE_REQUIRED"
    );
    assert_eq!(fs::read(root.join("package.json")).unwrap(), before);
    assert!(!root.join(".agentic/skills").exists());
    assert!(!root.join(".agents/skills").exists());
    fs::remove_dir_all(root).expect("fixture cleanup");
}

#[cfg(windows)]
#[test]
fn verify_contains_detached_descendants_on_timeout() {
    let root = fixture("verify-job-object");
    fs::create_dir_all(root.join("test")).expect("test directory");
    let marker = root.join("grandchild.json");
    fs::write(
        root.join("test/hanging-verification.js"),
        format!(
            "import {{ spawn }} from 'node:child_process';\nimport {{ writeFileSync }} from 'node:fs';\nconst child = spawn(process.execPath, ['-e', 'setInterval(() => {{}}, 1000)'], {{ detached: true, stdio: 'ignore' }});\nwriteFileSync({}, JSON.stringify({{ pid: child.pid }}));\nchild.unref();\nsetInterval(() => {{}}, 1000);\n",
            serde_json::to_string(&marker).unwrap()
        ),
    )
    .expect("hanging verifier");
    fs::write(
        root.join("package.json"),
        "{\n  \"name\": \"job-canary\",\n  \"private\": true,\n  \"scripts\": { \"check\": \"node test/hanging-verification.js\" }\n}\n",
    )
    .expect("package manifest");
    let output = run_owned(&[
        "verify".to_owned(),
        root.to_string_lossy().into_owned(),
        "--timeout".to_owned(),
        "1500".to_owned(),
        "--json".to_owned(),
    ]);
    assert_eq!(
        output.status.code(),
        Some(1),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report = json(&output);
    assert_eq!(report["result"]["verdict"], "FAIL");
    assert_eq!(report["result"]["steps"][0]["timedOut"], true);
    let recorded: serde_json::Value =
        serde_json::from_slice(&fs::read(&marker).expect("grandchild marker")).unwrap();
    let pid = recorded["pid"].as_u64().unwrap();
    let probe = Command::new("powershell.exe")
        .args([
            "-NoProfile", "-NonInteractive", "-Command",
            &format!("if (Get-Process -Id {pid} -ErrorAction SilentlyContinue) {{ exit 1 }} else {{ exit 0 }}"),
        ])
        .status()
        .expect("process probe");
    assert!(
        probe.success(),
        "detached grandchild PID {pid} survived native verification"
    );
    fs::remove_dir_all(root).expect("fixture cleanup");
}
