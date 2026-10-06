#![cfg(windows)]

use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("workspace-template-identity-{nonce}"));
        fs::create_dir_all(root.join(".agentic")).unwrap();
        fs::write(root.join("package.json"), r#"{"name":"identity-fixture"}"#).unwrap();
        fs::write(root.join("source.txt"), "first source").unwrap();
        fs::write(root.join("fixture.txt"), "expected behavior").unwrap();
        fs::write(root.join("package-lock.json"), "{}").unwrap();
        let fixture = Self(root);
        fixture.configure(
            json!({
                "version": 1,
                "files": ["source.txt", "fixture.txt", "package.json", "package-lock.json"],
                "programs": ["cmd.exe"]
            }),
            "exit 0",
        );
        fixture
    }

    fn configure(&self, policy: Value, command: &str) {
        fs::write(self.0.join(".agentic/project.json"), serde_json::to_vec(&json!({
            "overrides": {"workspace": {
                "commands": {"node:.": [{"program":"cmd.exe", "args":["/D", "/C", command], "cwd":"."}]},
                "verificationInputs": policy
            }}
        })).unwrap()).unwrap();
    }

    fn verify(&self) -> Value {
        self.verify_with(&[])
    }

    fn verify_with(&self, environment: &[(&str, &str)]) -> Value {
        let mut command = Command::new(env!("CARGO_BIN_EXE_workspace-template"));
        for (name, value) in environment {
            command.env(name, value);
        }
        let output = command
            .args(["verify", self.0.to_str().unwrap(), "--scope", "all"])
            .output()
            .unwrap();
        serde_json::from_slice::<Value>(&output.stdout).unwrap()["result"].clone()
    }
}

#[test]
fn source_fixture_and_lock_mutations_change_inputs_without_redefining_topology() {
    let fixture = Fixture::new();
    let mut prior = fixture.verify();
    for (file, content) in [
        ("source.txt", "new source"),
        ("fixture.txt", "new oracle"),
        ("package-lock.json", "{\"lockfileVersion\":3}"),
    ] {
        fs::write(fixture.0.join(file), content).unwrap();
        let next = fixture.verify();
        assert_eq!(next["inputIdentity"]["qualified"], true, "{next}");
        assert_ne!(
            prior["inputIdentity"]["sha256"],
            next["inputIdentity"]["sha256"]
        );
        assert_eq!(prior["graphFingerprint"], next["graphFingerprint"]);
        prior = next;
    }
}

#[test]
fn executed_command_and_declared_toolchain_file_change_identity() {
    let fixture = Fixture::new();
    let tool = fixture.0.join("toolchain.exe");
    fs::copy(
        std::env::var_os("COMSPEC").unwrap_or_else(|| "C:\\Windows\\System32\\cmd.exe".into()),
        &tool,
    )
    .unwrap();
    let policy = json!({"version":1,"files":["source.txt"],"programs":["cmd.exe",tool]});
    fixture.configure(policy.clone(), "exit 0");
    let before = fixture.verify();
    fixture.configure(policy, "exit /B 0");
    let changed_command = fixture.verify();
    assert_ne!(
        before["inputIdentity"]["sha256"],
        changed_command["inputIdentity"]["sha256"]
    );
    let mut bytes = fs::read(&tool).unwrap();
    bytes.extend_from_slice(b"identity-overlay");
    fs::write(&tool, bytes).unwrap();
    let changed_tool = fixture.verify();
    assert_eq!(changed_tool["inputIdentity"]["qualified"], true);
    assert_ne!(
        changed_command["inputIdentity"]["sha256"],
        changed_tool["inputIdentity"]["sha256"]
    );
}

#[test]
fn declared_environment_changes_identity_without_retaining_values() {
    let fixture = Fixture::new();
    fixture.configure(json!({"version":1,"files":["source.txt"],"programs":["cmd.exe"],"environment":["NODE_ENV"]}), "exit 0");
    let first = fixture.verify_with(&[("NODE_ENV", "identity-development-unique")]);
    let second = fixture.verify_with(&[("NODE_ENV", "identity-production-unique")]);
    assert_eq!(first["inputIdentity"]["qualified"], true);
    assert_ne!(
        first["inputIdentity"]["sha256"],
        second["inputIdentity"]["sha256"]
    );
    assert!(!first.to_string().contains("identity-development-unique"));
    assert!(!second.to_string().contains("identity-production-unique"));
}

