use std::collections::BTreeSet;
use std::io::Read;
use std::path::{Component, Path};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Declaration {
    complete_gate: bool,
    requirements: Vec<Requirement>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Requirement {
    id: String,
    commands: Vec<RequiredCommand>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct RequiredCommand {
    program: String,
    args: Vec<String>,
    cwd: String,
}

pub fn read(root: &Path) -> Result<Option<Declaration>, String> {
    let path = root.join(".agentic/project.json");
    if !path.exists() {
        return Ok(None);
    }
    const MAX_PROJECT_BYTES: u64 = 1024 * 1024;
    let mut bytes = Vec::new();
    std::fs::File::open(&path)
        .map_err(|error| format!("project.json: {error}"))?
        .take(MAX_PROJECT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("project.json: {error}"))?;
    if bytes.len() as u64 > MAX_PROJECT_BYTES {
        return Err("project.json exceeds the 1 MiB verification configuration limit".to_owned());
    }
    let project: Value =
        serde_json::from_slice(&bytes).map_err(|error| format!("project.json: {error}"))?;
    let Some(value) = project.pointer("/overrides/workspace/verificationCoverage") else {
        return Ok(None);
    };
    let declaration: Declaration = serde_json::from_value(value.clone())
        .map_err(|error| format!("verificationCoverage: {error}"))?;
    if declaration.requirements.is_empty() || declaration.requirements.len() > 128 {
        return Err("verificationCoverage requires 1 through 128 requirements".to_owned());
    }
    let mut ids = BTreeSet::new();
    let mut command_count = 0;
    for requirement in &declaration.requirements {
        if requirement.id.trim().is_empty()
            || requirement.id.len() > 128
            || !ids.insert(&requirement.id)
        {
            return Err(
                "verificationCoverage requirement IDs must be unique and 1 through 128 bytes"
                    .to_owned(),
            );
        }
        command_count += requirement.commands.len();
        if requirement.commands.is_empty() || command_count > 128 {
            return Err(
                "verificationCoverage requires nonempty commands and at most 128 total commands"
                    .to_owned(),
            );
        }
        for command in &requirement.commands {
            let cwd = Path::new(&command.cwd);
            if command.program.trim().is_empty()
                || command.args.len() > 128
                || command.cwd.is_empty()
                || cwd.is_absolute()
                || !cwd
                    .components()
                    .all(|component| matches!(component, Component::Normal(_) | Component::CurDir))
            {
                return Err("verificationCoverage commands require a program, at most 128 arguments, and a repository-relative cwd".to_owned());
            }
        }
    }
    Ok(Some(declaration))
}

fn matches(command: &RequiredCommand, step: &Value) -> bool {
    step["command"] == command.program
        && step["args"] == json!(command.args)
        && step["cwd"] == command.cwd
}

fn outcome(command: &RequiredCommand, steps: &[Value]) -> &'static str {
    let matching: Vec<_> = steps.iter().filter(|step| matches(command, step)).collect();
    if matching.is_empty() {
        "notRun"
    } else if matching.iter().all(|step| step["passed"] == true) {
        "passed"
    } else {
        "failed"
    }
}

pub fn report(declaration: Option<&Declaration>, steps: &[Value]) -> Value {
    let Some(declaration) = declaration else {
        return json!({
            "declaration": "undeclared", "completeGate": false,
            "requiredChecksComplete": false, "verdict": "INSUFFICIENT_EVIDENCE",
            "requirements": [], "authority": "verification-evidence-only"
        });
    };
    let mut complete = true;
    let mut failed = false;
    let requirements: Vec<_> = declaration
        .requirements
        .iter()
        .map(|requirement| {
            let commands: Vec<_> = requirement
                .commands
                .iter()
                .map(|command| {
                    let outcome = outcome(command, steps);
                    let mut report = serde_json::to_value(command).expect("command serialization");
                    report["outcome"] = json!(outcome);
                    report
                })
                .collect();
            let outcome = if commands
                .iter()
                .any(|command| command["outcome"] == "failed")
            {
                failed = true;
                "failed"
            } else if commands
                .iter()
                .all(|command| command["outcome"] == "passed")
            {
                "passed"
            } else {
                "notRun"
            };
            complete &= outcome == "passed";
            json!({ "id": requirement.id, "outcome": outcome, "commands": commands })
        })
        .collect();
    json!({
        "declaration": "repository-configured", "completeGate": declaration.complete_gate,
        "requiredChecksComplete": complete,
        "verdict": if failed { "FAIL" } else if complete { "PASS" } else { "INSUFFICIENT_EVIDENCE" },
        "requirements": requirements, "authority": "verification-evidence-only"
    })
}
