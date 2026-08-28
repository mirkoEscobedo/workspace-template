use std::path::Path;
use std::time::Duration;

use serde_json::{json, Value};

use crate::runner;

#[cfg(windows)]
fn flutter_program() -> &'static str {
    "flutter.bat"
}

#[cfg(not(windows))]
fn flutter_program() -> &'static str {
    "flutter"
}

fn steps(root: &Path) -> Result<Vec<(String, Vec<String>)>, String> {
    if root.join("pubspec.yaml").is_file() {
        return Ok(vec![
            (flutter_program().to_owned(), vec!["analyze".to_owned()]),
            (flutter_program().to_owned(), vec!["test".to_owned()]),
        ]);
    }
    if root.join("Cargo.toml").is_file() {
        return Ok(vec![
            (
                "cargo".to_owned(),
                vec![
                    "fmt".to_owned(),
                    "--all".to_owned(),
                    "--".to_owned(),
                    "--check".to_owned(),
                ],
            ),
            ("cargo".to_owned(), vec!["test".to_owned()]),
        ]);
    }
    let package_path = root.join("package.json");
    if package_path.is_file() {
        let package: Value = serde_json::from_slice(
            &std::fs::read(&package_path).map_err(|error| error.to_string())?,
        )
        .map_err(|error| format!("package.json: {error}"))?;
        let script = if package["scripts"]["check"].is_string() {
            "check"
        } else {
            "test"
        };
        let manager = if root.join("pnpm-lock.yaml").is_file() {
            "pnpm.cmd"
        } else {
            "npm.cmd"
        };
        return Ok(vec![(
            manager.to_owned(),
            vec!["run".to_owned(), script.to_owned()],
        )]);
    }
    Err("no deterministic verification topology was detected".to_owned())
}

pub fn verify(root: &Path, timeout_ms: u64) -> (Value, bool) {
    let commands = match steps(root) {
        Ok(commands) => commands,
        Err(error) => {
            return (
                json!({ "verdict": "INSUFFICIENT_EVIDENCE", "errors": [error], "steps": [] }),
                false,
            )
        }
    };
    let mut reports = Vec::new();
    let mut ok = true;
    for (command, args) in commands {
        match runner::run(&command, &args, root, Duration::from_millis(timeout_ms)) {
            Ok(result) => {
                let passed = result.status == Some(0) && !result.timed_out;
                reports.push(json!({
                    "command": command,
                    "args": args,
                    "status": result.status,
                    "timedOut": result.timed_out,
                    "stdout": result.stdout,
                    "stderr": result.stderr,
                    "processOwnership": "windows-job-object"
                }));
                if !passed {
                    ok = false;
                    break;
                }
            }
            Err(error) => {
                reports.push(json!({ "command": command, "args": args, "error": error }));
                ok = false;
                break;
            }
        }
    }
    (
        json!({
            "verdict": if ok { "PASS" } else { "FAIL" },
            "evidenceLevel": "deterministic",
            "inspectionCapability": null,
            "permittedNextTransition": if ok { "REVIEWING" } else { "DIAGNOSING" },
            "steps": reports
        }),
        ok,
    )
}

#[cfg(test)]
mod tests {
    #[cfg(windows)]
    #[test]
    fn windows_flutter_topology_uses_the_batch_entrypoint() {
        assert_eq!(super::flutter_program(), "flutter.bat");
    }
}
