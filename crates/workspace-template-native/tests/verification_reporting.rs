#![cfg(windows)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

struct Fixture(PathBuf);

impl Fixture {
    fn new(name: &str) -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("workspace-template-report-{name}-{nonce}"));
        fs::create_dir_all(&root).unwrap();
        Self(root)
    }

    fn write(&self, path: &str, content: impl AsRef<[u8]>) {
        let path = self.0.join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn run(root: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_workspace-template"))
        .arg("verify")
        .arg(root)
        .args(args)
        .output()
        .expect("native CLI must launch")
}

fn result(output: &Output) -> Value {
    serde_json::from_slice::<Value>(&output.stdout).unwrap()["result"].clone()
}

fn assert_timings(report: &Value) {
    let total = report["durationMs"]
        .as_u64()
        .expect("total monotonic duration");
    for step in report["steps"].as_array().unwrap() {
        let duration = step["durationMs"]
            .as_u64()
            .expect("step monotonic duration");
        assert!(
            duration <= total,
            "step duration exceeds the whole verification"
        );
    }
}

fn workspace(fixture: &Fixture, commands: Value) {
    fixture.write(
        "package.json",
        r#"{"private":true,"workspaces":["packages/*"]}"#,
    );
    for name in ["a", "b"] {
        fixture.write(
            &format!("packages/{name}/package.json"),
            json!({"name":name}).to_string(),
        );
    }
    fixture.write(
        ".agentic/project.json",
        json!({"overrides":{"workspace":{"commands":commands}}}).to_string(),
    );
}

fn command(program: &str, args: &[&str], cwd: &str) -> Value {
    json!({"program":program,"args":args,"cwd":cwd})
}

#[test]
fn root_success_reports_total_and_step_durations() {
    let fixture = Fixture::new("root-time");
    fixture.write(
        "package.json",
        json!({"scripts":{"check":"node -e \"process.exit(0)\""}}).to_string(),
    );
    let output = run(&fixture.0, &[]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
    let report = result(&output);
    assert_eq!(report["verdict"], "PASS");
    assert_eq!(report["steps"].as_array().unwrap().len(), 1);
    let image = report["steps"][0]["programImage"]
        .as_str()
        .expect("actual launched process image");
    assert!(Path::new(image).is_absolute());
    assert!(
        image.to_ascii_lowercase().ends_with("cmd.exe"),
        "batch entrypoint image: {image}"
    );
    assert_timings(&report);
}

#[test]
fn workspace_timings_cover_concurrent_commands_and_early_selection_failure() {
    let fixture = Fixture::new("workspace-time");
    workspace(
        &fixture,
        json!({
            "node:packages/a":[command("node", &["-e", "setTimeout(() => {}, 100)"], "packages/a")],
            "node:packages/b":[command("node", &["-e", "setTimeout(() => {}, 100)"], "packages/b")]
        }),
    );
    for concurrency in ["1", "2"] {
        let output = run(
            &fixture.0,
            &["--scope", "all", "--concurrency", concurrency],
        );
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stdout)
        );
        let report = result(&output);
        assert_eq!(report["steps"].as_array().unwrap().len(), 2);
        assert_timings(&report);
        if concurrency == "1" {
            let sum: u64 = report["steps"]
                .as_array()
                .unwrap()
                .iter()
                .map(|step| step["durationMs"].as_u64().unwrap())
                .sum();
            assert!(sum <= report["durationMs"].as_u64().unwrap());
        }
    }
    let output = run(&fixture.0, &["--scope", "module", "--module", "missing"]);
    assert!(!output.status.success());
    let report = result(&output);
    assert_eq!(report["verdict"], "INSUFFICIENT_EVIDENCE");
    assert!(report["steps"].as_array().unwrap().is_empty());
    assert_timings(&report);
}

