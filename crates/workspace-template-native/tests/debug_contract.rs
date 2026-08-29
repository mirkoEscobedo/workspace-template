use std::fs;
use std::path::PathBuf;
use std::process::{Command, Output};
use std::time::{SystemTime, UNIX_EPOCH};

fn run(args: &[String]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_workspace-template"))
        .args(args)
        .output()
        .unwrap()
}

fn fixture(name: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("workspace-template-debug-{name}-{nonce}"));
    fs::create_dir_all(&root).unwrap();
    root
}

fn json(output: &Output) -> serde_json::Value {
    serde_json::from_slice(&output.stdout).unwrap()
}

#[test]
fn debug_providers_report_every_runtime_without_installing_tools() {
    let root = fixture("providers");
    let output = run(&[
        "debug".into(),
        "providers".into(),
        root.to_string_lossy().into_owned(),
    ]);
    assert!(output.status.success());
    let providers = json(&output)["result"]["providers"]
        .as_array()
        .unwrap()
        .clone();
    for runtime in ["rust", "node", "dart", "flutter"] {
        assert!(providers
            .iter()
            .any(|provider| provider["runtime"] == runtime));
    }
    assert!(providers.iter().all(|provider| {
        matches!(
            provider["status"].as_str(),
            Some("available" | "incompatible" | "missing" | "not-required")
        )
    }));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn debug_run_rejects_remote_endpoints_and_redacts_tokens() {
    let root = fixture("remote");
    let spec = root.join("session.json");
    let secret = "secret-token-must-not-leak";
    fs::write(&spec, format!(r#"{{"version":1,"runtime":"node","request":"attach","endpoint":"ws://203.0.113.10:9229/{secret}","actions":["capture"]}}"#)).unwrap();
    let output = run(&[
        "debug".into(),
        "run".into(),
        "--spec".into(),
        spec.to_string_lossy().into_owned(),
    ]);
    assert_eq!(output.status.code(), Some(64));
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(!text.contains(secret));
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&text).unwrap()["error"]["code"],
        "UNSAFE_DEBUG_ENDPOINT"
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn debug_run_rejects_expression_evaluation_before_provider_launch() {
    let root = fixture("evaluate");
    let spec = root.join("session.json");
    fs::write(&spec, r#"{"version":1,"runtime":"node","request":"attach","endpoint":"ws://127.0.0.1:9229/id","actions":["evaluate"]}"#).unwrap();
    let output = run(&[
        "debug".into(),
        "run".into(),
        "--spec".into(),
        spec.to_string_lossy().into_owned(),
    ]);
    assert_eq!(output.status.code(), Some(64));
    assert_eq!(json(&output)["error"]["code"], "UNSUPPORTED_DEBUG_ACTION");
    fs::remove_dir_all(root).unwrap();
}