#[test]
fn in_run_mutation_refuses_freshness_but_preserves_execution_result() {
    let fixture = Fixture::new();
    fixture.configure(
        json!({"version":1,"files":["source.txt"],"programs":["cmd.exe"]}),
        "echo changed>source.txt",
    );
    let result = fixture.verify();
    assert_eq!(result["verdict"], "PASS");
    assert_eq!(result["inputIdentity"]["qualified"], false);
    assert_eq!(result["inputIdentity"]["sha256"], Value::Null);
    assert_eq!(
        result["inputIdentity"]["reason"],
        "inputs-changed-during-execution"
    );
}

#[test]
fn unsafe_sensitive_and_generated_inputs_are_rejected_before_execution() {
    let fixture = Fixture::new();
    fs::write(fixture.0.join(".env"), "DO_NOT_RETAIN_THIS_SECRET").unwrap();
    for file in [
        "../escape.txt",
        "source.txt:stream",
        ".env",
        "target/artifact.txt",
        ".git/config",
        "private.key",
    ] {
        fixture.configure(
            json!({"version":1,"files":[file],"programs":["cmd.exe"]}),
            "echo ran>marker.txt",
        );
        let result = fixture.verify();
        assert_eq!(result["verdict"], "INSUFFICIENT_EVIDENCE", "{result}");
        assert_eq!(result["steps"], json!([]));
        assert_eq!(result["inputIdentity"]["qualified"], false);
        assert!(!fixture.0.join("marker.txt").exists());
        assert!(!result.to_string().contains("DO_NOT_RETAIN_THIS_SECRET"));
    }
    fixture.configure(json!({"version":1,"files":["source.txt"],"programs":["cmd.exe"],"environment":["GITHUB_TOKEN"]}), "echo ran>marker.txt");
    assert_eq!(fixture.verify()["verdict"], "INSUFFICIENT_EVIDENCE");
    assert!(!fixture.0.join("marker.txt").exists());
}

#[test]
fn program_declarations_cannot_bypass_protected_path_exclusions() {
    let fixture = Fixture::new();
    fs::write(
        fixture.0.join("private.key"),
        "PRIVATE_PROGRAM_POLICY_SECRET",
    )
    .unwrap();
    fs::create_dir_all(fixture.0.join("target")).unwrap();
    fs::write(fixture.0.join("target/unrelated.exe"), "generated").unwrap();
    for program in [
        fixture.0.join("private.key"),
        fixture.0.join("target/unrelated.exe"),
        fixture.0.join("../parent.exe"),
    ] {
        fixture.configure(
            json!({"version":1,"files":["source.txt"],"programs":["cmd.exe",program]}),
            "echo ran>program-marker.txt",
        );
        let result = fixture.verify();
        assert_eq!(result["verdict"], "INSUFFICIENT_EVIDENCE", "{result}");
        assert_eq!(result["steps"], json!([]));
        assert!(!fixture.0.join("program-marker.txt").exists());
        assert!(!result.to_string().contains("PRIVATE_PROGRAM_POLICY_SECRET"));
    }
}

#[test]
fn bounded_missing_and_external_inputs_cannot_qualify_evidence() {
    let fixture = Fixture::new();
    fixture.configure(json!({"version":1,"files":["source.txt"],"programs":["cmd.exe"],"serviceConstraints":[{"id":"test-database","revision":"snapshot-one"}]}), "exit 0");
    let external = fixture.verify();
    assert_eq!(
        external["inputIdentity"]["reason"],
        "external-service-state-not-observed"
    );
    assert_eq!(external["inputIdentity"]["qualified"], false);
    fixture.configure(
        json!({"version":1,"files":["missing.txt"],"programs":["cmd.exe"]}),
        "exit 0",
    );
    assert_eq!(fixture.verify()["inputIdentity"]["qualified"], false);
    fs::write(
        fixture.0.join("oversized.txt"),
        vec![0_u8; 8 * 1024 * 1024 + 1],
    )
    .unwrap();
    fixture.configure(
        json!({"version":1,"files":["oversized.txt"],"programs":["cmd.exe"]}),
        "exit 0",
    );
    assert_eq!(
        fixture.verify()["inputIdentity"]["reason"],
        "verification-input-byte-limit"
    );
}

