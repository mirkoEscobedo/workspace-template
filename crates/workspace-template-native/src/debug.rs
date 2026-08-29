use std::path::{Path, PathBuf};

use serde_json::{json, Value};

pub struct DebugError {
    pub code: &'static str,
    pub message: String,
    pub exit_code: u8,
}

fn executable(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    let extensions: &[&str] = if cfg!(windows) {
        &["", ".exe", ".cmd", ".bat"]
    } else {
        &[""]
    };
    for directory in std::env::split_paths(&path) {
        for extension in extensions {
            let candidate = directory.join(format!("{name}{extension}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg(windows)]
fn cdb() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("WT_CDB_PATH")
        .map(PathBuf::from)
        .filter(|path| path.is_file())
    {
        return Some(path);
    }
    if let Some(root) = std::env::var_os("ProgramFiles(x86)") {
        let candidate = PathBuf::from(root).join("Windows Kits/10/Debuggers/x64/cdb.exe");
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    executable("cdb")
}

#[cfg(not(windows))]
fn cdb() -> Option<PathBuf> {
    None
}

fn provider(runtime: &str, name: &str, path: Option<PathBuf>, protocol: &str) -> Value {
    let discovered = path.is_some();
    json!({
        "runtime": runtime,
        "provider": name,
        "protocol": protocol,
        "status": if discovered { "incompatible" } else { "missing" },
        "discovered": discovered,
        "path": path,
        "reason": if discovered { "provider executable found, but the bounded protocol adapter is not qualified" } else { "host provider executable not found" }
    })
}

pub fn providers(_root: &Path) -> Value {
    let rust = if cfg!(windows) {
        provider("rust", "cdb", cdb(), "cdb-command")
    } else if cfg!(target_os = "macos") {
        provider(
            "rust",
            "rust-lldb",
            executable("rust-lldb").or_else(|| executable("lldb-dap")),
            "dap",
        )
    } else {
        provider(
            "rust",
            "rust-gdb",
            executable("rust-gdb").or_else(|| executable("gdb")),
            "gdb-mi-or-dap",
        )
    };
    json!({
        "policy": "host-owned-bounded-debugging",
        "providers": [
            rust,
            provider("node", "node-inspector", executable("node"), "cdp"),
            provider("dart", "dart-debug-adapter", executable("dart"), "dap"),
            provider("flutter", "flutter-debug-adapter", executable("flutter"), "dap")
        ]
    })
}

fn loopback_endpoint(endpoint: &str) -> bool {
    let without_scheme = endpoint
        .strip_prefix("ws://")
        .or_else(|| endpoint.strip_prefix("wss://"));
    let Some(authority) = without_scheme.and_then(|value| value.split('/').next()) else {
        return false;
    };
    let host = authority
        .rsplit_once(':')
        .map_or(authority, |(host, _)| host)
        .trim_matches(['[', ']']);
    matches!(host, "127.0.0.1" | "localhost" | "::1")
}

fn invalid(code: &'static str, message: impl Into<String>) -> DebugError {
    DebugError {
        code,
        message: message.into(),
        exit_code: 64,
    }
}

fn validate(spec: &Value) -> Result<(), DebugError> {
    if spec["version"] != 1 {
        return Err(invalid(
            "INVALID_DEBUG_SPEC",
            "debug session version must be 1",
        ));
    }
    if !matches!(
        spec["runtime"].as_str(),
        Some("rust" | "node" | "dart" | "flutter")
    ) {
        return Err(invalid(
            "INVALID_DEBUG_SPEC",
            "runtime must be rust, node, dart, or flutter",
        ));
    }
    let request = spec["request"].as_str();
    if !matches!(request, Some("launch" | "attach")) {
        return Err(invalid(
            "INVALID_DEBUG_SPEC",
            "request must be launch or attach",
        ));
    }
    if request == Some("launch") && !spec["program"].is_string() {
        return Err(invalid("INVALID_DEBUG_SPEC", "launch requires program"));
    }
    if request == Some("attach") && !spec["pid"].is_u64() && !spec["endpoint"].is_string() {
        return Err(invalid(
            "INVALID_DEBUG_SPEC",
            "attach requires pid or endpoint",
        ));
    }
    if let Some(endpoint) = spec["endpoint"].as_str() {
        if !loopback_endpoint(endpoint) {
            return Err(invalid(
                "UNSAFE_DEBUG_ENDPOINT",
                "debug endpoints must resolve to loopback; remote endpoint details were redacted",
            ));
        }
    }
    let allowed = [
        "continue", "pause", "stepOver", "stepIn", "stepOut", "capture",
    ];
    for action in spec["actions"].as_array().into_iter().flatten() {
        if !action
            .as_str()
            .is_some_and(|action| allowed.contains(&action))
        {
            return Err(invalid("UNSUPPORTED_DEBUG_ACTION", "debug actions are limited to execution control and bounded evidence capture; evaluation is unavailable"));
        }
    }
    if request == Some("attach") && spec["terminateTarget"] == true {
        return Err(invalid(
            "UNSAFE_DEBUG_TERMINATION",
            "attach sessions cannot terminate a consumer-owned target",
        ));
    }
    Ok(())
}

pub fn execute(args: &[String]) -> Result<(Value, u8), DebugError> {
    match args.first().map(String::as_str) {
        Some("providers")
            if args.len() <= 2 && args.get(1).is_none_or(|arg| !arg.starts_with('-')) =>
        {
            Ok((
                providers(Path::new(args.get(1).map_or(".", String::as_str))),
                0,
            ))
        }
        Some("run") if args.len() == 3 && args[1] == "--spec" => {
            let bytes = std::fs::read(&args[2]).map_err(|error| {
                invalid(
                    "INVALID_DEBUG_SPEC",
                    format!("cannot read debug session: {error}"),
                )
            })?;
            let spec: Value = serde_json::from_slice(&bytes).map_err(|error| {
                invalid(
                    "INVALID_DEBUG_SPEC",
                    format!("invalid debug session JSON: {error}"),
                )
            })?;
            validate(&spec)?;
            let runtime = spec["runtime"].as_str().unwrap();
            let listing = providers(Path::new(spec["cwd"].as_str().unwrap_or(".")));
            let selected = listing["providers"]
                .as_array()
                .unwrap()
                .iter()
                .find(|provider| provider["runtime"] == runtime)
                .cloned()
                .unwrap_or(Value::Null);
            Ok((
                json!({
                    "verdict": "INSUFFICIENT_EVIDENCE",
                    "runtime": runtime,
                    "request": spec["request"],
                    "provider": selected,
                    "reason": "the host provider was discovered but its bounded protocol adapter has not been qualified",
                    "sourceMutated": false,
                    "targetTerminated": false
                }),
                1,
            ))
        }
        Some("providers") => Err(invalid(
            "INVALID_ARGUMENT",
            "debug providers accepts at most one root path",
        )),
        Some("run") => Err(invalid(
            "INVALID_ARGUMENT",
            "debug run requires --spec <session.json>",
        )),
        _ => Err(invalid(
            "INVALID_ARGUMENT",
            "debug requires providers [root] or run --spec <session.json>",
        )),
    }
}
