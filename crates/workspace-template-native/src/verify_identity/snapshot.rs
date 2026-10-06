use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::policy::{self, Policy};

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct Snapshot {
    pub files: BTreeMap<String, String>,
    pub programs: BTreeMap<String, (String, String)>,
    pub environment: BTreeMap<String, String>,
    pub verifier_sha256: String,
}

fn hash(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

pub fn resolve(root: &Path, program: &str) -> Result<PathBuf, String> {
    let path = Path::new(program);
    if path.is_absolute() || path.components().count() > 1 {
        let candidate = if path.is_absolute() {
            path.to_path_buf()
        } else {
            root.join(path)
        };
        policy::check_program_target(&candidate)?;
        return fs::canonicalize(candidate).map_err(|_| "declared-program-unavailable".to_owned());
    }
    let extensions = if cfg!(windows) && path.extension().is_none() {
        vec![".exe", ".cmd", ".bat", ""]
    } else {
        vec![""]
    };
    for directory in std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()) {
        for extension in &extensions {
            let candidate = directory.join(format!("{program}{extension}"));
            if candidate.is_file() {
                policy::check_program_target(&candidate)?;
                return fs::canonicalize(candidate)
                    .map_err(|_| "declared-program-unavailable".to_owned());
            }
        }
    }
    Err("declared-program-unavailable".to_owned())
}

pub fn capture(root: &Path, policy: &Policy) -> Result<Snapshot, String> {
    let mut files = BTreeMap::new();
    let mut total = 0_u64;
    for relative in &policy.files {
        policy::check_components(root, Path::new(relative))?;
        let bytes = policy::read_bounded(&root.join(relative), policy::MAX_FILE_BYTES)?;
        policy::check_components(root, Path::new(relative))?;
        total += bytes.len() as u64;
        if total > policy::MAX_TOTAL_BYTES {
            return Err("verification-input-total-byte-limit".to_owned());
        }
        files.insert(relative.clone(), hash(&bytes));
    }
    let mut programs = BTreeMap::new();
    let mut program_total = 0_u64;
    for program in &policy.programs {
        let resolved = resolve(root, program)?;
        let bytes = policy::read_bounded(&resolved, policy::MAX_PROGRAM_BYTES)?;
        program_total += bytes.len() as u64;
        if program_total > policy::MAX_PROGRAM_TOTAL_BYTES {
            return Err("verification-program-total-byte-limit".to_owned());
        }
        let resolved = resolved
            .to_str()
            .ok_or("verification-program-path-not-unicode")?;
        programs.insert(program.clone(), (resolved.to_owned(), hash(&bytes)));
    }
    let mut environment = BTreeMap::new();
    for name in &policy.environment {
        let value = std::env::var_os(name);
        let value = value
            .map(|value| {
                value
                    .into_string()
                    .map_err(|_| "verification-environment-not-unicode")
            })
            .transpose()?;
        let bytes =
            serde_json::to_vec(&value).map_err(|_| "verification-environment-unavailable")?;
        if bytes.len() > 64 * 1024 {
            return Err("verification-environment-byte-limit".to_owned());
        }
        environment.insert(name.clone(), hash(&bytes));
    }
    let verifier = std::env::current_exe().map_err(|_| "verifier-identity-unavailable")?;
    let verifier_sha256 = hash(&policy::read_bounded(&verifier, policy::MAX_PROGRAM_BYTES)?);
    Ok(Snapshot {
        files,
        programs,
        environment,
        verifier_sha256,
    })
}
