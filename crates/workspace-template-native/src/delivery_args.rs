use std::cmp::Ordering;
use std::collections::BTreeSet;
use std::path::Path;

use serde_json::Value;

use crate::delivery::DeliveryError;

pub fn option(args: &[String], name: &str) -> Option<String> {
    args.windows(2)
        .find(|pair| pair[0] == name)
        .map(|pair| pair[1].clone())
}

pub fn flag(args: &[String], name: &str) -> bool {
    args.iter().any(|argument| argument == name)
}

pub fn validate(command: &str, args: &[String]) -> Result<(), DeliveryError> {
    let subcommand = args
        .first()
        .map(String::as_str)
        .ok_or_else(|| usage(format!("{command} requires plan or apply")))?;
    if !matches!(subcommand, "plan" | "apply") {
        return Err(usage(format!("unknown {command} subcommand: {subcommand}")));
    }
    let mut index = 1;
    let mut root_seen = false;
    let mut seen = BTreeSet::new();
    while index < args.len() {
        let argument = args[index].as_str();
        if !argument.starts_with('-') {
            if root_seen || index != 1 {
                return Err(usage(format!(
                    "unexpected {command} positional: {argument}"
                )));
            }
            root_seen = true;
            index += 1;
            continue;
        }
        let takes_value = match (subcommand, argument) {
            ("plan", "--plan-out" | "--package-commit") => true,
            ("plan", "--allow-downgrade") => false,
            ("apply", "--apply-plan") => true,
            _ => {
                return Err(usage(format!(
                    "unknown {command} {subcommand} option: {argument}"
                )))
            }
        };
        if !seen.insert(argument.to_owned()) {
            return Err(usage(format!("duplicate {command} option: {argument}")));
        }
        if takes_value {
            index += 1;
            if args.get(index).is_none_or(|value| value.starts_with('-')) {
                return Err(usage(format!("{argument} requires a value")));
            }
        }
        index += 1;
    }
    Ok(())
}

fn usage(message: String) -> DeliveryError {
    DeliveryError {
        code: "INVALID_ARGUMENT",
        message,
        exit_code: 64,
    }
}

fn semver_core(value: &str) -> Option<([u64; 3], Option<&str>)> {
    let (core, prerelease) = value
        .split_once('-')
        .map_or((value, None), |(core, suffix)| (core, Some(suffix)));
    let numbers: Vec<_> = core
        .split('.')
        .map(str::parse::<u64>)
        .collect::<Result<_, _>>()
        .ok()?;
    (numbers.len() == 3).then(|| ([numbers[0], numbers[1], numbers[2]], prerelease))
}

fn newer_than_running(value: &str) -> bool {
    let Some((existing, existing_pre)) = semver_core(value) else {
        return false;
    };
    let Some((running, running_pre)) = semver_core(env!("CARGO_PKG_VERSION")) else {
        return false;
    };
    existing > running
        || (existing == running
            && match (existing_pre, running_pre) {
                (None, Some(_)) => true,
                (Some(left), Some(right)) => prerelease_cmp(left, right).is_gt(),
                _ => false,
            })
}

fn prerelease_cmp(left: &str, right: &str) -> Ordering {
    for (left, right) in left.split('.').zip(right.split('.')) {
        let ordering = match (left.parse::<u64>(), right.parse::<u64>()) {
            (Ok(left), Ok(right)) => left.cmp(&right),
            (Ok(_), Err(_)) => Ordering::Less,
            (Err(_), Ok(_)) => Ordering::Greater,
            (Err(_), Err(_)) => left.cmp(right),
        };
        if !ordering.is_eq() {
            return ordering;
        }
    }
    left.split('.').count().cmp(&right.split('.').count())
}

pub fn reject_unapproved_downgrade(root: &Path, allowed: bool) -> Result<(), DeliveryError> {
    if allowed {
        return Ok(());
    }
    let existing: Option<Value> = std::fs::read(root.join(".agentic/project.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok());
    let version = existing
        .as_ref()
        .and_then(|value| value["workspaceTemplate"]["releaseVersion"].as_str());
    if version.is_some_and(newer_than_running) {
        return Err(DeliveryError {
            code: "DOWNGRADE_REQUIRES_APPROVAL",
            message: format!(
                "project release {} is newer than {}; repeat the reviewed plan with --allow-downgrade",
                version.unwrap(),
                env!("CARGO_PKG_VERSION")
            ),
            exit_code: 3,
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::cmp::Ordering;

    #[test]
    fn prerelease_comparison_uses_semver_identifier_rules() {
        assert_eq!(
            super::prerelease_cmp("alpha.10", "alpha.2"),
            Ordering::Greater
        );
        assert_eq!(
            super::prerelease_cmp("alpha.1", "alpha.beta"),
            Ordering::Less
        );
        assert_eq!(super::prerelease_cmp("alpha", "alpha.1"), Ordering::Less);
    }
}
