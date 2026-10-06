use std::ffi::OsStr;
use std::path::Path;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::runner;
use crate::workspace_graph::CommandSpec;

pub mod coverage;

pub fn duration_ms(started: Instant) -> u64 {
    started.elapsed().as_millis().min(u64::MAX as u128) as u64
}

pub fn run_step(
    root: &Path,
    command: &CommandSpec,
    timeout_ms: u64,
    module: Option<&str>,
    identity: &crate::verify_identity::Observation,
) -> (Value, bool) {
    let started = Instant::now();
    let resolved_program = identity.resolved_program(&command.program);
    let executable = resolved_program.map_or_else(|| OsStr::new(&command.program), Path::as_os_str);
    let outcome = crate::verify_identity::check_command_cwd(root, &command.cwd).and_then(|()| {
        runner::run(
            executable,
            &command.args,
            &root.join(&command.cwd),
            Duration::from_millis(timeout_ms),
        )
    });
    let mut report = json!({
        "command": command.program, "args": command.args, "cwd": command.cwd,
        "durationMs": duration_ms(started), "processOwnership": runner::ownership(),
        "programImage": null
    });
    if let Some(resolved_program) = resolved_program {
        report["resolvedProgram"] = json!(resolved_program);
    }
    if let Some(module) = module {
        report["module"] = json!(module);
    }
    let passed = match outcome {
        Ok(result) => {
            let passed = result.status == Some(0) && !result.timed_out && result.cleanup.qualified;
            report["status"] = json!(result.status);
            report["timedOut"] = json!(result.timed_out);
            report["stdout"] = json!(result.stdout);
            report["stderr"] = json!(result.stderr);
            report["cleanup"] = json!(result.cleanup);
            report["programImage"] = json!(result.program_image);
            passed
        }
        Err(error) => {
            report["error"] = json!(error);
            false
        }
    };
    report["passed"] = json!(passed);
    (report, passed)
}