#[test]
fn linked_inputs_are_rejected_and_no_policy_never_implies_identity() {
    let fixture = Fixture::new();
    let linked = fixture.0.join("linked");
    let output = Command::new("cmd.exe")
        .args([
            "/D",
            "/C",
            "mklink",
            "/J",
            linked.to_str().unwrap(),
            fixture.0.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(output.status.success());
    fixture.configure(
        json!({"version":1,"files":["linked/source.txt"],"programs":["cmd.exe"]}),
        "exit 0",
    );
    let result = fixture.verify();
    fs::remove_dir(&linked).unwrap();
    assert_eq!(
        result["inputIdentity"]["reason"],
        "unsafe-verification-input-link"
    );
    assert_eq!(result["steps"], json!([]));
    let path = fixture.0.join(".agentic/project.json");
    let mut state: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    state["overrides"]["workspace"]
        .as_object_mut()
        .unwrap()
        .remove("verificationInputs");
    fs::write(path, serde_json::to_vec(&state).unwrap()).unwrap();
    let result = fixture.verify();
    assert_eq!(result["verdict"], "PASS");
    assert_eq!(result["inputIdentity"]["qualified"], false);
    assert_eq!(
        result["inputIdentity"]["reason"],
        "no-explicit-input-policy"
    );
}

#[test]
fn command_cwd_junction_is_rejected_before_any_outside_write() {
    let fixture = Fixture::new();
    let outside = fixture.0.with_extension("outside");
    fs::create_dir(&outside).unwrap();
    let linked = fixture.0.join("linked");
    let output = Command::new("cmd.exe")
        .args([
            "/D",
            "/C",
            "mklink",
            "/J",
            linked.to_str().unwrap(),
            outside.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(output.status.success());
    let state_path = fixture.0.join(".agentic/project.json");
    let mut state: Value = serde_json::from_slice(&fs::read(&state_path).unwrap()).unwrap();
    state["overrides"]["workspace"]["commands"]["node:."][0]["cwd"] = json!("linked");
    state["overrides"]["workspace"]["commands"]["node:."][0]["args"] =
        json!(["/D", "/C", "echo escaped>marker.txt"]);
    fs::write(state_path, serde_json::to_vec(&state).unwrap()).unwrap();
    let result = fixture.verify();
    state["overrides"]["workspace"]["modules"] = json!([{"root":"linked","kind":"unknown"}]);
    state["overrides"]["workspace"]["commands"] = json!({"unknown:linked":[{"program":"cmd.exe","args":["/D","/C","echo escaped>marker.txt"]}]});
    fs::write(
        fixture.0.join(".agentic/project.json"),
        serde_json::to_vec(&state).unwrap(),
    )
    .unwrap();
    let default_cwd_result = fixture.verify();
    let escaped = outside.join("marker.txt").exists();
    fs::remove_dir(&linked).unwrap();
    fs::remove_dir_all(&outside).unwrap();
    assert_eq!(result["verdict"], "INSUFFICIENT_EVIDENCE", "{result}");
    assert_eq!(result["steps"], json!([]));
    assert_eq!(
        default_cwd_result["verdict"], "INSUFFICIENT_EVIDENCE",
        "{default_cwd_result}"
    );
    assert_eq!(default_cwd_result["steps"], json!([]));
    assert!(!escaped);
}

#[test]
fn pinned_program_cannot_qualify_a_different_application_directory_executable() {
    let fixture = Fixture::new();
    let bin = fixture.0.join("bin");
    let path_candidate = fixture.0.join("path-candidate");
    fs::create_dir(&bin).unwrap();
    fs::create_dir(&path_candidate).unwrap();
    let cli = bin.join("workspace-template.exe");
    fs::copy(env!("CARGO_BIN_EXE_workspace-template"), &cli).unwrap();
    let node = std::env::split_paths(&std::env::var_os("PATH").unwrap())
        .map(|path| path.join("node.exe"))
        .find(|path| path.is_file())
        .unwrap();
    fs::copy(fs::canonicalize(node).unwrap(), bin.join("probe.exe")).unwrap();
    fs::copy(
        std::env::var_os("COMSPEC").unwrap(),
        path_candidate.join("probe.exe"),
    )
    .unwrap();
    let policy = json!({"version":1,"files":["source.txt"],"programs":["probe.exe"]});
    fixture.configure(policy, "echo actual>image-marker.txt");
    let state_path = fixture.0.join(".agentic/project.json");
    let mut state: Value = serde_json::from_slice(&fs::read(&state_path).unwrap()).unwrap();
    state["overrides"]["workspace"]["commands"]["node:."][0]["program"] = json!("probe.exe");
    fs::write(state_path, serde_json::to_vec(&state).unwrap()).unwrap();
    let expected_image = fs::canonicalize(path_candidate.join("probe.exe")).unwrap();
    let path = std::env::join_paths(
        std::iter::once(path_candidate)
            .chain(std::env::split_paths(&std::env::var_os("PATH").unwrap())),
    )
    .unwrap();
    let output = Command::new(cli)
        .args([
            "verify",
            fixture.0.to_str().unwrap(),
            "--scope",
            "all",
            "--timeout",
            "1000",
        ])
        .env("PATH", path)
        .output()
        .unwrap();
    let result = serde_json::from_slice::<Value>(&output.stdout).unwrap()["result"].clone();
    assert_eq!(result["verdict"], "PASS", "{result}");
    assert_eq!(result["inputIdentity"]["qualified"], true, "{result}");
    assert_eq!(
        fs::canonicalize(result["steps"][0]["programImage"].as_str().unwrap()).unwrap(),
        expected_image
    );
    assert!(fixture.0.join("image-marker.txt").exists());
}

#[test]
fn root_batch_identity_requires_the_actual_direct_interpreter() {
    let fixture = Fixture::new();
    // Use real, local files so host package-manager junctions do not weaken
    // the input policy's deliberate rejection of linked toolchains.
    let bin = fixture.0.join("bin");
    fs::create_dir(&bin).unwrap();
    fs::write(bin.join("npm.cmd"), "@echo off\r\nexit /b 0\r\n").unwrap();
    let path = std::env::join_paths(
        std::iter::once(bin).chain(std::env::split_paths(&std::env::var_os("PATH").unwrap())),
    )
    .unwrap();
    fs::write(
        fixture.0.join("package.json"),
        r#"{"name":"root-identity","scripts":{"check":"node -e \"process.exit(0)\""}}"#,
    )
    .unwrap();
    fixture.configure(
        json!({"version":1,"files":["package.json","source.txt"],"programs":["npm.cmd"]}),
        "exit 0",
    );
    let run_root = || {
        let output = Command::new(env!("CARGO_BIN_EXE_workspace-template"))
            .args(["verify", fixture.0.to_str().unwrap()])
            .env("PATH", &path)
            .output()
            .unwrap();
        serde_json::from_slice::<Value>(&output.stdout).unwrap()["result"].clone()
    };
    let undeclared = run_root();
    assert_eq!(undeclared["verdict"], "PASS", "{undeclared}");
    assert_eq!(undeclared["inputIdentity"]["qualified"], false);
    assert_eq!(
        undeclared["inputIdentity"]["reason"],
        "launched-program-identity-not-declared"
    );
    fixture.configure(
        json!({"version":1,"files":["package.json","source.txt"],"programs":["npm.cmd","cmd.exe"]}),
        "exit 0",
    );
    let declared = run_root();
    assert_eq!(declared["scope"], "root");
    assert_eq!(declared["inputIdentity"]["qualified"], true, "{declared}");
    fs::write(fixture.0.join("source.txt"), "root source changed").unwrap();
    assert_ne!(
        declared["inputIdentity"]["sha256"],
        run_root()["inputIdentity"]["sha256"]
    );
    fixture.configure(
        json!({"version":1,"files":["../escape"],"programs":["npm.cmd","cmd.exe"]}),
        "exit 0",
    );
    assert_eq!(run_root()["steps"], json!([]));
}

impl Drop for Fixture {
    fn drop(&mut self) {
        if self.0.is_dir() {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }
}

#[test]
fn stable_declared_inputs_have_identity_distinct_from_graph_topology() {
    let fixture = Fixture::new();
    let first = fixture.verify();
    assert_eq!(first["verdict"], "PASS");
    assert_eq!(first["inputIdentity"]["qualified"], true);
    assert_eq!(first["inputIdentity"]["schemaVersion"], 1);
    assert_eq!(first["inputIdentity"]["assurance"], "declared-inputs-only");
    assert_eq!(first["inputIdentity"]["sha256"].as_str().unwrap().len(), 64);
    assert_eq!(
        first["inputIdentity"]["sha256"],
        fixture.verify()["inputIdentity"]["sha256"]
    );
}
