use std::fs;
use std::io::Read;
use std::path::{Component, Path};

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MAX_FILES: usize = 4096;
pub const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;
pub const MAX_TOTAL_BYTES: u64 = 32 * 1024 * 1024;
pub const MAX_PROGRAM_BYTES: u64 = 128 * 1024 * 1024;
pub const MAX_PROGRAM_TOTAL_BYTES: u64 = 256 * 1024 * 1024;
pub const ENVIRONMENT: &[&str] = &[
    "CI",
    "NODE_ENV",
    "RUSTFLAGS",
    "RUSTUP_TOOLCHAIN",
    "CARGO_BUILD_TARGET",
    "CARGO_PROFILE",
    "FLUTTER_BUILD_MODE",
];

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Policy {
    pub version: u8,
    pub files: Vec<String>,
    pub programs: Vec<String>,
    #[serde(default)]
    pub environment: Vec<String>,
    #[serde(default)]
    pub service_constraints: Vec<ServiceConstraint>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ServiceConstraint {
    pub id: String,
    pub revision: String,
}

pub fn load(root: &Path) -> Result<Option<Policy>, String> {
    let path = root.join(".agentic/project.json");
    if !path.exists() {
        return Ok(None);
    }
    check_components(root, Path::new(".agentic/project.json"))?;
    let bytes = read_bounded(&path, 1024 * 1024)?;
    let state: Value =
        serde_json::from_slice(&bytes).map_err(|_| "invalid-project-input-configuration")?;
    for module in state
        .pointer("/overrides/workspace/modules")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if let Some(relative) = module["root"].as_str() {
            check_command_cwd(root, relative)?;
        }
    }
    for command in state
        .pointer("/overrides/workspace/commands")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|commands| commands.values())
        .flat_map(|commands| commands.as_array().into_iter().flatten())
    {
        if let Some(cwd) = command["cwd"].as_str() {
            check_command_cwd(root, cwd)?;
        }
    }
    let Some(value) = state.pointer("/overrides/workspace/verificationInputs") else {
        return Ok(None);
    };
    let policy: Policy =
        serde_json::from_value(value.clone()).map_err(|_| "invalid-verification-input-policy")?;
    if policy.version != 1
        || policy.files.is_empty()
        || policy.files.len() > MAX_FILES
        || policy.programs.is_empty()
        || policy.programs.len() > 128
        || policy.environment.len() > 16
        || policy.service_constraints.len() > 32
    {
        return Err("invalid-verification-input-policy-bounds".to_owned());
    }
    for file in &policy.files {
        validate_file(file)?;
        check_components(root, Path::new(file))?;
    }
    if policy
        .programs
        .iter()
        .any(|p| p.is_empty() || p.len() > 4096 || p.contains(['\n', '\r', '\0']))
        || policy
            .environment
            .iter()
            .any(|name| !ENVIRONMENT.contains(&name.as_str()))
        || policy.service_constraints.iter().any(|s| {
            s.id.is_empty() || s.id.len() > 128 || s.revision.is_empty() || s.revision.len() > 128
        })
    {
        return Err("invalid-verification-input-constraints".to_owned());
    }
    for program in &policy.programs {
        let path = Path::new(program);
        if path
            .components()
            .any(|part| matches!(part, Component::ParentDir))
            || (program.contains(':') && !path.is_absolute())
        {
            return Err("unsafe-verification-program-path".to_owned());
        }
        super::snapshot::resolve(root, program)?;
    }
    Ok(Some(policy))
}