#[test]
fn command_failure_timeout_and_launch_error_retain_timings() {
    let fixture = Fixture::new("failure-time");
    for (program, args, timed_out, launch_error) in [
        ("cmd.exe", vec!["/D", "/C", "exit 7"], false, false),
        (
            "node",
            vec!["-e", "setInterval(() => {}, 1000)"],
            true,
            false,
        ),
        (
            "workspace-template-missing-report-command.exe",
            vec![],
            false,
            true,
        ),
    ] {
        workspace(
            &fixture,
            json!({"node:packages/a":[command(program, &args, "packages/a")]}),
        );
        let output = run(
            &fixture.0,
            &[
                "--scope",
                "module",
                "--module",
                "node:packages/a",
                "--timeout",
                "150",
            ],
        );
        assert!(!output.status.success());
        let report = result(&output);
        assert_eq!(report["verdict"], "FAIL");
        assert_timings(&report);
        let step = &report["steps"][0];
        if launch_error {
            assert!(step["error"].as_str().unwrap().contains("launch"));
        } else {
            assert_eq!(step["timedOut"], timed_out);
        }
    }
}

#[test]
fn a_module_pass_reports_missing_declared_repository_checks() {
    let fixture = Fixture::new("coverage-partial");
    let a = command("cmd.exe", &["/D", "/C", "exit 0"], "packages/a");
    let b = command("cmd.exe", &["/D", "/C", "exit 0"], "packages/b");
    workspace(
        &fixture,
        json!({"node:packages/a":[a.clone()],"node:packages/b":[b.clone()]}),
    );
    fixture.write(
        ".agentic/project.json",
        json!({"overrides":{"workspace":{
            "commands":{"node:packages/a":[a.clone()],"node:packages/b":[b.clone()]},
            "verificationCoverage":{"completeGate":true,"requirements":[
                {"id":"a-check","commands":[a]},{"id":"b-check","commands":[b]}
            ]}
        }}})
        .to_string(),
    );
    let output = run(
        &fixture.0,
        &["--scope", "module", "--module", "node:packages/a"],
    );
    assert!(output.status.success());
    let report = result(&output);
    assert_eq!(report["verdict"], "PASS");
    assert_eq!(report["scope"], "module");
    assert_eq!(report["coverage"]["requiredChecksComplete"], false);
    assert_eq!(report["coverage"]["verdict"], "INSUFFICIENT_EVIDENCE");
    assert_eq!(report["coverage"]["requirements"][0]["outcome"], "passed");
    assert_eq!(report["coverage"]["requirements"][1]["outcome"], "notRun");
    assert_eq!(
        report["coverage"]["authority"],
        "verification-evidence-only"
    );
}

#[test]
fn declared_complete_gate_reports_actual_pass_and_failure() {
    let fixture = Fixture::new("coverage-gate");
    let gate = command("cmd.exe", &["/D", "/C", "exit 0"], "packages/a");
    workspace(&fixture, json!({"node:packages/a":[gate.clone()]}));
    let declaration = json!({"completeGate":true,"requirements":[{"id":"repository-gate","commands":[gate.clone()]}]});
    for success in [true, false] {
        let actual = if success {
            gate.clone()
        } else {
            command("cmd.exe", &["/D", "/C", "exit 7"], "packages/a")
        };
        // The declaration names the exact command the repository configured.
        let declared = if success {
            declaration.clone()
        } else {
            json!({"completeGate":true,"requirements":[{"id":"repository-gate","commands":[actual.clone()]}]})
        };
        fixture.write(
            ".agentic/project.json",
            json!({"overrides":{"workspace":{
                "commands":{"node:packages/a":[actual]},"verificationCoverage":declared
            }}})
            .to_string(),
        );
        let output = run(
            &fixture.0,
            &["--scope", "module", "--module", "node:packages/a"],
        );
        assert_eq!(output.status.success(), success);
        let report = result(&output);
        assert_eq!(report["coverage"]["completeGate"], true);
        assert_eq!(report["coverage"]["requiredChecksComplete"], success);
        assert_eq!(
            report["coverage"]["verdict"],
            if success { "PASS" } else { "FAIL" }
        );
        assert_eq!(
            report["coverage"]["requirements"][0]["outcome"],
            if success { "passed" } else { "failed" }
        );
    }
}

