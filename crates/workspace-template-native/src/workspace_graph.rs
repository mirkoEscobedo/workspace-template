use std::collections::{BTreeMap, BTreeSet};
use std::path::{Component, Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandSpec {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Module {
    pub id: String,
    pub root: String,
    pub kind: String,
    pub name: Option<String>,
    pub manifest: Option<String>,
    pub toolchain: Option<String>,
    pub lock_owner: Option<String>,
    pub commands: Vec<CommandSpec>,
    pub opaque: bool,
    #[serde(skip)]
    dependencies: BTreeSet<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Edge {
    pub from: String,
    pub to: String,
    pub kind: &'static str,
}

#[derive(Clone, Debug, Serialize)]
pub struct Conflict {
    pub code: String,
    pub message: String,
    pub paths: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitState {
    pub head: Option<String>,
    pub dirty: Option<bool>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceGraph {
    pub schema_version: u8,
    pub root_aggregate: RootAggregate,
    pub modules: Vec<Module>,
    pub edges: Vec<Edge>,
    pub conflicts: Vec<Conflict>,
    pub unsafe_symlinks: Vec<String>,
    pub fingerprint: String,
    pub git: GitState,
    pub valid: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct RootAggregate {
    pub root: &'static str,
}

fn relative_string(path: &Path) -> String {
    let value = path.to_string_lossy().replace('\\', "/");
    if value.is_empty() {
        ".".to_owned()
    } else {
        value
    }
}

fn safe_relative(value: &str) -> bool {
    let path = Path::new(value);
    !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_) | Component::CurDir))
}

fn expand_pattern(root: &Path, pattern: &str) -> Vec<PathBuf> {
    if !pattern.contains(['*', '?', '[']) {
        return vec![root.join(pattern)];
    }
    let absolute = root.join(pattern).to_string_lossy().replace('\\', "/");
    glob::glob(&absolute)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|path| path.is_dir())
        .collect()
}

fn members_for_pattern(
    root: &Path,
    pattern: &str,
    conflicts: &mut Vec<Conflict>,
    unsafe_symlinks: &mut Vec<String>,
) -> Vec<PathBuf> {
    let expanded = expand_pattern(root, pattern);
    if expanded.is_empty() || expanded.iter().all(|path| !path.exists()) {
        conflicts.push(Conflict {
            code: "MISSING_MEMBER".to_owned(),
            message: "declared workspace member did not resolve to an existing directory"
                .to_owned(),
            paths: vec![pattern.replace('\\', "/")],
        });
        return Vec::new();
    }
    expanded
        .into_iter()
        .filter(|path| path.exists())
        .filter(|path| {
            let Ok(canonical) = std::fs::canonicalize(path) else {
                return true;
            };
            if canonical.starts_with(root) {
                return true;
            }
            let relative = path
                .strip_prefix(root)
                .map(relative_string)
                .unwrap_or_else(|_| relative_string(path));
            unsafe_symlinks.push(relative.clone());
            conflicts.push(Conflict {
                code: "UNSAFE_SYMLINK".to_owned(),
                message: "workspace member resolves outside the repository".to_owned(),
                paths: vec![relative],
            });
            false
        })
        .collect()
}

fn root_lock(root: &Path) -> (Option<String>, Vec<Conflict>) {
    let candidates = [
        ("pnpm-lock.yaml", "pnpm"),
        ("package-lock.json", "npm"),
        ("yarn.lock", "yarn"),
        ("bun.lockb", "bun"),
        ("bun.lock", "bun"),
    ];
    let present: Vec<_> = candidates
        .iter()
        .filter(|(path, _)| root.join(path).is_file())
        .collect();
    let conflicts = if present.len() > 1 {
        vec![Conflict {
            code: "MULTIPLE_LOCK_OWNERS".to_owned(),
            message: "multiple JavaScript lockfiles make package-manager ownership ambiguous"
                .to_owned(),
            paths: present.iter().map(|(path, _)| (*path).to_owned()).collect(),
        }]
    } else {
        Vec::new()
    };
    (
        present.first().map(|(_, manager)| (*manager).to_owned()),
        conflicts,
    )
}

fn node_patterns(package: &Value) -> Vec<String> {
    package["workspaces"]
        .as_array()
        .or_else(|| package["workspaces"]["packages"].as_array())
        .into_iter()
        .flatten()
        .filter_map(|item| item.as_str().map(str::to_owned))
        .collect()
}

fn pnpm_patterns(root: &Path) -> Vec<String> {
    let Ok(bytes) = std::fs::read(root.join("pnpm-workspace.yaml")) else {
        return Vec::new();
    };
    let Ok(value) = serde_yaml::from_slice::<serde_yaml::Value>(&bytes) else {
        return Vec::new();
    };
    value["packages"]
        .as_sequence()
        .into_iter()
        .flatten()
        .filter_map(|item| item.as_str().map(str::to_owned))
        .collect()
}

fn cargo_patterns(value: &toml::Value, key: &str) -> Vec<String> {
    value
        .get("workspace")
        .and_then(|workspace| workspace.get(key))
        .and_then(toml::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.as_str().map(str::to_owned))
        .collect()
}

fn pub_patterns(value: &serde_yaml::Value) -> Vec<String> {
    value["workspace"]
        .as_sequence()
        .into_iter()
        .flatten()
        .filter_map(|item| item.as_str().map(str::to_owned))
        .collect()
}

fn command_for_node(package: &Value, manager: &str, root: &str) -> Vec<CommandSpec> {
    let script = if package["scripts"]["check"].is_string() {
        Some("check")
    } else if package["scripts"]["test"].is_string() {
        Some("test")
    } else {
        None
    };
    script
        .map(|script| CommandSpec {
            program: manager.to_owned(),
            args: vec!["run".to_owned(), script.to_owned()],
            cwd: root.to_owned(),
        })
        .into_iter()
        .collect()
}

fn add_node_module(
    repository: &Path,
    member: &Path,
    manager: &str,
    modules: &mut BTreeMap<String, Module>,
    conflicts: &mut Vec<Conflict>,
) {
    let canonical_member = std::fs::canonicalize(member).unwrap_or_else(|_| member.to_path_buf());
    let relative = canonical_member
        .strip_prefix(repository)
        .unwrap_or(&canonical_member);
    let root = relative_string(relative);
    let manifest_path = canonical_member.join("package.json");
    if !manifest_path.is_file() {
        conflicts.push(Conflict {
            code: "MISSING_MANIFEST".to_owned(),
            message: "declared Node workspace member has no package.json".to_owned(),
            paths: vec![root.clone()],
        });
        modules.insert(
            format!("unknown:{root}"),
            Module {
                id: format!("unknown:{root}"),
                root,
                kind: "unknown".to_owned(),
                name: None,
                manifest: None,
                toolchain: None,
                lock_owner: None,
                commands: Vec::new(),
                opaque: true,
                dependencies: BTreeSet::new(),
            },
        );
        return;
    }
    let package: Value = std::fs::read(&manifest_path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or(Value::Null);
    let name = package["name"].as_str().map(str::to_owned);
    let opaque = matches!(manager, "yarn" | "bun");
    let mut dependencies = BTreeSet::new();
    for section in [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
    ] {
        if let Some(map) = package[section].as_object() {
            dependencies.extend(map.keys().cloned());
        }
    }
    let id = format!("node:{root}");
    modules.insert(
        id.clone(),
        Module {
            id,
            root: root.clone(),
            kind: "node".to_owned(),
            name,
            manifest: Some(relative_string(relative.join("package.json").as_path())),
            toolchain: Some(manager.to_owned()),
            lock_owner: Some(".".to_owned()),
            commands: if opaque {
                Vec::new()
            } else {
                command_for_node(&package, manager, &root)
            },
            opaque,
            dependencies,
        },
    );
}

fn add_cargo_module(repository: &Path, member: &Path, modules: &mut BTreeMap<String, Module>) {
    let canonical_member = std::fs::canonicalize(member).unwrap_or_else(|_| member.to_path_buf());
    let relative = canonical_member
        .strip_prefix(repository)
        .unwrap_or(&canonical_member);
    let root = relative_string(relative);
    let manifest_path = canonical_member.join("Cargo.toml");
    let value: toml::Value = std::fs::read_to_string(&manifest_path)
        .ok()
        .and_then(|text| toml::from_str(&text).ok())
        .unwrap_or(toml::Value::Table(Default::default()));
    let name = value
        .get("package")
        .and_then(|p| p.get("name"))
        .and_then(toml::Value::as_str)
        .map(str::to_owned);
    let mut dependencies = BTreeSet::new();
    for section in ["dependencies", "dev-dependencies", "build-dependencies"] {
        if let Some(table) = value.get(section).and_then(toml::Value::as_table) {
            dependencies.extend(table.keys().cloned());
        }
    }
    let id = format!("rust:{root}");
    let commands = name
        .as_ref()
        .map(|name| CommandSpec {
            program: "cargo".to_owned(),
            args: vec!["test".to_owned(), "-p".to_owned(), name.clone()],
            cwd: ".".to_owned(),
        })
        .into_iter()
        .collect();
    modules.insert(
        id.clone(),
        Module {
            id,
            root,
            kind: "rust".to_owned(),
            name,
            manifest: manifest_path
                .is_file()
                .then(|| relative_string(relative.join("Cargo.toml").as_path())),
            toolchain: Some("cargo".to_owned()),
            lock_owner: Some(".".to_owned()),
            commands,
            opaque: !manifest_path.is_file(),
            dependencies,
        },
    );
}

fn add_pub_module(repository: &Path, member: &Path, modules: &mut BTreeMap<String, Module>) {
    let canonical_member = std::fs::canonicalize(member).unwrap_or_else(|_| member.to_path_buf());
    let relative = canonical_member
        .strip_prefix(repository)
        .unwrap_or(&canonical_member);
    let root = relative_string(relative);
    let manifest_path = canonical_member.join("pubspec.yaml");
    let value: serde_yaml::Value = std::fs::read(&manifest_path)
        .ok()
        .and_then(|bytes| serde_yaml::from_slice(&bytes).ok())
        .unwrap_or(serde_yaml::Value::Null);
    let name = value["name"].as_str().map(str::to_owned);
    let flutter = value["dependencies"]["flutter"]["sdk"].as_str() == Some("flutter")
        || value["environment"]["flutter"].is_string();
    let kind = if flutter { "flutter" } else { "dart" };
    let mut dependencies = BTreeSet::new();
    if let Some(map) = value["dependencies"].as_mapping() {
        dependencies.extend(map.keys().filter_map(|key| key.as_str().map(str::to_owned)));
    }
    let id = format!("{kind}:{root}");
    let program = if flutter { "flutter" } else { "dart" };
    modules.insert(
        id.clone(),
        Module {
            id,
            root: root.clone(),
            kind: kind.to_owned(),
            name,
            manifest: manifest_path
                .is_file()
                .then(|| relative_string(relative.join("pubspec.yaml").as_path())),
            toolchain: Some(program.to_owned()),
            lock_owner: Some(".".to_owned()),
            commands: vec![
                CommandSpec {
                    program: program.to_owned(),
                    args: vec!["analyze".to_owned()],
                    cwd: root.clone(),
                },
                CommandSpec {
                    program: program.to_owned(),
                    args: vec!["test".to_owned()],
                    cwd: root,
                },
            ],
            opaque: !manifest_path.is_file(),
            dependencies,
        },
    );
}

fn overrides(root: &Path) -> Option<Value> {
    std::fs::read(root.join(".agentic/project.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .map(|value| value["overrides"]["workspace"].clone())
        .filter(Value::is_object)
}

fn apply_overrides(
    root: &Path,
    modules: &mut BTreeMap<String, Module>,
    conflicts: &mut Vec<Conflict>,
) {
    let Some(overrides) = overrides(root) else {
        return;
    };
    let mut excluded = BTreeSet::new();
    for value in overrides["excludeRoots"].as_array().into_iter().flatten() {
        let Some(value) = value.as_str() else {
            continue;
        };
        if safe_relative(value) {
            excluded.insert(value.replace('\\', "/"));
        } else {
            conflicts.push(Conflict {
                code: "UNSAFE_OVERRIDE_PATH".to_owned(),
                message: "workspace exclusion must remain inside the repository".to_owned(),
                paths: vec![value.to_owned()],
            });
        }
    }
    modules.retain(|_, module| !excluded.contains(&module.root));
    for item in overrides["modules"].as_array().into_iter().flatten() {
        let Some(member_root) = item["root"].as_str() else {
            continue;
        };
        if !safe_relative(member_root) {
            conflicts.push(Conflict {
                code: "UNSAFE_OVERRIDE_PATH".to_owned(),
                message: "workspace override root must remain inside the repository".to_owned(),
                paths: vec![member_root.to_owned()],
            });
            continue;
        }
        let kind = item["kind"].as_str().unwrap_or("unknown");
        let default_id = format!("{kind}:{}", member_root.replace('\\', "/"));
        match kind {
            "node" => add_node_module(root, &root.join(member_root), "npm", modules, conflicts),
            "rust" => add_cargo_module(root, &root.join(member_root), modules),
            "dart" | "flutter" => add_pub_module(root, &root.join(member_root), modules),
            _ => {
                modules.insert(
                    default_id.clone(),
                    Module {
                        id: default_id.clone(),
                        root: member_root.replace('\\', "/"),
                        kind: "unknown".to_owned(),
                        name: None,
                        manifest: None,
                        toolchain: None,
                        lock_owner: None,
                        commands: Vec::new(),
                        opaque: true,
                        dependencies: BTreeSet::new(),
                    },
                );
            }
        }
        if let Some(mut module) = modules.remove(&default_id) {
            if let Some(dependencies) = item["dependencies"].as_array() {
                module.dependencies = dependencies
                    .iter()
                    .filter_map(|value| value.as_str().map(str::to_owned))
                    .collect();
            }
            module.id = item["id"].as_str().unwrap_or(&default_id).to_owned();
            modules.insert(module.id.clone(), module);
        }
    }
    if let Some(commands) = overrides["commands"].as_object() {
        for (id, command_list) in commands {
            let Some(module) = modules.get_mut(id) else {
                continue;
            };
            let mut parsed = Vec::new();
            for command in command_list.as_array().into_iter().flatten() {
                let Some(program) = command["program"].as_str() else {
                    continue;
                };
                let cwd = command["cwd"].as_str().unwrap_or(&module.root);
                if !safe_relative(cwd) {
                    conflicts.push(Conflict {
                        code: "UNSAFE_OVERRIDE_PATH".to_owned(),
                        message: "workspace command cwd must remain inside the repository"
                            .to_owned(),
                        paths: vec![cwd.to_owned()],
                    });
                    continue;
                }
                parsed.push(CommandSpec {
                    program: program.to_owned(),
                    args: command["args"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|arg| arg.as_str().map(str::to_owned))
                        .collect(),
                    cwd: cwd.to_owned(),
                });
            }
            module.commands = parsed;
        }
    }
}

fn graph_conflicts(modules: &BTreeMap<String, Module>, conflicts: &mut Vec<Conflict>) {
    let mut names: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    let mut roots: BTreeMap<String, Vec<&str>> = BTreeMap::new();
    for module in modules.values() {
        if let Some(name) = module.name.as_deref() {
            names.entry(name).or_default().push(&module.id);
        }
        roots
            .entry(module.root.to_lowercase())
            .or_default()
            .push(&module.root);
    }
    for (name, ids) in names.into_iter().filter(|(_, ids)| ids.len() > 1) {
        conflicts.push(Conflict {
            code: "DUPLICATE_PACKAGE_NAME".to_owned(),
            message: format!("duplicate package name: {name}"),
            paths: ids.into_iter().map(str::to_owned).collect(),
        });
    }
    for paths in roots.into_values().filter(|paths| paths.len() > 1) {
        conflicts.push(Conflict {
            code: "CASE_COLLISION".to_owned(),
            message: "module roots collide under case-insensitive comparison".to_owned(),
            paths: paths.into_iter().map(str::to_owned).collect(),
        });
    }
    let module_roots: Vec<_> = modules
        .values()
        .filter(|module| module.root != ".")
        .collect();
    for (index, left) in module_roots.iter().enumerate() {
        for right in module_roots.iter().skip(index + 1) {
            if left.root.starts_with(&format!("{}/", right.root))
                || right.root.starts_with(&format!("{}/", left.root))
            {
                conflicts.push(Conflict {
                    code: "OVERLAPPING_MODULE_ROOTS".to_owned(),
                    message: "workspace module roots overlap".to_owned(),
                    paths: vec![left.root.clone(), right.root.clone()],
                });
            }
        }
    }
}

fn edges(modules: &BTreeMap<String, Module>) -> Vec<Edge> {
    let names: BTreeMap<_, _> = modules
        .values()
        .filter_map(|module| module.name.as_ref().map(|name| (name, &module.id)))
        .collect();
    let mut edges = Vec::new();
    for module in modules.values() {
        for dependency in &module.dependencies {
            let target = modules
                .contains_key(dependency)
                .then_some(dependency)
                .or_else(|| names.get(dependency).copied());
            if let Some(target) = target {
                edges.push(Edge {
                    from: module.id.clone(),
                    to: target.clone(),
                    kind: "internal",
                });
            }
        }
    }
    edges.sort_by(|left, right| (&left.from, &left.to).cmp(&(&right.from, &right.to)));
    edges
}

fn cycle_conflict(modules: &BTreeMap<String, Module>, edges: &[Edge]) -> Option<Conflict> {
    let adjacency: BTreeMap<&str, Vec<&str>> = modules
        .keys()
        .map(|id| {
            (
                id.as_str(),
                edges
                    .iter()
                    .filter(|edge| edge.from == *id)
                    .map(|edge| edge.to.as_str())
                    .collect(),
            )
        })
        .collect();
    fn visit<'a>(
        node: &'a str,
        adjacency: &BTreeMap<&'a str, Vec<&'a str>>,
        visiting: &mut BTreeSet<&'a str>,
        visited: &mut BTreeSet<&'a str>,
    ) -> bool {
        if visiting.contains(node) {
            return true;
        }
        if visited.contains(node) {
            return false;
        }
        visiting.insert(node);
        if adjacency
            .get(node)
            .into_iter()
            .flatten()
            .any(|next| visit(next, adjacency, visiting, visited))
        {
            return true;
        }
        visiting.remove(node);
        visited.insert(node);
        false
    }
    let mut visiting = BTreeSet::new();
    let mut visited = BTreeSet::new();
    adjacency
        .keys()
        .copied()
        .find(|node| visit(node, &adjacency, &mut visiting, &mut visited))
        .map(|node| Conflict {
            code: "DEPENDENCY_CYCLE".to_owned(),
            message: "workspace dependency graph contains a cycle".to_owned(),
            paths: vec![node.to_owned()],
        })
}

fn git_state(root: &Path) -> GitState {
    let head = Command::new("git")
        .args(["-C", &root.to_string_lossy(), "rev-parse", "HEAD"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned());
    let dirty = Command::new("git")
        .args(["-C", &root.to_string_lossy(), "status", "--porcelain"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| !output.stdout.is_empty());
    GitState { head, dirty }
}

fn fingerprint(root: &Path, modules: &[Module], edges: &[Edge], conflicts: &[Conflict]) -> String {
    let mut digest = Sha256::new();
    digest.update(serde_json::to_vec(&(modules, edges, conflicts)).unwrap_or_default());
    for module in modules {
        if let Some(manifest) = &module.manifest {
            digest.update(manifest.as_bytes());
            digest.update(std::fs::read(root.join(manifest)).unwrap_or_default());
        }
    }
    hex::encode(digest.finalize())
}

pub fn discover(root: &Path) -> WorkspaceGraph {
    let repository = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let mut modules = BTreeMap::new();
    let (manager, mut conflicts) = root_lock(&repository);
    let mut unsafe_symlinks = Vec::new();
    let manager = manager.unwrap_or_else(|| "npm".to_owned());

    if let Ok(bytes) = std::fs::read(repository.join("package.json")) {
        let package: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        let mut patterns = node_patterns(&package);
        patterns.extend(pnpm_patterns(&repository));
        patterns.sort();
        patterns.dedup();
        if patterns.is_empty() {
            add_node_module(
                &repository,
                &repository,
                &manager,
                &mut modules,
                &mut conflicts,
            );
        }
        for pattern in patterns {
            for member in
                members_for_pattern(&repository, &pattern, &mut conflicts, &mut unsafe_symlinks)
            {
                add_node_module(&repository, &member, &manager, &mut modules, &mut conflicts);
            }
        }
    }
    if let Ok(text) = std::fs::read_to_string(repository.join("Cargo.toml")) {
        if let Ok(value) = toml::from_str::<toml::Value>(&text) {
            let members = cargo_patterns(&value, "members");
            if value.get("package").is_some() {
                add_cargo_module(&repository, &repository, &mut modules);
            }
            for pattern in members {
                for member in
                    members_for_pattern(&repository, &pattern, &mut conflicts, &mut unsafe_symlinks)
                {
                    add_cargo_module(&repository, &member, &mut modules);
                }
            }
        }
    }
    if let Ok(bytes) = std::fs::read(repository.join("pubspec.yaml")) {
        if let Ok(value) = serde_yaml::from_slice::<serde_yaml::Value>(&bytes) {
            let members = pub_patterns(&value);
            if members.is_empty() {
                add_pub_module(&repository, &repository, &mut modules);
            }
            for pattern in members {
                for member in
                    members_for_pattern(&repository, &pattern, &mut conflicts, &mut unsafe_symlinks)
                {
                    add_pub_module(&repository, &member, &mut modules);
                }
            }
        }
    }
    apply_overrides(&repository, &mut modules, &mut conflicts);
    graph_conflicts(&modules, &mut conflicts);
    let edges = edges(&modules);
    if let Some(cycle) = cycle_conflict(&modules, &edges) {
        conflicts.push(cycle);
    }
    conflicts.sort_by(|left, right| (&left.code, &left.paths).cmp(&(&right.code, &right.paths)));
    unsafe_symlinks.sort();
    unsafe_symlinks.dedup();
    let modules: Vec<_> = modules.into_values().collect();
    let fingerprint = fingerprint(&repository, &modules, &edges, &conflicts);
    WorkspaceGraph {
        schema_version: 1,
        root_aggregate: RootAggregate { root: "." },
        valid: conflicts.is_empty(),
        modules,
        edges,
        conflicts,
        unsafe_symlinks,
        fingerprint,
        git: git_state(&repository),
    }
}
