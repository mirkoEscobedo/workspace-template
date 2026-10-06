use std::ffi::OsStr;
use std::path::Path;
use std::time::Duration;

use crate::runner::{self, RunResult};

const DISCOVERY_TIMEOUT: Duration = Duration::from_secs(5);
// Stay below the runner's retained tail. A truncated path list cannot qualify
// affected selection, even when Git itself completed successfully.
const MAX_DISCOVERY_OUTPUT_BYTES: usize = 64 * 1024;

pub fn run(root: &Path, args: &[String]) -> Result<RunResult, String> {
    let result = runner::run(OsStr::new("git"), args, root, DISCOVERY_TIMEOUT)
        .map_err(|error| format!("Git discovery {}: {error}", args.join(" ")))?;
    if !result.cleanup.qualified {
        return Err(format!(
            "Git discovery {} cleanup is unqualified ({}; active processes: {:?}): {}",
            args.join(" "),
            result.cleanup.outcome,
            result.cleanup.active_processes,
            result
                .cleanup
                .error
                .as_deref()
                .unwrap_or("no cleanup observation"),
        ));
    }
    if result.timed_out {
        return Err(format!("Git discovery {} exceeded 5000 ms", args.join(" ")));
    }
    if result.stdout.len() > MAX_DISCOVERY_OUTPUT_BYTES {
        return Err(format!(
            "Git discovery {} output exceeds the 65536-byte qualification limit",
            args.join(" ")
        ));
    }
    Ok(result)
}