#[test]
fn cargo_root_pass_does_not_cover_a_package_repository_gate() {
    let fixture = Fixture::new("coverage-polyglot");
    fixture.write(
        "Cargo.toml",
        "[package]\nname = \"report-fixture\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
    );
    fixture.write("src/lib.rs", "pub fn fixture() {}\n");
    fixture.write(
        "package.json",
        r#"{"scripts":{"check":"node -e \"process.exit(7)\""}}"#,
    );
    fixture.write(".agentic/project.json", json!({"overrides":{"workspace":{
        "verificationCoverage":{"completeGate":true,"requirements":[
            {"id":"rust-format","commands":[command("cargo", &["fmt", "--all", "--", "--check"], ".")]},
            {"id":"rust-test","commands":[command("cargo", &["test"], ".")]},
            {"id":"repository-gate","commands":[command("npm.cmd", &["run", "check"], ".")]}
        ]}
    }}}).to_string());
    let output = run(&fixture.0, &[]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
    let report = result(&output);
    assert_eq!(report["verdict"], "PASS");
    assert_eq!(report["scope"], "root");
    assert_eq!(report["steps"].as_array().unwrap().len(), 2);
    assert_eq!(report["coverage"]["requiredChecksComplete"], false);
    assert_eq!(report["coverage"]["requirements"][0]["outcome"], "passed");
    assert_eq!(report["coverage"]["requirements"][1]["outcome"], "passed");
    assert_eq!(report["coverage"]["requirements"][2]["outcome"], "notRun");
    assert_timings(&report);
}

#[test]
fn malformed_coverage_is_rejected_before_any_command_launches() {
    let fixture = Fixture::new("coverage-invalid");
    let marker = fixture.0.join("ran.txt");
    fixture.write(
        "package.json",
        r#"{"scripts":{"check":"node -e \"require('fs').writeFileSync('ran.txt','ran')\""}}"#,
    );
    for declaration in [
        json!({"completeGate":"true","requirements":[]}),
        json!({"completeGate":true,"requirements":[]}),
        json!({"completeGate":true,"requirements":[{"id":"x","commands":[command("cmd.exe", &[], "../outside")]}]}),
        json!({"completeGate":true,"requirements":[{"id":"x","commands":[command("cmd.exe", &[], ".")]},{"id":"x","commands":[command("cmd.exe", &[], ".")]}]}),
        json!({"completeGate":true,"requirements":[{"id":"x","commands":[{"program":"cmd.exe","args":[],"cwd":".","unknown":true}]}]}),
    ] {
        fixture.write(
            ".agentic/project.json",
            json!({"overrides":{"workspace":{"verificationCoverage":declaration}}}).to_string(),
        );
        let output = run(&fixture.0, &[]);
        assert!(!output.status.success());
        let report = result(&output);
        assert_eq!(report["verdict"], "INSUFFICIENT_EVIDENCE");
        assert!(report["errors"][0]
            .as_str()
            .unwrap()
            .contains("verificationCoverage"));
        assert!(report["steps"].as_array().unwrap().is_empty());
        assert!(!marker.exists());
        assert_timings(&report);
    }
}

#[test]
fn undeclared_and_no_topology_reports_never_claim_complete_required_checks() {
    let fixture = Fixture::new("coverage-no-topology");
    for args in [vec![], vec!["--scope", "all"]] {
        let output = run(&fixture.0, &args);
        assert!(!output.status.success());
        let report = result(&output);
        assert_eq!(report["verdict"], "INSUFFICIENT_EVIDENCE");
        assert_eq!(report["coverage"]["declaration"], "undeclared");
        assert_eq!(report["coverage"]["requiredChecksComplete"], false);
        assert_eq!(
            report["coverage"]["authority"],
            "verification-evidence-only"
        );
        assert_timings(&report);
    }
}

#[test]
fn an_affected_scope_without_changes_remains_an_explicit_empty_selection() {
    let fixture = Fixture::new("coverage-affected-noop");
    let initialized = Command::new("git")
        .arg("-C")
        .arg(&fixture.0)
        .args(["init", "-q"])
        .output()
        .unwrap();
    assert!(initialized.status.success());
    let output = run(&fixture.0, &["--scope", "affected"]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
    let report = result(&output);
    assert_eq!(report["scope"], "affected");
    assert_eq!(report["selection"]["modules"], json!([]));
    assert_eq!(report["selection"]["changedPaths"], json!([]));
    assert!(report["steps"].as_array().unwrap().is_empty());
    assert_eq!(report["coverage"]["requiredChecksComplete"], false);
    assert_timings(&report);
}