pub fn check_program_target(path: &Path) -> Result<(), String> {
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("unsafe-verification-program-path")?;
    validate_file(filename)?;
    #[cfg(windows)]
    if !path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| {
            ["exe", "cmd", "bat", "com"]
                .iter()
                .any(|allowed| extension.eq_ignore_ascii_case(allowed))
        })
    {
        return Err("unsupported-verification-program-file".to_owned());
    }
    let mut current = std::path::PathBuf::new();
    for component in path.components() {
        current.push(component);
        if let Component::Normal(name) = component {
            validate_file(
                name.to_str()
                    .ok_or("verification-program-path-not-unicode")?,
            )?;
        }
        let metadata =
            fs::symlink_metadata(&current).map_err(|_| "declared-program-unavailable")?;
        #[cfg(windows)]
        let reparse = {
            use std::os::windows::fs::MetadataExt;
            metadata.file_attributes() & 0x400 != 0
        };
        #[cfg(not(windows))]
        let reparse = false;
        if metadata.file_type().is_symlink() || reparse {
            return Err("unsafe-verification-program-link".to_owned());
        }
    }
    Ok(())
}

pub fn check_command_cwd(root: &Path, cwd: &str) -> Result<(), String> {
    let relative = Path::new(cwd);
    if cwd.is_empty()
        || cwd.contains([':', '\0', '\n', '\r'])
        || relative.is_absolute()
        || relative
            .components()
            .any(|part| !matches!(part, Component::Normal(_) | Component::CurDir))
    {
        return Err("unsafe-verification-command-cwd".to_owned());
    }
    check_components(root, relative)
}

pub fn validate_file(file: &str) -> Result<(), String> {
    if file.is_empty()
        || file.len() > 4096
        || file.contains(['\\', ':', '\0', '\n', '\r'])
        || Path::new(file)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
        || file
            .split('/')
            .any(|part| part.is_empty() || part.ends_with([' ', '.']))
    {
        return Err("unsafe-verification-input-path".to_owned());
    }
    let parts: Vec<_> = file.split('/').map(str::to_ascii_lowercase).collect();
    let generated = [
        ".git",
        ".agents",
        ".codex",
        "node_modules",
        "target",
        "dist",
        "build",
        ".tmp",
        "coverage",
        ".ssh",
        ".aws",
        ".azure",
        ".gnupg",
    ];
    let protected = parts.iter().any(|part| {
        generated.contains(&part.as_str())
            || ((part == ".env" || part.starts_with(".env."))
                && part != ".env.example"
                && part != ".env.sample")
            || [
                "credentials",
                "credentials.json",
                "credentials.toml",
                "auth.json",
                "tokens.json",
                "secrets.json",
                "secrets.yaml",
                "secrets.yml",
            ]
            .contains(&part.as_str())
            || [".pem", ".key", ".pfx", ".p12"]
                .iter()
                .any(|extension| part.ends_with(extension))
    });
    if protected {
        return Err("protected-or-generated-verification-input".to_owned());
    }
    Ok(())
}

pub fn check_components(root: &Path, relative: &Path) -> Result<(), String> {
    let canonical_root =
        fs::canonicalize(root).map_err(|_| "verification-input-root-unavailable")?;
    let mut path = root.to_path_buf();
    for component in relative.components() {
        path.push(component);
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => return Err("verification-input-metadata-unavailable".to_owned()),
        };
        #[cfg(windows)]
        let reparse = {
            use std::os::windows::fs::MetadataExt;
            metadata.file_attributes() & 0x400 != 0
        };
        #[cfg(not(windows))]
        let reparse = false;
        if metadata.file_type().is_symlink() || reparse {
            return Err("unsafe-verification-input-link".to_owned());
        }
        let canonical =
            fs::canonicalize(&path).map_err(|_| "verification-input-path-unavailable")?;
        if !canonical.starts_with(&canonical_root) {
            return Err("unsafe-verification-input-path".to_owned());
        }
    }
    Ok(())
}

pub fn read_bounded(path: &Path, max: u64) -> Result<Vec<u8>, String> {
    let file = fs::File::open(path).map_err(|_| "verification-input-unavailable")?;
    if !file
        .metadata()
        .map_err(|_| "verification-input-metadata-unavailable")?
        .is_file()
    {
        return Err("verification-input-not-a-file".to_owned());
    }
    let mut bytes = Vec::new();
    file.take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "verification-input-read-failed")?;
    if bytes.len() as u64 > max {
        return Err("verification-input-byte-limit".to_owned());
    }
    Ok(bytes)
}
