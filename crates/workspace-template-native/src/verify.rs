use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use serde_json::{json, Value};

use crate::runner;
use crate::verify_cli::{Options, Scope};
use crate::workspace_graph::{CommandSpec, Module, WorkspaceGraph};

#[cfg(windows)]
fn flutter_program() -> &'static str {
    "flutter.bat"
}
#[cfg(not(windows))]
fn flutter_program() -> &'static str {
    "flutter"
}

fn root_steps(root: &Path) -> Result<Vec<(String, Vec<String>)>, String> {
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

fn root_verify(root: &Path, timeout_ms: u64) -> (Value, bool) {
    let commands = match root_steps(root) {
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
                reports.push(json!({ "command": command, "args": args, "status": result.status, "timedOut": result.timed_out, "stdout": result.stdout, "stderr": result.stderr, "processOwnership": runner::ownership() }));
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
        json!({ "verdict": if ok { "PASS" } else { "FAIL" }, "evidenceLevel": "deterministic", "inspectionCapability": null, "permittedNextTransition": if ok { "REVIEWING" } else { "DIAGNOSING" }, "steps": reports }),
        ok,
    )
}

fn git_paths(root: &Path, args: &[String]) -> Result<Vec<String>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .map_err(|error| format!("launch git: {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|line| line.trim().replace('\\', "/"))
        .filter(|line| !line.is_empty())
        .collect())
}

fn changed_paths(root: &Path, from: Option<&str>) -> Result<Vec<String>, String> {
    let mut paths = BTreeSet::new();
    if let Some(reference) = from {
        paths.extend(git_paths(
            root,
            &[
                "diff".into(),
                "--name-only".into(),
                format!("{reference}...HEAD"),
            ],
        )?);
    }
    for args in [
        vec!["diff".into(), "--name-only".into()],
        vec!["diff".into(), "--cached".into(), "--name-only".into()],
        vec![
            "ls-files".into(),
            "--others".into(),
            "--exclude-standard".into(),
        ],
    ] {
        paths.extend(git_paths(root, &args)?);
    }
    Ok(paths.into_iter().collect())
}

fn selected_modules(
    graph: &WorkspaceGraph,
    options: &Options,
    root: &Path,
) -> Result<(BTreeSet<String>, Vec<String>), String> {
    let all: BTreeSet<_> = graph
        .modules
        .iter()
        .map(|module| module.id.clone())
        .collect();
    let (mut selected, changes) = match options.scope {
        Scope::All => (all.clone(), Vec::new()),
        Scope::Module => {
            for module in &options.modules {
                if !all.contains(module) {
                    return Err(format!("unknown workspace module: {module}"));
                }
            }
            (options.modules.iter().cloned().collect(), Vec::new())
        }
        Scope::Affected => {
            let changes = changed_paths(root, options.affected_from.as_deref())?;
            let mut selected = BTreeSet::new();
            let mut unowned = false;
            for path in &changes {
                let owner = graph
                    .modules
                    .iter()
                    .filter(|module| {
                        module.root == "."
                            || path == &module.root
                            || path.starts_with(&format!("{}/", module.root))
                    })
                    .max_by_key(|module| module.root.len());
                match owner {
                    Some(module) => {
                        selected.insert(module.id.clone());
                    }
                    None => unowned = true,
                }
            }
            if unowned {
                selected = all.clone();
            }
            (selected, changes)
        }
        Scope::Root => unreachable!(),
    };
    loop {
        let dependents: Vec<_> = graph
            .edges
            .iter()
            .filter(|edge| selected.contains(&edge.to) && !selected.contains(&edge.from))
            .map(|edge| edge.from.clone())
            .collect();
        if dependents.is_empty() {
            break;
        }
        selected.extend(dependents);
    }
    Ok((selected, changes))
}

fn run_module(root: &Path, module: &Module, timeout_ms: u64) -> (Vec<Value>, bool, bool) {
    if module.commands.is_empty() {
        return (Vec::new(), false, true);
    }
    let mut reports = Vec::new();
    for CommandSpec { program, args, cwd } in &module.commands {
        let cwd_path = root.join(cwd);
        match runner::run(program, args, &cwd_path, Duration::from_millis(timeout_ms)) {
            Ok(result) => {
                let passed = result.status == Some(0) && !result.timed_out;
                reports.push(json!({ "module": module.id, "command": program, "args": args, "cwd": cwd, "status": result.status, "timedOut": result.timed_out, "stdout": result.stdout, "stderr": result.stderr, "processOwnership": runner::ownership() }));
                if !passed {
                    return (reports, false, false);
                }
            }
            Err(error) => {
                reports.push(json!({ "module": module.id, "command": program, "args": args, "error": error }));
                return (reports, false, false);
            }
        }
    }
    (reports, true, false)
}

fn workspace_verify(root: &Path, options: &Options) -> (Value, bool) {
    let graph = crate::workspace_graph::discover(root);
    if !graph.valid {
        return (
            json!({ "verdict": "INSUFFICIENT_EVIDENCE", "errors": ["workspace graph contains unresolved conflicts"], "conflicts": graph.conflicts, "steps": [] }),
            false,
        );
    }
    let (selected, changes) = match selected_modules(&graph, options, root) {
        Ok(selection) => selection,
        Err(error) => {
            return (
                json!({ "verdict": "INSUFFICIENT_EVIDENCE", "errors": [error], "steps": [] }),
                false,
            )
        }
    };
    let modules: BTreeMap<_, _> = graph
        .modules
        .iter()
        .map(|module| (module.id.clone(), module))
        .collect();
    let dependencies: BTreeMap<_, BTreeSet<_>> = selected
        .iter()
        .map(|id| {
            (
                id.clone(),
                graph
                    .edges
                    .iter()
                    .filter(|edge| edge.from == *id && selected.contains(&edge.to))
                    .map(|edge| edge.to.clone())
                    .collect(),
            )
        })
        .collect();
    let mut remaining = selected.clone();
    let mut passed = BTreeSet::new();
    let mut failed = BTreeSet::new();
    let mut blocked = Vec::new();
    let mut reports = Vec::new();
    let mut insufficient = false;
    while !remaining.is_empty() {
        let blocked_now: Vec<_> = remaining
            .iter()
            .filter(|id| {
                dependencies[*id]
                    .iter()
                    .any(|dependency| failed.contains(dependency))
            })
            .cloned()
            .collect();
        for id in blocked_now {
            remaining.remove(&id);
            failed.insert(id.clone());
            blocked.push(id);
        }
        let ready: Vec<_> = remaining
            .iter()
            .filter(|id| {
                dependencies[*id]
                    .iter()
                    .all(|dependency| passed.contains(dependency))
            })
            .cloned()
            .collect();
        if ready.is_empty() {
            break;
        }
        for chunk in ready.chunks(options.concurrency) {
            let outcomes: Vec<_> = std::thread::scope(|scope| {
                chunk
                    .iter()
                    .map(|id| {
                        let module = modules[id];
                        let id = id.clone();
                        scope.spawn(move || (id, run_module(root, module, options.timeout_ms)))
                    })
                    .collect::<Vec<_>>()
                    .into_iter()
                    .map(|handle| handle.join().expect("verification worker"))
                    .collect()
            });
            for (id, (mut module_reports, ok, missing)) in outcomes {
                remaining.remove(&id);
                reports.append(&mut module_reports);
                insufficient |= missing;
                if ok {
                    passed.insert(id);
                } else {
                    failed.insert(id);
                }
            }
        }
    }
    let ok = failed.is_empty() && !insufficient && remaining.is_empty();
    let verdict = if ok {
        "PASS"
    } else if insufficient {
        "INSUFFICIENT_EVIDENCE"
    } else {
        "FAIL"
    };
    let scope = match options.scope {
        Scope::Module => "module",
        Scope::Affected => "affected",
        Scope::All => "all",
        Scope::Root => "root",
    };
    (
        json!({ "verdict": verdict, "scope": scope, "graphFingerprint": graph.fingerprint, "selection": { "modules": selected, "changedPaths": changes }, "blocked": blocked, "steps": reports }),
        ok,
    )
}

pub fn verify(options: &Options) -> (Value, bool) {
    let root = PathBuf::from(&options.root);
    if options.scope == Scope::Root {
        root_verify(&root, options.timeout_ms)
    } else {
        workspace_verify(&root, options)
    }
}

#[cfg(test)]
mod tests {
    #[cfg(windows)]
    #[test]
    fn windows_flutter_topology_uses_the_batch_entrypoint() {
        assert_eq!(super::flutter_program(), "flutter.bat");
    }
}
