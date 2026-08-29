use std::collections::BTreeSet;
use std::path::Path;
use std::process::ExitCode;

use serde::Serialize;
use serde_json::{json, Value};

mod assets;
mod delivery;
mod delivery_args;
mod doctor;
mod inspection;
mod release;
mod runner;
mod update_status;
mod verify;

const VERSION: &str = env!("CARGO_PKG_VERSION");
const EXIT_FAILURE: u8 = 1;
const EXIT_STALE: u8 = 2;
const EXIT_CONFLICT: u8 = 3;
const EXIT_USAGE: u8 = 64;
const EXIT_NOT_FOUND: u8 = 66;
const EXIT_UNSUPPORTED_PLATFORM: u8 = 69;

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

fn invalid(command: &str, message: impl Into<String>) -> (Envelope, u8) {
    (
        Envelope::failure(command, "INVALID_ARGUMENT", message),
        EXIT_USAGE,
    )
}

fn normalized_args() -> Result<Vec<String>, String> {
    let mut json_count = 0;
    let args: Vec<_> = std::env::args()
        .skip(1)
        .filter(|argument| {
            if argument == "--json" {
                json_count += 1;
                false
            } else {
                true
            }
        })
        .collect();
    if json_count > 1 {
        Err("--json may be specified at most once; JSON is already the default output".to_owned())
    } else {
        Ok(args)
    }
}

fn help() -> Value {
    json!({
        "usage": "workspace-template <command> [arguments]",
        "output": "json",
        "jsonOption": "--json explicitly selects the default JSON envelope and is accepted once for compatibility",
        "commands": [
            "instructions",
            "route [--slice-count <positive-integer>] [--multi-session] [governance flags]",
            "inspect [root]",
            "doctor [root]",
            "verify [root] [--timeout <milliseconds>]",
            "adopt plan|apply [root]",
            "upgrade plan|apply [root]",
            "skills list",
            "skills show <name>",
            "skills update",
            "update status [root]",
            "version"
        ],
        "exitCodes": {
            "success": 0,
            "failure": EXIT_FAILURE,
            "stalePlan": EXIT_STALE,
            "conflict": EXIT_CONFLICT,
            "usage": EXIT_USAGE,
            "notFound": EXIT_NOT_FOUND,
            "unsupportedPlatform": EXIT_UNSUPPORTED_PLATFORM
        }
    })
}

fn root_only(command: &str, args: &[String]) -> Result<String, (Envelope, u8)> {
    if args.len() > 1 || args.first().is_some_and(|value| value.starts_with('-')) {
        return Err(invalid(
            command,
            format!("{command} accepts at most one root path"),
        ));
    }
    Ok(args.first().cloned().unwrap_or_else(|| ".".to_owned()))
}

fn route(args: &[String]) -> Result<Value, String> {
    let governed_flags = [
        "--irreversible",
        "--credentials",
        "--security",
        "--financial-authority",
        "--destructive-migration",
        "--native-process-ownership",
        "--external-authority",
    ];
    let mut governed = Vec::new();
    let mut multi_session = false;
    let mut slice_count = 1_u32;
    let mut seen = BTreeSet::new();
    let mut index = 0;
    while index < args.len() {
        let argument = &args[index];
        if !seen.insert(argument.as_str()) {
            return Err(format!("duplicate route option: {argument}"));
        }
        if governed_flags.contains(&argument.as_str()) {
            governed.push(argument.trim_start_matches("--"));
        } else if argument == "--multi-session" {
            multi_session = true;
        } else if argument == "--slice-count" {
            index += 1;
            let value = args
                .get(index)
                .ok_or_else(|| "--slice-count requires a positive integer".to_owned())?;
            slice_count = value
                .parse::<u32>()
                .ok()
                .filter(|value| *value > 0)
                .ok_or_else(|| "--slice-count requires a positive integer".to_owned())?;
        } else {
            return Err(format!("unknown route argument: {argument}"));
        }
        index += 1;
    }

    let (mode, reasons, artifacts) = if !governed.is_empty() {
        (
            "governed",
            governed,
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
    Ok(json!({
        "mode": mode,
        "reasons": reasons,
        "durableArtifacts": artifacts,
        "wayfinderAdmitted": false,
        "limits": { "semanticRepairs": 2, "flakyReruns": 1 }
    }))
}

fn verify_args(args: &[String]) -> Result<(String, u64), String> {
    let mut root = None;
    let mut timeout = 120_000_u64;
    let mut timeout_seen = false;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--timeout" => {
                if timeout_seen {
                    return Err("duplicate verify option: --timeout".to_owned());
                }
                timeout_seen = true;
                index += 1;
                timeout = args
                    .get(index)
                    .and_then(|value| value.parse::<u64>().ok())
                    .filter(|value| *value > 0)
                    .ok_or_else(|| "--timeout requires positive milliseconds".to_owned())?;
            }
            option if option.starts_with('-') => {
                return Err(format!("unknown verify option: {option}"));
            }
            value if root.is_none() => root = Some(value.to_owned()),
            value => return Err(format!("unexpected verify positional: {value}")),
        }
        index += 1;
    }
    Ok((root.unwrap_or_else(|| ".".to_owned()), timeout))
}

fn platform_supported() -> bool {
    platform_supported_for(std::env::consts::OS, std::env::consts::ARCH)
}

fn platform_supported_for(os: &str, arch: &str) -> bool {
    os == "windows" && arch == "x86_64"
}

