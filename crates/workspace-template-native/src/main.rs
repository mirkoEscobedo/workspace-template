use std::process::ExitCode;

use serde::Serialize;
use serde_json::{json, Value};

mod assets;
mod delivery;
mod doctor;
mod inspection;
mod runner;
mod verify;

const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Envelope {
    schema_version: u8,
    command: String,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<Value>,
}

impl Envelope {
    fn success(command: &str, result: Value) -> Self {
        Self {
            schema_version: 1,
            command: command.to_owned(),
            ok: true,
            result: Some(result),
            error: None,
        }
    }

    fn failure(command: &str, code: &str, message: impl Into<String>) -> Self {
        Self {
            schema_version: 1,
            command: command.to_owned(),
            ok: false,
            result: None,
            error: Some(json!({ "code": code, "message": message.into() })),
        }
    }
}

fn route(args: &[String]) -> Envelope {
    let governed_flags = [
        "--irreversible",
        "--credentials",
        "--security",
        "--financial-authority",
        "--destructive-migration",
        "--native-process-ownership",
        "--external-authority",
    ];
    let governed: Vec<&str> = governed_flags
        .into_iter()
        .filter(|flag| args.iter().any(|arg| arg == *flag))
        .collect();
    let multi_session = args.iter().any(|arg| arg == "--multi-session");
    let slice_count = args
        .windows(2)
        .find(|pair| pair[0] == "--slice-count")
        .and_then(|pair| pair[1].parse::<u32>().ok())
        .unwrap_or(1);

    let (mode, reasons, artifacts) = if !governed.is_empty() {
        (
            "governed",
            governed
                .iter()
                .map(|flag| flag.trim_start_matches("--"))
                .collect(),
            vec![
                "acceptance-contract",
                "state-record",
                "independent-review",
                "authority-receipts",
            ],
        )
    } else if multi_session || slice_count > 1 {
        (
            "ticketed",
            vec![if multi_session {
                "multi-session"
            } else {
                "multiple-vertical-slices"
            }],
            vec!["compact-plan", "current-ticket"],
        )
    } else {
        ("direct", vec!["ordinary-bounded-work"], Vec::new())
    };

    Envelope::success(
        "route",
        json!({
            "mode": mode,
            "reasons": reasons,
            "durableArtifacts": artifacts,
            "wayfinderAdmitted": false,
            "limits": { "semanticRepairs": 2, "flakyReruns": 1 }
        }),
    )
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let command = args.first().map(String::as_str).unwrap_or("instructions");
    let target = args
        .get(1)
        .filter(|value| !value.starts_with('-'))
        .map(String::as_str)
        .unwrap_or(".");
    let (envelope, exit_code) = match command {
        "instructions" => (
            Envelope::success(
                "instructions",
                json!({
                    "method": "adaptive",
                    "defaultMode": "direct",
                    "states": ["INTAKE", "ROUTED", "PLANNED", "IMPLEMENTING", "VERIFYING", "REVIEWING", "ACCEPTED"],
                    "failureStates": ["DIAGNOSING", "INSPECTING", "REPAIRING", "REPLANNING"],
                    "limits": { "semanticRepairs": 2, "flakyReruns": 1 },
                    "embeddedAssets": {
                        "count": assets::EMBEDDED_ASSETS.len(),
                        "manifestSha256": assets::manifest_sha256(),
                        "paths": assets::paths()
                    }
                }),
            ),
            0,
        ),
        "route" => (route(&args[1..]), 0),
        "inspect" => (
            Envelope::success("inspect", inspection::inspect(std::path::Path::new(target))),
            0,
        ),
        "doctor" => {
            let (result, ok) = doctor::doctor(std::path::Path::new(target));
            (Envelope::success("doctor", result), if ok { 0 } else { 1 })
        }
        "verify" => {
            let timeout = args
                .windows(2)
                .find(|pair| pair[0] == "--timeout")
                .and_then(|pair| pair[1].parse::<u64>().ok())
                .unwrap_or(120_000);
            let (result, ok) = verify::verify(std::path::Path::new(target), timeout);
            (Envelope::success("verify", result), if ok { 0 } else { 1 })
        }
        "adopt" | "upgrade" => match delivery::execute(command, &args[1..]) {
            Ok((result, exit_code)) => (Envelope::success(command, result), exit_code),
            Err(error) => (
                Envelope::failure(command, error.code, error.message),
                error.exit_code,
            ),
        },
        "skills" if args.get(1).map(String::as_str) == Some("update") => {
            match delivery::execute("skills-update", &args[2..]) {
                Ok((result, exit_code)) => (Envelope::success("skills-update", result), exit_code),
                Err(error) => (
                    Envelope::failure("skills-update", error.code, error.message),
                    error.exit_code,
                ),
            }
        }
        "--version" | "version" => (
            Envelope::success(
                "version",
                json!({
                    "version": VERSION,
                    "target": env!("WT_TARGET"),
                    "sourceCommit": env!("WT_SOURCE_COMMIT"),
                    "embeddedAssetsManifestSha256": assets::manifest_sha256()
                }),
            ),
            0,
        ),
        "create" | "tooling" | "preset" | "restructure" | "align" => (
            Envelope::failure(
                command,
                "UNSUPPORTED_IN_NATIVE_0_8",
                format!("{command} is not available in the Windows native 0.8 vertical slice"),
            ),
            64,
        ),
        _ => (
            Envelope::failure(
                command,
                "UNKNOWN_COMMAND",
                format!("unknown command: {command}"),
            ),
            64,
        ),
    };
    println!(
        "{}",
        serde_json::to_string(&envelope).expect("envelope serialization cannot fail")
    );
    ExitCode::from(exit_code)
}
