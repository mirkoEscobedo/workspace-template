mod policy;
mod snapshot;

use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use policy::Policy;
use snapshot::Snapshot;

pub use policy::check_command_cwd;

pub struct Observation {
    root: PathBuf,
    policy: Option<Policy>,
    before: Result<Snapshot, String>,
    preflight_error: Option<String>,
}

pub fn begin(root: &Path) -> Observation {
    let loaded = policy::load(root);
    let (policy, preflight_error) = match loaded {
        Ok(policy) => (policy, None),
        Err(error) => (None, Some(error)),
    };
    let before = policy.as_ref().map_or_else(
        || Err("no-explicit-input-policy".to_owned()),
        |policy| snapshot::capture(root, policy),
    );
    Observation {
        root: root.to_path_buf(),
        policy,
        before,
        preflight_error,
    }
}

impl Observation {
    pub fn resolved_program(&self, program: &str) -> Option<&Path> {
        self.before
            .as_ref()
            .ok()?
            .programs
            .get(program)
            .map(|(path, _)| Path::new(path))
    }

    pub fn preflight_error(&self) -> Option<&str> {
        self.preflight_error.as_deref()
    }

    pub fn finish(&self, report: &Value) -> Value {
        let mut record = json!({
            "schemaVersion": 1, "qualified": false, "sha256": null,
            "assurance": "declared-inputs-only",
            "limits": ["No automatic caching or acceptance", "Only explicit inputs and resolved program files are covered", "Before/after observations do not prove absence of transient changes or transitive tool dependencies"]
        });
        if let Some(error) = &self.preflight_error {
            record["reason"] = json!(error);
            return record;
        }
        let (Some(policy), Ok(before)) = (&self.policy, &self.before) else {
            record["reason"] = json!(self.before.as_ref().err());
            return record;
        };
        let after_policy = match policy::load(&self.root) {
            Ok(Some(after)) if after == *policy => after,
            _ => {
                record["reason"] = json!("input-policy-changed-during-execution");
                return record;
            }
        };
        let after = match snapshot::capture(&self.root, &after_policy) {
            Ok(after) => after,
            Err(error) => {
                record["reason"] = json!(error);
                return record;
            }
        };
        if before != &after {
            record["reason"] = json!("inputs-changed-during-execution");
            return record;
        }
        let steps: Vec<_> = report["steps"].as_array().into_iter().flatten().map(|step| {
            json!({"program": step["command"], "args": step["args"], "cwd": step["cwd"], "module": step["module"], "resolvedProgram": step["resolvedProgram"], "programImage": step["programImage"].as_str().and_then(|path| std::fs::canonicalize(path).ok()).and_then(|path| path.to_str().map(str::to_owned))})
        }).collect();
        if steps.is_empty()
            || steps.iter().any(|step| {
                step["program"].as_str().is_none_or(|program| {
                    !policy.programs.iter().any(|declared| declared == program)
                })
            })
        {
            record["reason"] = json!("executed-program-identity-not-declared");
            return record;
        }
        if report["steps"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|step| {
                let image = step["programImage"]
                    .as_str()
                    .and_then(|path| std::fs::canonicalize(path).ok());
                image.is_none_or(|image| {
                    !before
                        .programs
                        .values()
                        .any(|(path, _)| Path::new(path) == image)
                })
            })
        {
            record["reason"] = json!("launched-program-identity-not-declared");
            return record;
        }
        if !policy.service_constraints.is_empty() {
            record["reason"] = json!("external-service-state-not-observed");
            return record;
        }
        let cleanup_qualified = report["steps"]
            .as_array()
            .into_iter()
            .flatten()
            .all(|step| step["cleanup"]["qualified"] == true);
        if !cleanup_qualified {
            record["reason"] = json!("process-cleanup-not-qualified");
            return record;
        }
        let bytes =
            serde_json::to_vec(&(policy, before, steps)).expect("input identity values serialize");
        record["sha256"] = json!(hex::encode(Sha256::digest(bytes)));
        record["qualified"] = json!(true);
        record["reason"] = json!("stable-declared-inputs");
        record["fileCount"] = json!(before.files.len());
        record["programCount"] = json!(before.programs.len());
        record["verifierSha256"] = json!(before.verifier_sha256);
        record
    }
}