fn dispatch(args: &[String]) -> (Envelope, u8) {
    let command = args.first().map(String::as_str).unwrap_or("instructions");
    let tail = if args.is_empty() { &[] } else { &args[1..] };
    if !platform_supported() && !matches!(command, "help" | "--help" | "version" | "--version") {
        return (
            Envelope::failure(
                command,
                "UNSUPPORTED_PLATFORM",
                format!(
                    "workspace-template {VERSION} supports windows-x86_64; current platform is {}-{}",
                    std::env::consts::OS,
                    std::env::consts::ARCH
                ),
            ),
            EXIT_UNSUPPORTED_PLATFORM,
        );
    }
    match command {
        "help" | "--help" if tail.is_empty() => (Envelope::success("help", help()), 0),
        "help" | "--help" => invalid("help", "help does not accept arguments"),
        "instructions" if tail.is_empty() => (
            Envelope::success(
                "instructions",
                json!({
                    "method": "adaptive",
                    "defaultMode": "direct",
                    "modelAndAgentSelection": "host-owned",
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
        "instructions" => invalid("instructions", "instructions does not accept arguments"),
        "route" => match route(tail) {
            Ok(result) => (Envelope::success("route", result), 0),
            Err(message) => invalid("route", message),
        },
        "inspect" | "doctor" => match root_only(command, tail) {
            Ok(root) if command == "inspect" => (
                Envelope::success("inspect", inspection::inspect(Path::new(&root))),
                0,
            ),
            Ok(root) => {
                let (result, ok) = doctor::doctor(Path::new(&root));
                (
                    Envelope::success("doctor", result),
                    if ok { 0 } else { EXIT_FAILURE },
                )
            }
            Err(failure) => failure,
        },
        "verify" => match verify_args(tail) {
            Ok((root, timeout)) => {
                let (result, ok) = verify::verify(Path::new(&root), timeout);
                (
                    Envelope::success("verify", result),
                    if ok { 0 } else { EXIT_FAILURE },
                )
            }
            Err(message) => invalid("verify", message),
        },
        "adopt" | "upgrade" => match delivery::execute(command, tail) {
            Ok((result, exit_code)) => (Envelope::success(command, result), exit_code),
            Err(error) => (
                Envelope::failure(command, error.code, error.message),
                error.exit_code,
            ),
        },
        "skills" => match tail.first().map(String::as_str) {
            Some("list") if tail.len() == 1 => {
                (Envelope::success("skills-list", assets::skills_list()), 0)
            }
            Some("show") if tail.len() == 2 => match assets::skills_show(&tail[1]) {
                Some(result) => (Envelope::success("skills-show", result), 0),
                None => (
                    Envelope::failure(
                        "skills-show",
                        "SKILL_NOT_FOUND",
                        format!("embedded skill not found: {}", tail[1]),
                    ),
                    EXIT_NOT_FOUND,
                ),
            },
            Some("update") => (
                Envelope::failure(
                    "skills-update",
                    "PACKAGE_MANAGER_UPDATE_REQUIRED",
                    "skills are package-owned and read-only; update the exact dependency with npm or pnpm, then run sealed `workspace-template upgrade plan` and `workspace-template upgrade apply`",
                ),
                EXIT_USAGE,
            ),
            _ => invalid("skills", "skills requires `list`, `show <name>`, or `update`"),
        },
        "update" if tail.first().map(String::as_str) == Some("status") => {
            match root_only("update status", &tail[1..]) {
                Ok(root) => {
                    let (result, current) = update_status::status(Path::new(&root));
                    (
                        Envelope::success("update-status", result),
                        if current { 0 } else { EXIT_FAILURE },
                    )
                }
                Err(failure) => failure,
            }
        }
        "update" => invalid("update", "update requires `status [root]`"),
        "--version" | "version" if tail.is_empty() => (
            Envelope::success(
                "version",
                json!({
                    "version": VERSION,
                    "packageName": "workspace-template",
                    "target": env!("WT_TARGET"),
                    "sourceCommit": env!("WT_SOURCE_COMMIT"),
                    "releaseCommit": release::release_commit(),
                    "signingStatus": release::signing_status(),
                    "embeddedAssetsManifestSha256": assets::manifest_sha256(),
                    "releaseManifestSha256": assets::release_manifest_sha256()
                }),
            ),
            0,
        ),
        "--version" | "version" => invalid("version", "version does not accept arguments"),
        "create" | "tooling" | "preset" | "restructure" | "align" | "sync" | "retrofit" => (
            Envelope::failure(
                command,
                "UNSUPPORTED_PORTABLE_CAPABILITY",
                format!("{command} is outside the portable workspace-template product boundary"),
            ),
            EXIT_USAGE,
        ),
        _ => (
            Envelope::failure(command, "UNKNOWN_COMMAND", format!("unknown command: {command}")),
            EXIT_USAGE,
        ),
    }
}

fn main() -> ExitCode {
    let (envelope, exit_code) = match normalized_args() {
        Ok(args) => dispatch(&args),
        Err(message) => invalid("arguments", message),
    };
    println!(
        "{}",
        serde_json::to_string(&envelope).expect("envelope serialization cannot fail")
    );
    ExitCode::from(exit_code)
}

#[cfg(test)]
mod tests {
    #[test]
    fn platform_contract_rejects_every_unshipped_example() {
        assert!(super::platform_supported_for("windows", "x86_64"));
        for (os, arch) in [
            ("linux", "x86_64"),
            ("macos", "aarch64"),
            ("linux", "aarch64"),
            ("windows", "aarch64"),
            ("macos", "x86_64"),
        ] {
            assert!(!super::platform_supported_for(os, arch), "{os}-{arch}");
        }
    }
}
